/**
 * catalog.mjs — reading plugin manifests and discovering plugin dirs.
 *
 * No third-party dependencies — Node built-ins only.
 */

import fs from "node:fs";
import path from "node:path";
import { IGNORED_DIRS, MANIFEST_SUBPATH } from "./constants.mjs";

/**
 * Read + JSON.parse a file, throwing a contextualized error on failure.
 * @param {string} filePath
 * @returns {*}
 */
export function readJson(filePath) {
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
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function discoverPluginDirs(repoRoot) {
  const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith(".")) continue;
    if (IGNORED_DIRS.has(name)) continue;
    if (fs.existsSync(path.join(repoRoot, name, MANIFEST_SUBPATH))) dirs.push(name);
  }
  dirs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return dirs;
}
