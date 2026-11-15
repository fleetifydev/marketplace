#!/usr/bin/env node
/**
 * security-report.mjs — summarize what a change does to users' machines, for
 * the maintainer reviewing it.
 *
 * Usage:
 *   node scripts/security-report.mjs <base> [head=HEAD] [--json]
 *
 * Classifies every file changed in `<base>...<head>` (merge-base semantics):
 * plugin MCP servers (field by field: command, package + pin status, args,
 * URL, env and header values, unknown keys), secrets, providers and links,
 * agent-facing files (skills, templates, …), other files inside plugins, CI
 * and agent/editor tooling, and anything it cannot classify. It fails closed:
 * unclassified or unreadable files are always reported.
 *
 * SECURITY: this script is run by a `pull_request_target` workflow with a
 * write-scoped token. It must only READ the PR as data: `git diff`, `git show`
 * and `JSON.parse`. Never execute, import, or install anything from the PR,
 * and render every PR-derived value through `code()`.
 *
 * No third-party dependencies — Node built-ins only.
 */

import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { MANIFEST_SUBPATH } from "./lib/constants.mjs";
import { packageUrl, summarizeServer } from "./lib/mcp.mjs";

export const MARKER = "<!-- fleetify-security-review -->";
const USAGE = "Usage: node scripts/security-report.mjs <base> [head=HEAD] [--json]";
const MAX_VALUE = 200;
const MAX_COMMENT = 60000; // GitHub rejects comment bodies over 65,536 characters
const READ_LIMIT = 4 * 1024 * 1024; // per file; the validator caps JSON at 256 KiB

/** Top-level dirs that change CI or tools maintainers run when checking a PR out. */
const TOOLING_DIRS = new Set([
  "scripts", ".github", ".claude", ".codex", ".cursor", ".vscode", ".idea", ".zed",
  ".gemini", ".agy", ".grok", ".kimi", ".opencode", ".github-copilot", ".hermes",
  ".fleetify", ".devcontainer", ".husky",
]);
/** Repo-root files read by agents, editors or tooling. */
const TOOLING_ROOT_FILES = new Set([
  ".mcp.json", "CLAUDE.md", "AGENTS.md", "GEMINI.md", ".cursorrules", ".windsurfrules",
  ".clinerules", ".envrc", ".gitattributes", ".gitmodules", ".npmrc", ".nvmrc",
  ".node-version", "package.json", "package-lock.json", "Makefile", "justfile",
]);
/** Generated, and verified by CI. */
const IGNORED_ROOT_FILES = new Set(["marketplace.json"]);

function git(cwd, args, maxBuffer = 64 * 1024 * 1024) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer });
}

function tryGit(cwd, args, maxBuffer) {
  try {
    return git(cwd, args, maxBuffer);
  } catch {
    return null;
  }
}

/**
 * A JSON file at a revision. Fails closed: a file that exists but can't be
 * read or parsed is an error, never "missing".
 * @returns {{ exists: boolean, value?: any, error?: string }}
 */
function readJsonAt(cwd, rev, file) {
  if (tryGit(cwd, ["cat-file", "-e", `${rev}:${file}`]) === null) return { exists: false };
  const raw = tryGit(cwd, ["show", `${rev}:${file}`], READ_LIMIT);
  if (raw === null) return { exists: true, error: `could not be read (larger than ${READ_LIMIT / 1024 / 1024} MiB?)` };
  try {
    return { exists: true, value: JSON.parse(raw) };
  } catch (err) {
    return { exists: true, error: `is not valid JSON: ${err.message}` };
  }
}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const stringsOf = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const providersOf = (m) => stringsOf(isPlainObject(m) ? m.providers : []);
const authorOf = (m) => (isPlainObject(m) && isPlainObject(m.author) && typeof m.author.name === "string" ? m.author.name : null);
const serversOf = (doc) => (isPlainObject(doc) && isPlainObject(doc.mcpServers) ? doc.mcpServers : {});
const secretsOf = (m) =>
  isPlainObject(m) && Array.isArray(m.requires_secrets) ? m.requires_secrets.filter((s) => isPlainObject(s) && typeof s.key === "string") : [];

/** URL-like manifest fields users click or Fleet loads. */
function linksOf(m) {
  const links = {};
  if (!isPlainObject(m)) return links;
  for (const field of ["icon", "homepage"]) if (m[field] !== undefined) links[field] = m[field];
  if (isPlainObject(m.author) && m.author.url !== undefined) links["author.url"] = m.author.url;
  for (const s of secretsOf(m)) if (s.url !== undefined) links[`requires_secrets.${s.key}.url`] = s.url;
  return links;
}

/** Where a changed file inside a plugin belongs. */
function classifyPluginFile(relInPlugin) {
  if (relInPlugin === MANIFEST_SUBPATH) return "manifest";
  if (relInPlugin === "mcp.json") return "mcp";
  if (relInPlugin === "README.md" || relInPlugin === "CHANGELOG.md") return "docs";
  const top = relInPlugin.split("/")[0];
  if (top !== ".fleetify-plugin" && (top.startsWith(".") || top === "templates" || top === "workflows") && relInPlugin.includes("/")) {
    return "content";
  }
  return "other";
}

/** Field-by-field diff of two raw server objects (`env.X`, `headers.X`, others whole). */
function serverFieldChanges(before, after) {
  const flat = (s) => {
    const out = {};
    if (!isPlainObject(s)) return out;
    for (const [k, v] of Object.entries(s)) {
      if ((k === "env" || k === "headers") && isPlainObject(v)) {
        for (const [ek, ev] of Object.entries(v)) out[`${k}.${ek}`] = ev;
      } else {
        out[k] = v;
      }
    }
    return out;
  };
  const a = flat(before);
  const b = flat(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ field: k, before: hasOwn(a, k) ? a[k] : undefined, after: hasOwn(b, k) ? b[k] : undefined }));
}

function pluginChange(cwd, from, to, dir, paths) {
  const manifestPath = `${dir}/${MANIFEST_SUBPATH}`;
  const mcpPath = `${dir}/mcp.json`;
  const mBefore = readJsonAt(cwd, from, manifestPath);
  const mAfter = readJsonAt(cwd, to, manifestPath);
  const cBefore = readJsonAt(cwd, from, mcpPath);
  const cAfter = readJsonAt(cwd, to, mcpPath);

  const errors = [];
  if (mBefore.error) errors.push(`${manifestPath} (base) ${mBefore.error}`);
  if (mAfter.error) errors.push(`${manifestPath} ${mAfter.error}`);
  if (cBefore.error) errors.push(`${mcpPath} (base) ${cBefore.error}`);
  if (cAfter.error) errors.push(`${mcpPath} ${cAfter.error}`);

  const status = !mBefore.exists ? "added" : !mAfter.exists ? "removed" : "modified";

  // Never diff servers against an unreadable side: that would claim removals.
  const servers = [];
  if (!cBefore.error && !cAfter.error) {
    const before = serversOf(cBefore.value);
    const after = serversOf(cAfter.value);
    for (const id of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const inBefore = hasOwn(before, id);
      const inAfter = hasOwn(after, id);
      if (!inBefore) {
        servers.push({ id, status: "added", before: null, after: summarizeServer(id, after[id]), fields: [] });
      } else if (!inAfter) {
        servers.push({ id, status: "removed", before: summarizeServer(id, before[id]), after: null, fields: [] });
      } else if (JSON.stringify(before[id]) !== JSON.stringify(after[id])) {
        servers.push({
          id,
          status: "changed",
          before: summarizeServer(id, before[id]),
          after: summarizeServer(id, after[id]),
          fields: serverFieldChanges(before[id], after[id]),
        });
      }
    }
  }

  const keysBefore = secretsOf(mBefore.value).map((s) => s.key);
  const secretsAfter = secretsOf(mAfter.value);
  const keysAfter = secretsAfter.map((s) => s.key);
  const providersBefore = providersOf(mBefore.value);
  const linksBefore = linksOf(mBefore.value);
  const linksAfter = linksOf(mAfter.value);
  const linkChanges = [];
  if (status === "modified") {
    for (const field of [...new Set([...Object.keys(linksBefore), ...Object.keys(linksAfter)])].sort()) {
      if (JSON.stringify(linksBefore[field]) !== JSON.stringify(linksAfter[field])) {
        linkChanges.push({ field, from: linksBefore[field] ?? null, to: linksAfter[field] ?? null });
      }
    }
  }
  const authorBefore = authorOf(mBefore.value);
  const authorAfter = authorOf(mAfter.value);
  const byKind = (kind) => paths.filter((p) => classifyPluginFile(p.slice(dir.length + 1)) === kind).sort();

  return {
    name: dir,
    status,
    servers,
    secretsAdded: keysAfter.filter((k) => !keysBefore.includes(k)),
    secretsRemoved: keysBefore.filter((k) => !keysAfter.includes(k)),
    secretLinks: status === "added" ? secretsAfter.filter((s) => s.url !== undefined).map((s) => ({ key: s.key, url: s.url })) : [],
    providersAdded: status === "modified" ? providersOf(mAfter.value).filter((p) => !providersBefore.includes(p)) : [],
    contentFiles: byKind("content"),
    otherFiles: status === "removed" ? [] : byKind("other"),
    linkChanges,
    author: status === "modified" && authorBefore !== authorAfter ? { from: authorBefore, to: authorAfter } : null,
    errors,
  };
}

/** Does this plugin change what runs on (or is fed to agents on) users' machines? */
function isRuntimeChange(p) {
  if (p.errors.length > 0 || p.status === "added") return true;
  if (p.status === "removed") return false;
  return [p.servers, p.contentFiles, p.otherFiles, p.linkChanges, p.secretsAdded, p.secretsRemoved, p.providersAdded].some(
    (list) => list.length > 0
  );
}

/**
 * @param {{ cwd: string, base: string, head?: string }} opts
 */
export function buildReport({ cwd, base, head = "HEAD" }) {
  const headSha = git(cwd, ["rev-parse", "--verify", `${head}^{commit}`]).trim();
  const baseSha = git(cwd, ["rev-parse", "--verify", `${base}^{commit}`]).trim();
  const from = (tryGit(cwd, ["merge-base", baseSha, headSha]) || baseSha).trim();
  const isPluginDir = (dir) =>
    tryGit(cwd, ["cat-file", "-e", `${from}:${dir}/${MANIFEST_SUBPATH}`]) !== null ||
    tryGit(cwd, ["cat-file", "-e", `${headSha}:${dir}/${MANIFEST_SUBPATH}`]) !== null;

  const parts = git(cwd, ["diff", "--name-status", "--no-renames", "-z", from, headSha]).split("\0").filter(Boolean);
  const tooling = [];
  const other = [];
  const byDir = new Map();
  const pluginCache = new Map();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const file = parts[i + 1];
    const segs = file.split("/");
    if (segs.length === 1) {
      if (IGNORED_ROOT_FILES.has(file)) continue;
      if (TOOLING_ROOT_FILES.has(file)) tooling.push(file);
      else if (file === "LICENSE" || file.endsWith(".md")) continue; // root docs
      else other.push(file);
      continue;
    }
    const top = segs[0];
    if (TOOLING_DIRS.has(top)) {
      tooling.push(file);
      continue;
    }
    if (top === "docs") continue;
    if (!pluginCache.has(top)) pluginCache.set(top, isPluginDir(top));
    if (pluginCache.get(top)) {
      if (!byDir.has(top)) byDir.set(top, []);
      byDir.get(top).push(file);
    } else {
      other.push(file);
    }
  }

  const plugins = [...byDir.keys()].sort().map((dir) => pluginChange(cwd, from, headSha, dir, byDir.get(dir)));
  tooling.sort();
  other.sort();

  const runtimeChanged = plugins.some(isRuntimeChange) || tooling.length > 0 || other.length > 0;
  const labels = [];
  if (plugins.some((p) => p.status === "added")) labels.push("new-plugin");
  if (plugins.some((p) => p.status === "modified")) labels.push("plugin-update");
  if (runtimeChanged) labels.push("security-review");
  if (tooling.length > 0) labels.push("tooling");
  return {
    plugins,
    tooling,
    other,
    labels,
    runtimeChanged,
    reportable: plugins.length > 0 || tooling.length > 0 || other.length > 0,
  };
}

// ── rendering ───────────────────────────────────────────────────────────────

// Bidi overrides/isolates, zero-width and other invisible format characters.
const INVISIBLE_RANGES = [
  [0x200b, 0x200f], // zero-width spaces/joiners, LRM/RLM
  [0x202a, 0x202e], // bidi embeddings/overrides
  [0x2060, 0x2064], // word joiner, invisible operators
  [0x2066, 0x2069], // bidi isolates
  [0x2028, 0x2029], // line/paragraph separators
  [0xfeff, 0xfeff], // zero-width no-break space / BOM
];
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, "0");
const INVISIBLE_RE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => `\\u${hex4(a)}-\\u${hex4(b)}`).join("")}]`, "g");
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const escapeChar = (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * Render a PR-derived value inertly: inline code with no backticks, newlines,
 * control or invisible characters, truncated. The ONLY way PR text may enter
 * the comment.
 * @param {*} value
 * @returns {string}
 */
export function code(value) {
  let s = typeof value === "string" ? value : value === undefined ? "(none)" : JSON.stringify(value);
  s = String(s ?? "")
    .replace(/`/g, "'")
    .replace(/\s*[\r\n\t]+\s*/g, " ")
    .replace(INVISIBLE_RE, escapeChar)
    .replace(CONTROL_RE, escapeChar);
  if (s.length > MAX_VALUE) s = `${s.slice(0, MAX_VALUE)}…`;
  if (s.trim() === "") s = "(empty)";
  return `\`${s}\``;
}

const list = (values) => values.map(code).join(", ");
const entries = (map) => Object.entries(map).map(([k, v]) => `${code(k)} ← ${code(v)}`).join(", ");

function versionOf(pkg) {
  if (pkg.pinned) return `${code(pkg.version)} (pinned)`;
  if (pkg.version) return `${code(pkg.version)} ⚠️ unpinned`;
  return "none ⚠️ unpinned — resolves to the newest release at every launch";
}

function renderServer(change) {
  const lines = [`- **MCP server ${code(change.id)}** — ${change.status}`];
  if (change.status === "removed") return lines;
  const s = change.after;
  lines.push(`  - transport: ${code(s.transport)}${s.command ? ` · command: ${code(s.command)}` : ""}`);
  if (s.pkg) {
    const b = change.before && change.before.pkg;
    let version = versionOf(s.pkg);
    if (b && b.name === s.pkg.name && b.version !== s.pkg.version) version = `${code(b.version ?? "none")} → ${version}`;
    // parsePackageSpec only returns plain registry names, so the link is safe.
    const link = ` · [${s.pkg.ecosystem === "npm" ? "npm" : "PyPI"} ↗](${packageUrl(s.pkg)})`;
    lines.push(`  - package (${s.pkg.ecosystem}): ${code(s.pkg.name)} — version ${version}${link}`);
  } else if (s.command) {
    lines.push("  - ⚠️ unrecognized launch — not a plain npm/PyPI package; read the args carefully");
  }
  if (s.args.length) lines.push(`  - args: ${s.args.map(code).join(" ")}`);
  if (s.url) lines.push(`  - url: ${code(s.url)}`);
  if (s.envKeys.length) lines.push(`  - env: ${entries(s.env)}`);
  if (s.headerKeys.length) lines.push(`  - headers: ${entries(s.headers)}`);
  if (s.secretKeys.length) lines.push(`  - secrets used: ${list(s.secretKeys)}`);
  if (s.envReads.length) lines.push(`  - ⚠️ reads environment variable(s): ${list(s.envReads)}`);
  for (const [k, v] of Object.entries(s.extras)) {
    lines.push(`  - ⚠️ unknown key ${code(k)} (Fleet forwards it to the agent): ${code(v)}`);
  }
  if (change.status === "changed" && change.fields.length) {
    lines.push(`  - changed: ${change.fields.map((f) => `${code(f.field)} ${code(f.before)} → ${code(f.after)}`).join(" · ")}`);
  }
  return lines;
}

function renderPlugin(p) {
  const lines = [`#### ${code(p.name)} — ${p.status}`, ""];
  if (p.status === "removed") {
    lines.push("Plugin removed from the catalog.");
    return lines;
  }
  for (const e of p.errors) lines.push(`- ⚠️ ${code(e)} — review this file manually`);
  for (const change of p.servers) lines.push(...renderServer(change));
  if (p.secretsAdded.length) {
    lines.push(`- ${p.status === "added" ? "requests secrets" : "new secrets requested"}: ${list(p.secretsAdded)}`);
  }
  for (const s of p.secretLinks) lines.push(`  - ${code(s.key)} "get a token" link: ${code(s.url)}`);
  if (p.secretsRemoved.length) lines.push(`- secrets no longer requested: ${list(p.secretsRemoved)}`);
  if (p.providersAdded.length) lines.push(`- now also installs for: ${list(p.providersAdded)}`);
  for (const l of p.linkChanges) lines.push(`- link changed — ${code(l.field)}: ${code(l.from)} → ${code(l.to)}`);
  if (p.author) lines.push(`- author changed: ${code(p.author.from)} → ${code(p.author.to)}`);
  if (p.contentFiles.length) {
    lines.push("- agent-facing files changed (read them in full):");
    for (const f of p.contentFiles) lines.push(`  - ${code(f)}`);
  }
  if (p.otherFiles.length) {
    lines.push("- ⚠️ other files in the plugin changed (Fleet copies the whole folder to users' machines):");
    for (const f of p.otherFiles) lines.push(`  - ${code(f)}`);
  }
  if (!isRuntimeChange(p)) lines.push("- Documentation or metadata only — no runtime change.");
  return lines;
}

/**
 * @param {ReturnType<typeof buildReport>} report
 * @returns {string}
 */
export function renderMarkdown(report) {
  const head = [MARKER, "### 🔒 Security review summary", ""];
  if (!report.reportable) return `${[...head, "No plugin runtime or tooling changes detected."].join("\n")}\n`;
  head.push(
    "What this pull request changes on users' machines, generated from the diff by `scripts/security-report.mjs`. A Fleetify maintainer reviews every item below before merging.",
    ""
  );
  const body = [];
  for (const p of report.plugins) body.push(...renderPlugin(p), "");
  if (report.tooling.length) {
    body.push("#### Tooling", "", "These files change what CI enforces or what tools run when the PR is checked out:", "");
    for (const f of report.tooling) body.push(`- ${code(f)}`);
    body.push("");
  }
  if ((report.other || []).length) {
    body.push("#### Other changed files", "", "⚠️ Not recognized as plugin, docs or tooling files — review them:", "");
    for (const f of report.other) body.push(`- ${code(f)}`);
    body.push("");
  }
  const tail = [
    "#### Reviewer checklist",
    "",
    "- [ ] Every package or endpoint is official or reputable, and open source where required",
    "- [ ] Requested secrets are least-privilege, and every link points where it claims",
    "- [ ] Skill and template text reviewed for prompt injection or data exfiltration",
    "- [ ] Tooling and other files reviewed line by line",
  ];
  const size = (lines) => lines.reduce((n, l) => n + l.length + 1, 0);
  const note = ["… (truncated: the report is longer than a GitHub comment allows — run `node scripts/security-report.mjs <base> <head>` locally for the full list)", ""];
  let kept = body;
  if (size(head) + size(body) + size(tail) > MAX_COMMENT) {
    const budget = MAX_COMMENT - size(head) - size(tail) - size(note);
    kept = [];
    let used = 0;
    for (const line of body) {
      if (used + line.length + 1 > budget) break;
      kept.push(line);
      used += line.length + 1;
    }
    kept.push(...note);
  }
  return `${[...head, ...kept, ...tail].join("\n")}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const positional = args.filter((a) => a !== "--json");
  if (positional.length < 1 || positional.length > 2 || positional.some((a) => a.startsWith("-"))) {
    console.error(USAGE);
    process.exit(2);
  }
  const [base, head = "HEAD"] = positional;
  let report;
  try {
    report = buildReport({ cwd: process.cwd(), base, head });
  } catch (err) {
    console.error(`security-report: ${err.message}`);
    process.exit(1);
  }
  if (json) {
    const { labels, reportable, runtimeChanged } = report;
    process.stdout.write(`${JSON.stringify({ labels, reportable, runtimeChanged })}\n`);
  } else {
    process.stdout.write(renderMarkdown(report));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
