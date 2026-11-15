/**
 * mcp.mjs — reading MCP server definitions from a plugin's `mcp.json`.
 *
 * Pure functions, shared by the validator and the security report.
 * No third-party dependencies.
 */

import { MCP_SERVER_KEYS } from "./constants.mjs";

const PLACEHOLDER_RE = /\$\{([^}]*)\}/g;

// Registry package specs. Anything else (git URLs, tarballs, paths, aliases,
// custom registries) is not a plain npm/PyPI package and must not parse.
const NPM_SPEC_RE = /^((?:@[A-Za-z0-9][A-Za-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*)(?:@([0-9A-Za-z.^~<>=*+-]+))?$/;
const PYPI_SPEC_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[A-Za-z0-9._,-]*\])?(?:(==|@)([0-9A-Za-z.*+!-]+))?$/;

// npm: an exact version, never a range or dist-tag.
const NPM_EXACT_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
// PyPI: an exact release (PEP 440-ish), no wildcards.
const PYPI_EXACT_RE = /^\d+(?:\.\d+)*[0-9A-Za-z.+-]*$/;

/**
 * Every `${…}` placeholder inside string values (objects and arrays walked
 * recursively, in key order).
 * @param {*} value
 * @returns {Array<{ raw: string, kind: "secret"|"env"|"unknown", key: string }>}
 */
export function findPlaceholders(value) {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(PLACEHOLDER_RE)) {
        const inner = m[1];
        if (inner.startsWith("secret:")) out.push({ raw: m[0], kind: "secret", key: inner.slice(7) });
        else if (inner.startsWith("env:")) out.push({ raw: m[0], kind: "env", key: inner.slice(4) });
        else out.push({ raw: m[0], kind: "unknown", key: inner });
      }
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return out;
}

function parseNpm(spec) {
  const m = typeof spec === "string" ? spec.match(NPM_SPEC_RE) : null;
  if (!m) return null;
  const version = m[2] ?? null;
  return {
    ecosystem: "npm",
    name: m[1],
    version,
    pinned: version !== null && NPM_EXACT_RE.test(version),
    latest: version === "latest",
  };
}

function parsePypi(spec) {
  const m = typeof spec === "string" ? spec.match(PYPI_SPEC_RE) : null;
  if (!m) return null;
  const op = m[2] ?? null;
  const version = m[3] ?? null;
  const latest = version === "latest";
  const pinned = op !== null && !latest && version !== null && !version.includes("*") && PYPI_EXACT_RE.test(version);
  return { ecosystem: "pypi", name: m[1], version, pinned, latest };
}

/**
 * Which registry package a `stdio` server launches, and whether its version
 * is pinned. Only the plain shapes are recognized, and anything else returns
 * null:
 *   npx [-y|--yes]… <npm-package>[@version] [server args…]
 *   uvx <pypi-package>[==version|@version] [server args…]
 *   uvx --from <pypi-package>[==version] <command> [server args…]
 * @param {string} command
 * @param {string[]} args
 * @returns {{ ecosystem: "npm"|"pypi", name: string, version: string|null, pinned: boolean, latest: boolean } | null}
 */
export function parsePackageSpec(command, args) {
  if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) return null;
  if (command === "npx") {
    let i = 0;
    while (args[i] === "-y" || args[i] === "--yes") i++;
    return parseNpm(args[i]);
  }
  if (command === "uvx") {
    if (args[0] === "--from") return args.length >= 3 ? parsePypi(args[1]) : null;
    return parsePypi(args[0]);
  }
  return null;
}

/**
 * A normalized, display-ready view of one MCP server definition.
 * @param {string} id
 * @param {object} server
 */
export function summarizeServer(id, server) {
  const s = server && typeof server === "object" && !Array.isArray(server) ? server : {};
  const command = typeof s.command === "string" ? s.command : null;
  const args = Array.isArray(s.args) ? s.args.map(String) : [];
  const mapOf = (o) =>
    o && typeof o === "object" && !Array.isArray(o)
      ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]))
      : {};
  const secretKeys = [];
  const envReads = [];
  for (const p of findPlaceholders(s)) {
    if (p.kind === "secret" && !secretKeys.includes(p.key)) secretKeys.push(p.key);
    if (p.kind === "env" && !envReads.includes(p.key)) envReads.push(p.key);
  }
  const env = mapOf(s.env);
  const headers = mapOf(s.headers);
  return {
    id,
    transport: typeof s.type === "string" ? s.type : null,
    command,
    args,
    pkg: command ? parsePackageSpec(command, args) : null,
    url: typeof s.url === "string" ? s.url : null,
    env,
    envKeys: Object.keys(env),
    headers,
    headerKeys: Object.keys(headers),
    secretKeys,
    envReads,
    extraKeys: Object.keys(s).filter((k) => !MCP_SERVER_KEYS.includes(k)),
    extras: Object.fromEntries(Object.entries(s).filter(([k]) => !MCP_SERVER_KEYS.includes(k))),
  };
}

/**
 * Registry page for a package (static URL, no network).
 * @param {{ ecosystem: "npm"|"pypi", name: string }} pkg
 * @returns {string}
 */
export function packageUrl(pkg) {
  return pkg.ecosystem === "pypi"
    ? `https://pypi.org/project/${pkg.name}/`
    : `https://www.npmjs.com/package/${pkg.name}`;
}
