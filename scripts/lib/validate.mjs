/**
 * validate.mjs — validate one plugin directory against the marketplace contract.
 *
 * Mirrors what the Fleet app enforces at install time (provider ids, layout,
 * name, semver) and adds marketplace-level consistency checks (declares
 * counts, secrets, metadata, launch allowlist). Never throws for data problems:
 * everything is reported as an Issue.
 *
 * @typedef {{ level: "error"|"warning", file: string, message: string }} Issue
 *
 * No third-party dependencies — Node built-ins only.
 */

import fs from "node:fs";
import path from "node:path";
import {
  ALLOWED_ENV_PLACEHOLDERS,
  ALLOWED_STDIO_COMMANDS,
  ALLOWED_TAGS,
  ALLOWED_TRANSPORTS,
  COMMAND_SUBDIRS,
  COMPONENT_PROVIDERS,
  DESCRIPTION_MAX,
  KNOWN_PROVIDERS,
  LEGACY_ROOT_DIRS,
  MANIFEST_SUBPATH,
  MARKETPLACE_TREE_URL,
  MAX_JSON_BYTES,
  MCP_SERVER_KEYS,
  NAME_RE,
  REFERENCE_DOC_URL,
  SCAFFOLD_MARKER,
  SECRET_KEY_RE,
  SEMVER_RE,
  VENDOR_DIRS,
} from "./constants.mjs";
import { findPlaceholders, parsePackageSpec } from "./mcp.mjs";

const VENDOR_DIR_NAMES = [...new Set(Object.values(VENDOR_DIRS))];
const ALLOWED_DOT_DIRS = new Set([".fleetify-plugin", ".fleetify", ...VENDOR_DIR_NAMES]);

const q = (v) => JSON.stringify(v);
const see = (anchor) => ` (see ${REFERENCE_DOC_URL}#${anchor})`;
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
const isStringMap = (v) => isPlainObject(v) && Object.values(v).every((x) => typeof x === "string");
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Every non-integer number token in raw JSON text (strings skipped). */
function nonIntegerNumbers(raw) {
  const found = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') {
      for (i++; i < raw.length && raw[i] !== '"'; i++) if (raw[i] === "\\") i++;
    } else if (c === "-" || (c >= "0" && c <= "9")) {
      const m = raw.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (m) {
        if (/[.eE]/.test(m[0])) found.push(m[0]);
        i += m[0].length - 1;
      }
    }
  }
  return found;
}

/** JSON paths of keys or string values that are not well-formed Unicode. */
function malformedStrings(value, at = "$") {
  const out = [];
  if (typeof value === "string") {
    if (!value.isWellFormed()) out.push(at);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...malformedStrings(v, `${at}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (!k.isWellFormed()) out.push(`${at} (a key)`);
      out.push(...malformedStrings(v, `${at}.${k.isWellFormed() ? k : "?"}`));
    }
  }
  return out;
}

/**
 * Read and parse a JSON file the way Fleet will: strictly. Returns `{ error }`
 * when unusable, else `{ value, problems }` (problems don't stop validation).
 * @param {string} abs
 * @param {{ integersOnly?: boolean }} [opts]
 */
function loadJson(abs, { integersOnly = false } = {}) {
  let raw;
  try {
    const size = fs.statSync(abs).size;
    if (size > MAX_JSON_BYTES) {
      return { error: `is too large (${Math.ceil(size / 1024)} KiB, max ${MAX_JSON_BYTES / 1024} KiB)` };
    }
    raw = fs.readFileSync(abs, "utf8");
  } catch (err) {
    return { error: `cannot be read (${err.code || err.message})` };
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return { error: `invalid JSON (${err.message}) — fix the JSON syntax` };
  }
  const problems = [];
  for (const at of malformedStrings(value)) {
    problems.push(`contains a string that is not well-formed Unicode (an unpaired surrogate) at ${at} — Fleet's strict JSON parser would reject the whole catalog`);
  }
  if (integersOnly) {
    for (const n of nonIntegerNumbers(raw)) {
      problems.push(`${JSON.stringify(n)} is not an integer — numbers in plugin.json must be whole numbers (e.g. 1, not 1.0)`);
    }
  }
  return { value, problems };
}

/** Number of `<name>/SKILL.md` skill dirs directly under `dir`. */
function countSkills(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isFile(path.join(dir, e.name, "SKILL.md"))).length;
}

/** Number of files with extension `ext` directly under `dir` (0 if absent). */
function countFiles(dir, ext) {
  if (!isDir(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(ext)).length;
}

/**
 * Every regular file and symlink under `dir`, as paths relative to `dir`
 * (sorted, recursive, symlinks never followed).
 * @returns {{ files: string[], symlinks: string[] }}
 */
function walkFiles(dir, prefix = "", out = { files: [], symlinks: [] }) {
  const entries = fs.readdirSync(path.join(dir, prefix), { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const rel = prefix ? path.join(prefix, e.name) : e.name;
    if (e.isSymbolicLink()) out.symlinks.push(rel);
    else if (e.isDirectory()) walkFiles(dir, rel, out);
    else if (e.isFile()) out.files.push(rel);
  }
  return out;
}

/**
 * Cross-plugin check: MCP server ids share one registry on users' machines,
 * so an id defined by two plugins lets one overwrite the other.
 * @param {Array<{ dir: string, serverIds: string[] }>} entries
 * @returns {Issue[]}
 */
export function findDuplicateServerIds(entries) {
  const owner = new Map();
  const issues = [];
  for (const { dir, serverIds } of entries) {
    for (const id of serverIds) {
      if (owner.has(id)) {
        issues.push({
          level: "error",
          file: `${dir}/mcp.json`,
          message: `server id ${q(id)} is also defined by ${owner.get(id)} — MCP server ids must be unique across the catalog`,
        });
      } else {
        owner.set(id, dir);
      }
    }
  }
  return issues;
}

/**
 * Where the app reads `subdir` (skills, agents) for `provider`: the
 * provider's own vendor dir, else the first one the plugin ships in
 * COMPONENT_PROVIDERS order (the app's canonical fan-out).
 * @param {string} pluginDir
 * @param {string} provider
 * @param {string} subdir
 * @returns {string|null}
 */
export function effectiveComponentDir(pluginDir, provider, subdir) {
  const own = VENDOR_DIRS[provider];
  if (!own) return null;
  if (isDir(path.join(pluginDir, own, subdir))) return path.join(pluginDir, own, subdir);
  for (const p of COMPONENT_PROVIDERS) {
    const candidate = path.join(pluginDir, VENDOR_DIRS[p], subdir);
    if (isDir(candidate)) return candidate;
  }
  return null;
}

/**
 * Where the app reads slash commands for `provider`: its own
 * `<vendor>/commands` (Codex: `.codex/prompts`), else `.claude/commands`.
 * Null for providers without a command surface.
 * @param {string} pluginDir
 * @param {string} provider
 * @returns {string|null}
 */
export function effectiveCommandDir(pluginDir, provider) {
  const sub = COMMAND_SUBDIRS[provider];
  if (!sub) return null;
  const own = path.join(pluginDir, VENDOR_DIRS[provider], sub);
  if (isDir(own)) return own;
  const fallback = path.join(pluginDir, ".claude", "commands");
  return isDir(fallback) ? fallback : null;
}

/**
 * Validate `<repoRoot>/<dirName>`.
 * @param {string} repoRoot
 * @param {string} dirName
 * @returns {{ manifest: object|null, issues: Issue[], serverIds: string[] }}
 */
export function validatePlugin(repoRoot, dirName) {
  const pluginDir = path.join(repoRoot, dirName);
  /** @type {Issue[]} */
  const issues = [];
  /** @type {string[]} */
  const serverIds = [];
  const rel = (...segs) => [dirName, ...segs.flatMap((s) => s.split(path.sep))].join("/");
  const relOf = (abs) => rel(path.relative(pluginDir, abs));
  const MF = rel(MANIFEST_SUBPATH);
  const error = (file, message) => issues.push({ level: "error", file, message });
  const warning = (file, message) => issues.push({ level: "warning", file, message });
  const isHttpsUrl = (v) => typeof v === "string" && v.startsWith("https://");

  const loaded = loadJson(path.join(pluginDir, MANIFEST_SUBPATH), { integersOnly: true });
  if (loaded.error) {
    error(MF, loaded.error);
    return { manifest: null, issues, serverIds };
  }
  for (const problem of loaded.problems) error(MF, problem);
  const manifest = loaded.value;
  if (!isPlainObject(manifest)) {
    error(MF, "manifest must be a JSON object");
    return { manifest: null, issues, serverIds };
  }
  if (manifest.provides !== undefined) {
    error(MF, `"provides" must not be set — Fleet derives it from "declares"; remove the field`);
  }

  // ── identity (mirrors the app) ───────────────────────────────────────────
  const { name, version } = manifest;
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    error(MF, `"name" must match /^[a-z0-9][a-z0-9-]*$/ (got ${q(name)})${see("manifest-fields")}`);
  } else if (name !== dirName) {
    error(MF, `"name" (${q(name)}) must equal the directory name (${q(dirName)}) — rename one to match`);
  }
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    error(MF, `"version" must be strict semver X.Y.Z (optional -pre/+build, no leading zeros) (got ${q(version)})`);
  }
  if (manifest.min_fleetify_version !== undefined && !(typeof manifest.min_fleetify_version === "string" && SEMVER_RE.test(manifest.min_fleetify_version))) {
    error(MF, `"min_fleetify_version" must be strict semver when present (got ${q(manifest.min_fleetify_version)})`);
  }

  // ── providers ────────────────────────────────────────────────────────────
  const providers = [];
  if (!Array.isArray(manifest.providers) || manifest.providers.length === 0) {
    error(MF, `"providers" must be a non-empty array (got ${q(manifest.providers)})${see("providers")}`);
  } else {
    manifest.providers.forEach((p, i) => {
      if (typeof p !== "string" || p.length === 0) {
        error(MF, `"providers[${i}]" must be a non-empty string (got ${q(p)})`);
      } else if (!KNOWN_PROVIDERS.includes(p)) {
        error(MF, `"providers[${i}]" ${q(p)} is not a known provider — use one of: ${KNOWN_PROVIDERS.join(", ")}${see("providers")}`);
      } else if (providers.includes(p)) {
        error(MF, `"providers" lists ${q(p)} more than once — remove the duplicate`);
      } else {
        providers.push(p);
      }
    });
  }

  // ── metadata ─────────────────────────────────────────────────────────────
  if (!nonEmpty(manifest.display_name)) {
    error(MF, `"display_name" must be a non-empty string — the name shown on the Browse card, e.g. "GitHub"${see("manifest-fields")}`);
  }
  const { description } = manifest;
  if (!nonEmpty(description)) {
    error(MF, `"description" must be a non-empty string — one line shown on the Browse card${see("manifest-fields")}`);
  } else if (/[\r\n]/.test(description)) {
    error(MF, `"description" must be a single line — remove the line breaks`);
  } else if (description.length > DESCRIPTION_MAX) {
    error(MF, `"description" is ${description.length} characters — keep it to at most ${DESCRIPTION_MAX}`);
  }
  if (!isPlainObject(manifest.author) || !nonEmpty(manifest.author.name)) {
    error(MF, `"author.name" must be a non-empty string — the person or organization maintaining the plugin${see("manifest-fields")}`);
  } else if (manifest.author.url !== undefined && !isHttpsUrl(manifest.author.url)) {
    error(MF, `"author.url" must be an https:// URL when present (got ${q(manifest.author.url)})`);
  }
  if (!Array.isArray(manifest.tags) || manifest.tags.length === 0) {
    error(MF, `"tags" must be a non-empty array — allowed: ${ALLOWED_TAGS.join(", ")}${see("manifest-fields")}`);
  } else {
    manifest.tags.forEach((t, i) => {
      if (!ALLOWED_TAGS.includes(t)) {
        error(MF, `"tags[${i}]" ${q(t)} is not an allowed tag — use one of: ${ALLOWED_TAGS.join(", ")}${see("manifest-fields")}`);
      }
    });
  }
  if (!isHttpsUrl(manifest.icon)) {
    error(MF, `"icon" must be an https:// URL, e.g. https://api.iconify.design/logos/github-icon.svg — Fleet does not render relative icon paths (got ${q(manifest.icon)})${see("manifest-fields")}`);
  } else {
    // api.iconify.design answers the old prefix:name.svg form with 404.
    const iconify = /^https:\/\/api\.iconify\.design\/([a-z0-9-]+):([a-z0-9-]+)\.svg$/i.exec(manifest.icon);
    if (iconify) {
      error(MF, `"icon" uses Iconify's old prefix:name form, which api.iconify.design answers with 404 — use https://api.iconify.design/${iconify[1]}/${iconify[2]}.svg${see("manifest-fields")}`);
    }
  }
  if (!nonEmpty(manifest.homepage) || !manifest.homepage.startsWith("https://")) {
    error(MF, `"homepage" must be an https:// URL (got ${q(manifest.homepage)}) — for plugins in this repo use ${MARKETPLACE_TREE_URL}/${dirName}`);
  }
  if (!nonEmpty(manifest.license)) {
    error(MF, `"license" must be a non-empty SPDX identifier, e.g. "MIT"${see("manifest-fields")}`);
  }

  // ── requires_secrets ─────────────────────────────────────────────────────
  const secretKeys = new Set();
  if (Object.prototype.hasOwnProperty.call(manifest, "requires_secrets")) {
    const rs = manifest.requires_secrets;
    if (!Array.isArray(rs)) {
      error(MF, `"requires_secrets" must be an array when present (got ${q(rs)})`);
    } else {
      rs.forEach((entry, i) => {
        const field = (k) => `"requires_secrets[${i}]${k ? `.${k}` : ""}"`;
        if (!isPlainObject(entry)) {
          error(MF, `${field()} must be an object (got ${q(entry)})`);
          return;
        }
        if (typeof entry.key !== "string" || entry.key.length === 0) {
          error(MF, `${field("key")} must be a non-empty string (got ${q(entry.key)})`);
        } else if (!SECRET_KEY_RE.test(entry.key)) {
          error(MF, `${field("key")} ${q(entry.key)} must be UPPER_SNAKE_CASE, e.g. "GITHUB_TOKEN"${see("secrets")}`);
        } else if (secretKeys.has(entry.key)) {
          error(MF, `${field("key")} ${q(entry.key)} is declared more than once — keep one entry per secret`);
        } else {
          secretKeys.add(entry.key);
        }
        if (typeof entry.label !== "string" || entry.label.length === 0) {
          error(MF, `${field("label")} must be a non-empty string (got ${q(entry.label)})`);
        }
        if (Object.prototype.hasOwnProperty.call(entry, "url") && !isHttpsUrl(entry.url)) {
          error(MF, `${field("url")} must be an https:// URL when present — it is the "get a token" link in the install dialog (got ${q(entry.url)})`);
        }
      });
    }
  }

  // ── layout ───────────────────────────────────────────────────────────────
  for (const d of LEGACY_ROOT_DIRS) {
    if (isDir(path.join(pluginDir, d))) {
      error(rel(d), `root-level "${d}/" is not allowed (Fleet rejects it at install) — put components under a vendor dir such as .claude/${d}/${see("providers")}`);
    }
  }
  for (const vendor of VENDOR_DIR_NAMES) {
    if (isDir(path.join(pluginDir, vendor, "hooks"))) {
      error(rel(vendor, "hooks"), `"${vendor}/hooks/" — hooks are not accepted yet; open an issue first${see("not-accepted-yet")}`);
    }
    if (isDir(path.join(pluginDir, vendor, "agents"))) {
      error(rel(vendor, "agents"), `"${vendor}/agents/" — sub-agents are not accepted yet; ship an agent template in templates/ instead${see("not-accepted-yet")}`);
    }
  }
  if (isDir(path.join(pluginDir, "workflows"))) {
    error(rel("workflows"), `"workflows/" — workflows are not accepted yet; open an issue first${see("not-accepted-yet")}`);
  }
  if (isDir(path.join(pluginDir, ".fleetify", "prompts"))) {
    error(rel(".fleetify", "prompts"), `".fleetify/prompts/" — Fleetify prompts are not accepted yet; open an issue first${see("not-accepted-yet")}`);
  }
  for (const e of fs.readdirSync(pluginDir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.startsWith(".") && !ALLOWED_DOT_DIRS.has(e.name)) {
      warning(rel(e.name), `unknown directory "${e.name}/" — Fleet ignores it; per-provider components go under ${VENDOR_DIR_NAMES.join(", ")}${see("providers")}`);
    }
  }

  // ── README / CHANGELOG / leftover scaffold markers ───────────────────────
  if (!isFile(path.join(pluginDir, "README.md"))) {
    error(rel("README.md"), "README.md is missing — describe what the plugin does, the secrets it needs, and link the upstream source");
  }
  const changelogPath = path.join(pluginDir, "CHANGELOG.md");
  if (!isFile(changelogPath)) {
    error(rel("CHANGELOG.md"), "CHANGELOG.md is missing — start from CHANGELOG_TEMPLATE.md");
  } else if (typeof version === "string") {
    const re = new RegExp(`^##\\s*\\[${escapeRegExp(version)}\\]`, "m");
    if (!re.test(fs.readFileSync(changelogPath, "utf8"))) {
      error(rel("CHANGELOG.md"), `CHANGELOG.md has no "## [${version}]" section — add one for the current version (see CHANGELOG_TEMPLATE.md)`);
    }
  }
  const { files, symlinks } = walkFiles(pluginDir);
  for (const link of symlinks) {
    error(rel(link), "symlinks are not allowed — commit the file itself (Fleet's installer follows symlinks on the user's machine)");
  }
  for (const f of files) {
    if (!f.endsWith(".md") && !f.endsWith(".json")) continue;
    if (fs.readFileSync(path.join(pluginDir, f), "utf8").includes(SCAFFOLD_MARKER)) {
      error(rel(f), `still contains the scaffold marker ${SCAFFOLD_MARKER} — replace every ${SCAFFOLD_MARKER} placeholder with real content`);
    }
  }

  // ── mcp.json ─────────────────────────────────────────────────────────────
  const MCP = rel("mcp.json");
  const mcpPath = path.join(pluginDir, "mcp.json");
  const usedSecrets = new Set();
  let mcpExists = false;
  let mcpCount = 0; // null once mcp.json is unusable
  if (isFile(mcpPath)) {
    mcpExists = true;
    const mcp = loadJson(mcpPath);
    for (const problem of mcp.problems || []) error(MCP, problem);
    if (mcp.error) {
      error(MCP, mcp.error);
      mcpCount = null;
    } else if (!isPlainObject(mcp.value) || !isPlainObject(mcp.value.mcpServers)) {
      error(MCP, `mcp.json must be an object with an "mcpServers" object${see("mcpjson")}`);
      mcpCount = null;
    } else {
      const entries = Object.entries(mcp.value.mcpServers);
      mcpCount = entries.length;
      if (mcpCount === 0) error(MCP, `mcp.json defines no servers — add a server or delete mcp.json${see("mcpjson")}`);
      for (const [id, server] of entries) {
        const at = `server ${q(id)}`;
        serverIds.push(id);
        if (id !== dirName && !id.startsWith(`${dirName}-`)) {
          error(MCP, `server id ${q(id)} must be ${q(dirName)} or start with ${q(`${dirName}-`)} — server ids share one registry across all plugins${see("mcpjson")}`);
        }
        if (!isPlainObject(server)) {
          error(MCP, `${at} must be an object`);
          continue;
        }
        for (const k of Object.keys(server)) {
          if (!MCP_SERVER_KEYS.includes(k)) {
            error(MCP, `${at}: unknown key ${q(k)} — Fleet passes every key to the agents, so only ${MCP_SERVER_KEYS.join(", ")} are allowed${see("mcpjson")}`);
          }
        }
        if (!ALLOWED_TRANSPORTS.includes(server.type)) {
          error(MCP, `${at}: "type" must be one of ${ALLOWED_TRANSPORTS.join(", ")} (got ${q(server.type)})${see("mcpjson")}`);
          continue;
        }
        if (server.type === "stdio") {
          const allowed = ALLOWED_STDIO_COMMANDS.includes(server.command);
          if (!allowed) {
            error(MCP, `${at}: command ${q(server.command)} is not allowed — stdio servers must launch with ${ALLOWED_STDIO_COMMANDS.join(" or ")} (npm or PyPI packages)${see("mcpjson")}`);
          }
          if (!isStringArray(server.args)) {
            error(MCP, `${at}: "args" must be an array of strings`);
          } else if (
            allowed &&
            !parsePackageSpec(server.command, server.args) &&
            !server.args.some((a) => a.includes(SCAFFOLD_MARKER)) // already reported as a leftover placeholder
          ) {
            error(MCP, `${at}: "args" must start with the package to launch — npx allows only -y before it, uvx only --from <package>, and the package must come from npm or PyPI (e.g. ["-y", "@scope/server"])${see("mcpjson")}`);
          }
          if (server.env !== undefined && !isStringMap(server.env)) {
            error(MCP, `${at}: "env" must be an object of string values`);
          }
        } else {
          if (typeof server.url !== "string" || !server.url.startsWith("https://")) {
            error(MCP, `${at}: "url" must start with https:// (got ${q(server.url)})${see("mcpjson")}`);
          }
          if (server.headers !== undefined && !isStringMap(server.headers)) {
            error(MCP, `${at}: "headers" must be an object of string values`);
          }
        }
      }
      const reported = new Set();
      for (const p of findPlaceholders(mcp.value)) {
        if (p.kind === "secret") usedSecrets.add(p.key);
        if (reported.has(p.raw)) continue;
        reported.add(p.raw);
        if (p.kind === "unknown") {
          error(MCP, `unsupported placeholder ${p.raw} — use \${secret:KEY} or \${env:HOME}${see("secrets")}`);
        } else if (p.kind === "env" && !ALLOWED_ENV_PLACEHOLDERS.includes(p.key)) {
          error(MCP, `${p.raw} is not allowed — only ${ALLOWED_ENV_PLACEHOLDERS.map((k) => `\${env:${k}}`).join(", ")} may be read from the user's environment; ask for credentials with \${secret:KEY}${see("mcpjson")}`);
        } else if (p.kind === "secret" && !secretKeys.has(p.key)) {
          error(MCP, `${p.raw} is not declared in "requires_secrets" — add { "key": "${p.key}", "label": "…" } to plugin.json${see("secrets")}`);
        }
      }
    }
  }
  if (mcpCount !== null) {
    for (const k of secretKeys) {
      if (!usedSecrets.has(k)) {
        warning(MF, `"requires_secrets" key ${q(k)} is never used in mcp.json — remove it, or reference it as \${secret:${k}}`);
      }
    }
  }

  // ── declares ─────────────────────────────────────────────────────────────
  const { declares } = manifest;
  if (!isPlainObject(declares)) {
    error(MF, `"declares" must be present and an object (got ${q(declares)})${see("declares")}`);
    return { manifest, issues, serverIds };
  }
  const count = (obj, field, label) => {
    const v = obj[field];
    if (v === undefined) return 0;
    if (!Number.isInteger(v) || v < 0) {
      error(MF, `"${label}" must be a non-negative integer (got ${q(v)})`);
      return null;
    }
    return v;
  };

  const mcpDeclared = count(declares, "mcp_servers", "declares.mcp_servers");
  if (mcpDeclared !== null && mcpCount !== null) {
    if (!mcpExists && mcpDeclared > 0) {
      error(MF, `"declares.mcp_servers" is ${mcpDeclared} but there is no mcp.json — add mcp.json or set it to 0${see("declares")}`);
    } else if (mcpExists && mcpCount > 0 && mcpDeclared !== mcpCount) {
      error(MF, `"declares.mcp_servers" is ${mcpDeclared} but mcp.json defines ${mcpCount} server(s) — set it to ${mcpCount}${see("declares")}`);
    }
  }

  const templatesDeclared = count(declares, "templates", "declares.templates");
  const templatesActual = countFiles(path.join(pluginDir, "templates"), ".md");
  if (templatesDeclared !== null && templatesDeclared !== templatesActual) {
    error(MF, `"declares.templates" is ${templatesDeclared} but ${templatesActual} template(s) exist in templates/ — set it to ${templatesActual}${see("declares")}`);
  }

  for (const field of ["workflows", "prompts"]) {
    const v = count(declares, field, `declares.${field}`);
    if (v) {
      error(MF, `"declares.${field}" is ${v} — ${field} are not accepted yet; set it to 0 and open an issue first${see("not-accepted-yet")}`);
    }
  }

  if (declares.providers !== undefined && !isPlainObject(declares.providers)) {
    error(MF, `"declares.providers" must be an object keyed by provider id${see("declares")}`);
    return { manifest, issues, serverIds };
  }
  const perProvider = declares.providers || {};
  for (const key of Object.keys(perProvider)) {
    if (!providers.includes(key)) {
      error(MF, `"declares.providers.${key}" is not listed in "providers" — add it to "providers" or remove the entry${see("declares")}`);
    }
  }
  for (const p of providers) {
    const entry = perProvider[p] === undefined ? {} : perProvider[p];
    if (!isPlainObject(entry)) {
      error(MF, `"declares.providers.${p}" must be an object`);
      continue;
    }
    const label = (k) => `declares.providers.${p}.${k}`;
    const skillsDir = effectiveComponentDir(pluginDir, p, "skills");
    const skillsActual = skillsDir ? countSkills(skillsDir) : 0;
    const skillsDeclared = count(entry, "skills", label("skills"));
    if (skillsDeclared !== null && skillsDeclared !== skillsActual) {
      const from = skillsDir ? ` from ${relOf(skillsDir)}/` : "";
      error(MF, `"${label("skills")}" is ${skillsDeclared} but ${skillsActual} skill(s) would be installed${from} — set it to ${skillsActual}${see("declares")}`);
    }
    const commandsDir = effectiveCommandDir(pluginDir, p);
    const commandsActual = commandsDir ? countFiles(commandsDir, ".md") : 0;
    const commandsDeclared = count(entry, "commands", label("commands"));
    if (commandsDeclared !== null && commandsDeclared !== commandsActual) {
      const from = commandsDir ? ` from ${relOf(commandsDir)}/` : "";
      error(MF, `"${label("commands")}" is ${commandsDeclared} but ${commandsActual} command(s) would be installed${from} — set it to ${commandsActual}${see("declares")}`);
    }
    const hooksDeclared = count(entry, "hooks", label("hooks"));
    if (hooksDeclared) {
      error(MF, `"${label("hooks")}" is ${hooksDeclared} — hooks are not accepted yet; set it to 0 and open an issue first${see("not-accepted-yet")}`);
    }
  }

  return { manifest, issues, serverIds };
}
