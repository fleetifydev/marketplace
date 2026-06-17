#!/usr/bin/env node
/**
 * seed-changelogs.mjs
 *
 * One-time / occasional baseline seeder. For every top-level plugin dir that
 * has a `.fleetify-plugin/plugin.json` manifest but no `CHANGELOG.md`, write a
 * baseline `CHANGELOG.md` in [Keep a Changelog](https://keepachangelog.com/)
 * format with a single section for the plugin's current version.
 *
 * Idempotent: any plugin that already has a CHANGELOG.md is skipped, so the
 * script is safe to re-run after adding new plugins.
 *
 * No third-party dependencies — Node built-ins only (fs, path, url).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const MANIFEST_SUBPATH = path.join(".fleetify-plugin", "plugin.json");

/** Baseline date stamped on every seeded CHANGELOG section. */
const BASELINE_DATE = "2026-06-17";

/** Directory names that are never plugins. */
const IGNORED_DIRS = new Set([".git", "scripts", "node_modules"]);

/**
 * Render the baseline CHANGELOG body for a given version.
 * @param {string} version
 * @returns {string}
 */
function baselineChangelog(version) {
  return `# Changelog

All notable changes to this plugin are documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [${version}] - ${BASELINE_DATE}

### Added
- Initial release.
`;
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

function main() {
  const pluginDirs = discoverPluginDirs();

  let created = 0;
  let skipped = 0;

  for (const dir of pluginDirs) {
    const changelogPath = path.join(REPO_ROOT, dir, "CHANGELOG.md");
    if (fs.existsSync(changelogPath)) {
      skipped += 1;
      continue;
    }

    const manifestPath = path.join(REPO_ROOT, dir, MANIFEST_SUBPATH);
    let version;
    try {
      version = JSON.parse(fs.readFileSync(manifestPath, "utf8")).version;
    } catch (err) {
      console.error(`SKIP  ${dir}: cannot read version from manifest (${err.message})`);
      skipped += 1;
      continue;
    }
    if (typeof version !== "string" || version.length === 0) {
      console.error(`SKIP  ${dir}: manifest has no usable "version"`);
      skipped += 1;
      continue;
    }

    fs.writeFileSync(changelogPath, baselineChangelog(version));
    console.log(`CREATE ${dir}/CHANGELOG.md  (## [${version}] - ${BASELINE_DATE})`);
    created += 1;
  }

  console.log(`\nDone. Created ${created}, skipped ${skipped} (already had CHANGELOG.md), of ${pluginDirs.length} plugins.`);
}

main();
