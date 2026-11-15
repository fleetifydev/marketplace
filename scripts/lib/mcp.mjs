/**
 * mcp.mjs — reading MCP server definitions from a plugin's `mcp.json`.
 *
 * Pure functions, shared by the validator and the security report.
 * No third-party dependencies.
 */

const PLACEHOLDER_RE = /\$\{([^}]*)\}/g;

// npm: an exact version, never a range or dist-tag.
const NPM_EXACT_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
// PyPI: an exact release (PEP 440-ish), no wildcards.
const PYPI_EXACT_RE = /^\d+(?:\.\d+)*[0-9A-Za-z.+-]*$/;

/** uvx flags that consume the next argument. */
const UVX_VALUE_FLAGS = new Set([
  "--python",
  "-p",
  "--with",
  "--with-requirements",
  "--index",
  "--index-url",
  "--extra-index-url",
  "--default-index",
]);

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

function npxSpec(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-p" || a === "--package") return args[i + 1] ?? null;
    if (a.startsWith("--package=")) return a.slice("--package=".length);
    if (a.startsWith("-")) continue;
    return a;
  }
  return null;
}

function uvxSpec(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--from") return args[i + 1] ?? null;
    if (a.startsWith("--from=")) return a.slice("--from=".length);
    if (UVX_VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    return a;
  }
  return null;
}

function parseNpm(spec) {
  const at = spec.lastIndexOf("@");
  const name = at > 0 ? spec.slice(0, at) : spec;
  const version = at > 0 ? spec.slice(at + 1) : null;
  return {
    ecosystem: "npm",
    name,
    version,
    pinned: version !== null && NPM_EXACT_RE.test(version),
    latest: version === "latest",
  };
}

function parsePypi(spec) {
  const m = spec.match(/^([A-Za-z0-9._-]+)(?:\[[^\]]*\])?\s*(.*)$/);
  if (!m) return { ecosystem: "pypi", name: spec, version: null, pinned: false, latest: false };
  const name = m[1];
  const rest = m[2].trim();
  let op = null;
  let version = null;
  if (rest.startsWith("==")) [op, version] = ["==", rest.slice(2).trim()];
  else if (rest.startsWith("@")) [op, version] = ["@", rest.slice(1).trim()];
  else if (rest) version = rest;
  const latest = version === "latest";
  const pinned = op !== null && !latest && version !== null && !version.includes("*") && PYPI_EXACT_RE.test(version);
  return { ecosystem: "pypi", name, version, pinned, latest };
}

/**
 * Which package a `stdio` server launches, and whether its version is pinned.
 * @param {string} command
 * @param {string[]} args
 * @returns {{ ecosystem: "npm"|"pypi", name: string, version: string|null, pinned: boolean, latest: boolean } | null}
 */
export function parsePackageSpec(command, args) {
  if (!Array.isArray(args)) return null;
  const strings = args.filter((a) => typeof a === "string");
  if (command === "npx") {
    const spec = npxSpec(strings);
    return spec ? parseNpm(spec) : null;
  }
  if (command === "uvx") {
    const spec = uvxSpec(strings);
    return spec ? parsePypi(spec) : null;
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
  const keysOf = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o) : []);
  const secretKeys = [];
  for (const p of findPlaceholders(s)) {
    if (p.kind === "secret" && !secretKeys.includes(p.key)) secretKeys.push(p.key);
  }
  return {
    id,
    transport: typeof s.type === "string" ? s.type : null,
    command,
    args,
    pkg: command ? parsePackageSpec(command, args) : null,
    url: typeof s.url === "string" ? s.url : null,
    envKeys: keysOf(s.env),
    secretKeys,
    headerKeys: keysOf(s.headers),
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
