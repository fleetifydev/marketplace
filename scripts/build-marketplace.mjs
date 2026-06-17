#!/usr/bin/env node
/**
 * build-marketplace.mjs
 *
 * Generates the root `marketplace.json` from per-plugin manifests, making each
 * `<plugin>/.fleetify-plugin/plugin.json` the single source of truth.
 *
 * The editorial header (name/description/homepage/icon) and the curated
 * `featured` list live in `scripts/marketplace.meta.json`; everything else is
 * derived from the plugin manifests.
 *
 * Modes:
 *   (default) | --write   Build and write `marketplace.json`.
 *   --check               Build in memory and compare to the on-disk file.
 *                         Exit 1 (with a fix hint) if they differ.
 *
 * Validation runs in BOTH modes. All validation errors are collected and
 * printed together; any error exits 1.
 *
 * No third-party dependencies — Node built-ins only (fs, path, url).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const META_PATH = path.join(SCRIPT_DIR, "marketplace.meta.json");
const OUTPUT_PATH = path.join(REPO_ROOT, "marketplace.json");
const MANIFEST_SUBPATH = path.join(".fleetify-plugin", "plugin.json");

/** Directory names that are never plugins. */
const IGNORED_DIRS = new Set([".git", "scripts", "node_modules"]);

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// Strict semver: X.Y.Z with optional -prerelease and +build.
// Numeric identifiers (major/minor/patch and numeric pre-release identifiers)
// must not contain leading zeros. Mirrors the official semver.org pattern.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * Read + JSON.parse a file, throwing a contextualized error on failure.
 * @param {string} filePath
 * @returns {*}
 */
function readJson(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${filePath}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in ${filePath}: ${err.message}`);
  }
}

/**
 * Enumerate top-level plugin directory names (those containing a manifest at
 * `<dir>/.fleetify-plugin/plugin.json`). Skips ignored dirs, dotfiles, and
 * non-directories. Returned sorted ascending.
 * @returns {string[]}
 */
function discoverPluginDirs() {
  const entries = fs.readdirSync(REPO_ROOT, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith(".")) continue;
    if (IGNORED_DIRS.has(name)) continue;
    const manifestPath = path.join(REPO_ROOT, name, MANIFEST_SUBPATH);
    if (fs.existsSync(manifestPath)) dirs.push(name);
  }
  dirs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return dirs;
}

/**
 * Validate a single parsed manifest against the marketplace contract.
 * Pushes human-readable messages onto `errors`; never throws for data issues.
 * @param {string} dir   the plugin directory name
 * @param {*} manifest   the parsed plugin.json
 * @param {string[]} errors
 */
function validateManifest(dir, manifest, errors) {
  const where = `${dir}/${MANIFEST_SUBPATH}`;
  const fail = (msg) => errors.push(`${where}: ${msg}`);

  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("manifest must be a JSON object");
    return;
  }

  // name: kebab-ish and equal to the directory name.
  const { name } = manifest;
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    fail(`"name" must match /^[a-z0-9][a-z0-9-]*$/ (got ${JSON.stringify(name)})`);
  } else if (name !== dir) {
    fail(`"name" (${JSON.stringify(name)}) must equal the directory name (${JSON.stringify(dir)})`);
  }

  // version: strict semver.
  const { version } = manifest;
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    fail(
      `"version" must be strict semver X.Y.Z (optional -pre/+build, no leading zeros) (got ${JSON.stringify(version)})`
    );
  }

  // providers: non-empty array of strings.
  const { providers } = manifest;
  if (!Array.isArray(providers) || providers.length === 0) {
    fail(`"providers" must be a non-empty array (got ${JSON.stringify(providers)})`);
  } else {
    providers.forEach((p, i) => {
      if (typeof p !== "string" || p.length === 0) {
        fail(`"providers[${i}]" must be a non-empty string (got ${JSON.stringify(p)})`);
      }
    });
  }

  // declares: present and an object.
  const { declares } = manifest;
  if (declares === null || typeof declares !== "object" || Array.isArray(declares)) {
    fail(`"declares" must be present and an object (got ${JSON.stringify(declares)})`);
  }

  // requires_secrets: if present, array of {key, label, url?}.
  if (Object.prototype.hasOwnProperty.call(manifest, "requires_secrets")) {
    const rs = manifest.requires_secrets;
    if (!Array.isArray(rs)) {
      fail(`"requires_secrets" must be an array when present (got ${JSON.stringify(rs)})`);
    } else {
      rs.forEach((entry, i) => {
        const at = `"requires_secrets[${i}]"`;
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          fail(`${at} must be an object (got ${JSON.stringify(entry)})`);
          return;
        }
        if (typeof entry.key !== "string" || entry.key.length === 0) {
          fail(`${at}.key must be a non-empty string (got ${JSON.stringify(entry.key)})`);
        }
        if (typeof entry.label !== "string" || entry.label.length === 0) {
          fail(`${at}.label must be a non-empty string (got ${JSON.stringify(entry.label)})`);
        }
        if (Object.prototype.hasOwnProperty.call(entry, "url") && typeof entry.url !== "string") {
          fail(`${at}.url must be a string when present (got ${JSON.stringify(entry.url)})`);
        }
      });
    }
  }
}

/**
 * Validate the editorial meta file. Returns the parsed meta.
 * @returns {{name:string, description:string, homepage:string, icon:string, featured:string[]}}
 */
function loadMeta() {
  const meta = readJson(META_PATH);
  const problems = [];
  for (const key of ["name", "description", "homepage", "icon"]) {
    if (typeof meta[key] !== "string" || meta[key].length === 0) {
      problems.push(`marketplace.meta.json: "${key}" must be a non-empty string`);
    }
  }
  if (!Array.isArray(meta.featured) || !meta.featured.every((f) => typeof f === "string")) {
    problems.push(`marketplace.meta.json: "featured" must be an array of strings`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`ERROR  ${p}`);
    process.exit(1);
  }
  return meta;
}

/**
 * Serialize the marketplace document: pretty 2-space + trailing newline.
 * @param {object} doc
 * @returns {string}
 */
function serialize(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--check" && a !== "--write");
  if (unknown.length) {
    console.error(`Unknown argument(s): ${unknown.join(", ")}`);
    console.error("Usage: node scripts/build-marketplace.mjs [--write|--check]");
    process.exit(2);
  }
  const checkMode = args.includes("--check");

  const meta = loadMeta();
  const featuredSet = new Set(meta.featured);

  const pluginDirs = discoverPluginDirs();

  // Parse + validate every manifest; collect ALL errors before bailing.
  const errors = [];
  const manifests = new Map();
  for (const dir of pluginDirs) {
    const manifestPath = path.join(REPO_ROOT, dir, MANIFEST_SUBPATH);
    let manifest;
    try {
      manifest = readJson(manifestPath);
    } catch (err) {
      errors.push(err.message);
      continue;
    }
    manifests.set(dir, manifest);
    validateManifest(dir, manifest, errors);
  }

  // Featured entries must reference real plugin dirs.
  for (const f of meta.featured) {
    if (!pluginDirs.includes(f)) {
      errors.push(`marketplace.meta.json: featured plugin "${f}" has no matching plugin directory`);
    }
  }

  if (errors.length) {
    console.error(`Validation failed with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  // Build the document. Plugin dirs are already sorted ascending.
  const plugins = pluginDirs.map((dir) => ({
    path: dir,
    featured: featuredSet.has(dir),
    manifest: manifests.get(dir),
  }));

  const doc = {
    name: meta.name,
    description: meta.description,
    homepage: meta.homepage,
    icon: meta.icon,
    plugins,
  };

  const rendered = serialize(doc);
  const featuredCount = plugins.filter((p) => p.featured).length;

  // Compute DESYNC list: plugins whose OLD on-disk marketplace.json inline
  // manifest differs from the current plugin.json (i.e. the source of truth
  // has drifted from the previously generated/hand-maintained file).
  const desync = [];
  let priorDoc = null;
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      priorDoc = readJson(OUTPUT_PATH);
    } catch {
      priorDoc = null; // unreadable/corrupt prior file — treat as no prior data.
    }
  }
  if (priorDoc && Array.isArray(priorDoc.plugins)) {
    const priorByPath = new Map();
    for (const entry of priorDoc.plugins) {
      if (entry && typeof entry.path === "string") priorByPath.set(entry.path, entry.manifest);
    }
    for (const dir of pluginDirs) {
      if (!priorByPath.has(dir)) continue; // newly added plugin — not a desync.
      const before = JSON.stringify(priorByPath.get(dir));
      const after = JSON.stringify(manifests.get(dir));
      if (before !== after) desync.push(dir);
    }
  }

  if (checkMode) {
    const onDisk = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : null;
    if (onDisk !== rendered) {
      console.error("marketplace.json out of sync — run: node scripts/build-marketplace.mjs");
      process.exit(1);
    }
    console.log(`OK  marketplace.json in sync — ${plugins.length} plugins, ${featuredCount} featured.`);
    process.exit(0);
  }

  // Write mode (default / --write).
  fs.writeFileSync(OUTPUT_PATH, rendered);
  console.log(`Wrote marketplace.json — ${plugins.length} plugins, ${featuredCount} featured.`);
  for (const dir of desync) console.log(`DESYNC FIXED: ${dir}`);
  if (desync.length === 0) {
    console.log("No inline-manifest desyncs detected (every plugin.json already matched).");
  }
}

main();
