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
import { discoverPluginDirs, readJson } from "./lib/catalog.mjs";
import { emitGithubAnnotations, hasErrors, printIssues } from "./lib/issues.mjs";
import { findDuplicateServerIds, validatePlugin } from "./lib/validate.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const META_PATH = path.join(SCRIPT_DIR, "marketplace.meta.json");
const OUTPUT_PATH = path.join(REPO_ROOT, "marketplace.json");

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

  const pluginDirs = discoverPluginDirs(REPO_ROOT);

  // Validate every plugin; collect ALL issues before bailing.
  const issues = [];
  const manifests = new Map();
  const servers = [];
  for (const dir of pluginDirs) {
    const result = validatePlugin(REPO_ROOT, dir);
    issues.push(...result.issues);
    if (result.manifest) manifests.set(dir, result.manifest);
    servers.push({ dir, serverIds: result.serverIds });
  }
  issues.push(...findDuplicateServerIds(servers));

  // Featured entries must reference real plugin dirs.
  for (const f of meta.featured) {
    if (!pluginDirs.includes(f)) {
      issues.push({
        level: "error",
        file: "scripts/marketplace.meta.json",
        message: `featured plugin "${f}" has no matching plugin directory`,
      });
    }
  }

  emitGithubAnnotations(issues);
  if (hasErrors(issues)) {
    const count = issues.filter((i) => i.level === "error").length;
    console.error(`Validation failed with ${count} error(s):`);
    printIssues(issues);
    process.exit(1);
  }
  printIssues(issues); // warnings only, if any

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
