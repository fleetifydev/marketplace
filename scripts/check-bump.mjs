#!/usr/bin/env node
/**
 * check-bump.mjs <baseSha>
 *
 * PR guard: any plugin whose CONTENT changed between <baseSha> and HEAD must
 * have (1) bumped its `version` in `.fleetify-plugin/plugin.json` and (2)
 * recorded a matching `## [<version>]` section in its `CHANGELOG.md`.
 *
 * Rules, per changed plugin dir that still exists:
 *   Rule 1 (bump):  if the plugin existed at base AND its version is unchanged
 *                   AND any changed file under the dir is NOT CHANGELOG.md,
 *                   error — content changed but version not bumped. (A
 *                   CHANGELOG-only edit needs no bump.)
 *   Rule 2 (changelog): CHANGELOG.md must exist and contain a heading line
 *                   matching `## [<curVer>]`.
 *
 * Robustness: an empty/unresolvable <baseSha> prints a notice and exits 0
 * (don't block — e.g. first push to a new repo, or a shallow checkout where
 * the base isn't present).
 *
 * No third-party dependencies — Node built-ins only.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const MANIFEST_SUBPATH = ".fleetify-plugin/plugin.json"; // POSIX: matches git paths

/** First path segments that are never plugin dirs. */
const NON_PLUGIN_TOP = new Set([".github", "scripts"]);
/** Root files to ignore outright. */
const IGNORED_ROOT_FILES = new Set(["README.md", "marketplace.json", "LICENSE"]);

/**
 * Run git, returning trimmed stdout, or null if the command fails.
 * @param {string[]} args
 * @returns {string|null}
 */
function git(args) {
  try {
    // stdio: capture stdout; silence stderr so expected "not found" failures
    // (e.g. a path that didn't exist at base) don't spam CI logs.
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * Parse the `version` field out of a raw plugin.json string.
 * @param {string|null} raw
 * @returns {string|null}
 */
function versionFromRaw(raw) {
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Current manifest version on disk, or null. */
function currentVersion(dir) {
  const p = path.join(REPO_ROOT, dir, ".fleetify-plugin", "plugin.json");
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
  return versionFromRaw(raw);
}

/** Manifest version at <baseSha>, or null if the file didn't exist then. */
function baseVersion(baseSha, dir) {
  const raw = git(["show", `${baseSha}:${dir}/${MANIFEST_SUBPATH}`]);
  return versionFromRaw(raw);
}

/**
 * Does `dir` look like a plugin dir either now or at base?
 * @param {string} baseSha
 * @param {string} dir
 * @returns {boolean}
 */
function isPluginDir(baseSha, dir) {
  if (NON_PLUGIN_TOP.has(dir)) return false;
  const nowPath = path.join(REPO_ROOT, dir, ".fleetify-plugin", "plugin.json");
  if (fs.existsSync(nowPath)) return true;
  // Existed-at-base check: was there a manifest under this dir at baseSha?
  const atBase = git(["cat-file", "-e", `${baseSha}:${dir}/${MANIFEST_SUBPATH}`]);
  return atBase !== null;
}

/** True if the on-disk CHANGELOG.md for dir has a `## [version]` heading. */
function changelogHasVersion(dir, version) {
  const p = path.join(REPO_ROOT, dir, "CHANGELOG.md");
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return false;
  }
  const re = new RegExp(`^##\\s*\\[${escapeRegExp(version)}\\]`, "m");
  return re.test(raw);
}

/** Escape a string for safe insertion into a RegExp. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  const baseSha = (process.argv[2] || "").trim();

  if (!baseSha) {
    console.log("check-bump: no base SHA provided — skipping (exit 0).");
    process.exit(0);
  }

  // Resolve the base ref. If it isn't present (shallow clone, force-push,
  // brand-new repo), don't block the PR.
  const resolved = git(["rev-parse", "--verify", `${baseSha}^{commit}`]);
  if (resolved === null) {
    console.log(`check-bump: base SHA "${baseSha}" not resolvable — skipping (exit 0).`);
    process.exit(0);
  }

  const diff = git(["diff", "--name-only", baseSha, "HEAD"]);
  if (diff === null) {
    console.log(`check-bump: could not diff ${baseSha}..HEAD — skipping (exit 0).`);
    process.exit(0);
  }

  const changedFiles = diff.split("\n").map((l) => l.trim()).filter(Boolean);

  // Map: pluginDir -> set of changed file paths (repo-relative, POSIX) under it.
  const changedByDir = new Map();
  for (const file of changedFiles) {
    const seg = file.split("/");
    const top = seg[0];
    if (seg.length === 1) {
      // Root-level file; ignored regardless of name (README/marketplace/LICENSE
      // explicitly, and anything else at root is not a plugin change either).
      continue;
    }
    if (NON_PLUGIN_TOP.has(top)) continue;
    if (IGNORED_ROOT_FILES.has(top)) continue; // defensive; root files have no slash anyway
    if (!isPluginDir(baseSha, top)) continue;
    if (!changedByDir.has(top)) changedByDir.set(top, new Set());
    changedByDir.get(top).add(file);
  }

  const errors = [];

  for (const dir of [...changedByDir.keys()].sort()) {
    // Skip dirs that no longer exist (plugin removed in this PR).
    if (!fs.existsSync(path.join(REPO_ROOT, dir))) continue;

    const curVer = currentVersion(dir);
    if (curVer === null) {
      // Manifest unreadable/removed but dir still present — can't validate.
      errors.push(`${dir}: cannot read current version from ${dir}/${MANIFEST_SUBPATH}`);
      continue;
    }

    const baseVer = baseVersion(baseSha, dir); // null => new plugin at this PR
    const filesChanged = changedByDir.get(dir);
    const nonChangelogChanged = [...filesChanged].some(
      (f) => f !== `${dir}/CHANGELOG.md`
    );

    // Rule 1: existing plugin, version unchanged, real content changed.
    if (baseVer !== null && curVer === baseVer && nonChangelogChanged) {
      errors.push(`${dir}: content changed but version not bumped (still ${curVer})`);
    }

    // Rule 2: CHANGELOG.md must have a matching section for the current version.
    if (!changelogHasVersion(dir, curVer)) {
      errors.push(`${dir}: CHANGELOG.md missing a '## [${curVer}]' section`);
    }
  }

  if (errors.length) {
    console.error(`check-bump: ${errors.length} error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log("ok");
  process.exit(0);
}

main();
