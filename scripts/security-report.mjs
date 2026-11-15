#!/usr/bin/env node
/**
 * security-report.mjs — summarize what a change does to users' machines, for
 * the maintainer reviewing it.
 *
 * Usage:
 *   node scripts/security-report.mjs <base> [head=HEAD] [--json]
 *
 * Compares every plugin changed in `<base>...<head>` (merge-base semantics):
 * MCP servers added/changed/removed (command, package + pin status, args,
 * remote URL, env and secrets), secrets and providers added, agent-facing
 * files (skills, templates, …) changed, author changes, and edits to CI and
 * tooling (`scripts/`, `.github/`).
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
const TOOLING_TOP = new Set(["scripts", ".github"]);
// Only names in these charsets are rendered as links (no markdown injection).
const NPM_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const PYPI_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

/** A JSON file at a revision: `{ exists, value?, error? }`. Never throws. */
function readJsonAt(cwd, rev, file) {
  const raw = tryGit(cwd, ["show", `${rev}:${file}`]);
  if (raw === null) return { exists: false };
  try {
    return { exists: true, value: JSON.parse(raw) };
  } catch (err) {
    return { exists: true, error: err.message };
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const stringsOf = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const secretKeysOf = (m) => stringsOf(isPlainObject(m) && Array.isArray(m.requires_secrets) ? m.requires_secrets.map((s) => s && s.key) : []);
const providersOf = (m) => stringsOf(isPlainObject(m) ? m.providers : []);
const authorOf = (m) => (isPlainObject(m) && isPlainObject(m.author) && typeof m.author.name === "string" ? m.author.name : null);
const serversOf = (doc) => (isPlainObject(doc) && isPlainObject(doc.mcpServers) ? doc.mcpServers : {});

/** Agent-facing component files: anything under a dot-dir (except the manifest dir), templates/ or workflows/. */
function isContentFile(relInPlugin) {
  const top = relInPlugin.split("/")[0];
  if (top === ".fleetify-plugin") return false;
  return top.startsWith(".") || top === "templates" || top === "workflows";
}

function pluginChange(cwd, from, to, dir, paths) {
  const manifestPath = `${dir}/${MANIFEST_SUBPATH}`;
  const mcpPath = `${dir}/mcp.json`;
  const mBefore = readJsonAt(cwd, from, manifestPath);
  const mAfter = readJsonAt(cwd, to, manifestPath);
  const cBefore = readJsonAt(cwd, from, mcpPath);
  const cAfter = readJsonAt(cwd, to, mcpPath);

  const errors = [];
  if (mBefore.error) errors.push(`${manifestPath} (base) is not valid JSON: ${mBefore.error}`);
  if (mAfter.error) errors.push(`${manifestPath} is not valid JSON: ${mAfter.error}`);
  if (cBefore.error) errors.push(`${mcpPath} (base) is not valid JSON: ${cBefore.error}`);
  if (cAfter.error) errors.push(`${mcpPath} is not valid JSON: ${cAfter.error}`);

  const status = !mBefore.exists ? "added" : !mAfter.exists ? "removed" : "modified";
  const before = serversOf(cBefore.value);
  const after = serversOf(cAfter.value);
  const servers = [];
  for (const id of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!(id in before)) servers.push({ id, status: "added", before: null, after: summarizeServer(id, after[id]) });
    else if (!(id in after)) servers.push({ id, status: "removed", before: summarizeServer(id, before[id]), after: null });
    else if (JSON.stringify(before[id]) !== JSON.stringify(after[id])) {
      servers.push({ id, status: "changed", before: summarizeServer(id, before[id]), after: summarizeServer(id, after[id]) });
    }
  }

  const secretsBefore = secretKeysOf(mBefore.value);
  const secretsAfter = secretKeysOf(mAfter.value);
  const providersBefore = providersOf(mBefore.value);
  const authorBefore = authorOf(mBefore.value);
  const authorAfter = authorOf(mAfter.value);
  return {
    name: dir,
    status,
    servers,
    secretsAdded: secretsAfter.filter((k) => !secretsBefore.includes(k)),
    secretsRemoved: secretsBefore.filter((k) => !secretsAfter.includes(k)),
    providersAdded: status === "modified" ? providersOf(mAfter.value).filter((p) => !providersBefore.includes(p)) : [],
    contentFiles: paths.filter((p) => isContentFile(p.slice(dir.length + 1))).sort(),
    author: status === "modified" && authorBefore !== authorAfter ? { from: authorBefore, to: authorAfter } : null,
    errors,
  };
}

/** Does this plugin change what runs on (or is fed to agents on) users' machines? */
function isRuntimeChange(p) {
  if (p.errors.length > 0 || p.status === "added") return true;
  if (p.status === "removed") return false;
  return (
    p.servers.length > 0 ||
    p.contentFiles.length > 0 ||
    p.secretsAdded.length > 0 ||
    p.secretsRemoved.length > 0 ||
    p.providersAdded.length > 0
  );
}

/**
 * @param {{ cwd: string, base: string, head?: string }} opts
 */
export function buildReport({ cwd, base, head = "HEAD" }) {
  const headSha = git(cwd, ["rev-parse", "--verify", `${head}^{commit}`]).trim();
  const baseSha = git(cwd, ["rev-parse", "--verify", `${base}^{commit}`]).trim();
  const from = (tryGit(cwd, ["merge-base", baseSha, headSha]) || baseSha).trim();

  const parts = git(cwd, ["diff", "--name-status", "--no-renames", "-z", from, headSha]).split("\0").filter(Boolean);
  const tooling = [];
  const byDir = new Map();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const file = parts[i + 1];
    const segs = file.split("/");
    if (segs.length === 1) continue; // root files: docs, LICENSE, marketplace.json
    if (TOOLING_TOP.has(segs[0])) {
      tooling.push(file);
      continue;
    }
    if (!byDir.has(segs[0])) byDir.set(segs[0], []);
    byDir.get(segs[0]).push(file);
  }

  const plugins = [];
  for (const dir of [...byDir.keys()].sort()) {
    const manifestPath = `${dir}/${MANIFEST_SUBPATH}`;
    const isPlugin = tryGit(cwd, ["cat-file", "-e", `${from}:${manifestPath}`]) !== null
      || tryGit(cwd, ["cat-file", "-e", `${headSha}:${manifestPath}`]) !== null;
    if (isPlugin) plugins.push(pluginChange(cwd, from, headSha, dir, byDir.get(dir)));
  }
  tooling.sort();

  const runtimeChanged = plugins.some(isRuntimeChange) || tooling.length > 0;
  const labels = [];
  if (plugins.some((p) => p.status === "added")) labels.push("new-plugin");
  if (plugins.some((p) => p.status === "modified")) labels.push("plugin-update");
  if (runtimeChanged) labels.push("security-review");
  if (tooling.length > 0) labels.push("tooling");
  return { plugins, tooling, labels, runtimeChanged, reportable: plugins.length > 0 || tooling.length > 0 };
}

// ── rendering ───────────────────────────────────────────────────────────────

/**
 * Render a PR-derived value inertly: inline code, no backticks or newlines,
 * truncated. The ONLY way PR text may enter the comment.
 * @param {*} value
 * @returns {string}
 */
export function code(value) {
  let s = String(value ?? "").replace(/`/g, "'").replace(/\s*[\r\n]+\s*/g, " ");
  if (s.length > MAX_VALUE) s = `${s.slice(0, MAX_VALUE)}…`;
  if (s.trim() === "") s = "(empty)";
  return `\`${s}\``;
}

const list = (values) => values.map(code).join(", ");

function packageLink(pkg) {
  const safe = pkg.ecosystem === "npm" ? NPM_NAME_RE.test(pkg.name) : PYPI_NAME_RE.test(pkg.name);
  return safe ? ` · [${pkg.ecosystem === "npm" ? "npm" : "PyPI"} ↗](${packageUrl(pkg)})` : "";
}

function versionOf(pkg) {
  if (pkg.pinned) return `${code(pkg.version)} (pinned)`;
  if (pkg.version) return `${code(pkg.version)} ⚠️ unpinned`;
  return "none ⚠️ unpinned — resolves to the newest release at every launch";
}

function renderServer(change) {
  const lines = [`- **MCP server ${code(change.id)}** — ${change.status}`];
  if (change.status === "removed") return lines;
  const s = change.after;
  const b = change.before;
  lines.push(`  - transport: ${code(s.transport)}${s.command ? ` · command: ${code(s.command)}` : ""}`);
  if (s.pkg) {
    let version = versionOf(s.pkg);
    if (b && b.pkg && b.pkg.name === s.pkg.name && b.pkg.version !== s.pkg.version) {
      version = `${code(b.pkg.version ?? "none")} → ${version}`;
    }
    lines.push(`  - package (${s.pkg.ecosystem}): ${code(s.pkg.name)} — version ${version}${packageLink(s.pkg)}`);
  }
  if (s.args.length) lines.push(`  - args: ${s.args.map(code).join(" ")}`);
  if (s.url) lines.push(`  - url: ${code(s.url)}`);
  if (s.envKeys.length) lines.push(`  - env: ${list(s.envKeys)}`);
  if (s.headerKeys.length) lines.push(`  - headers: ${list(s.headerKeys)}`);
  if (s.secretKeys.length) lines.push(`  - secrets used: ${list(s.secretKeys)}`);
  if (change.status === "changed") {
    const prev = [];
    if (b.transport !== s.transport) prev.push(`transport ${code(b.transport)}`);
    if (b.command !== s.command) prev.push(`command ${code(b.command)}`);
    if (b.pkg && s.pkg && b.pkg.name !== s.pkg.name) prev.push(`package ${code(b.pkg.name)}`);
    if (JSON.stringify(b.args) !== JSON.stringify(s.args)) prev.push(`args ${b.args.map(code).join(" ") || "(none)"}`);
    if (b.url !== s.url) prev.push(`url ${code(b.url)}`);
    if (JSON.stringify(b.envKeys) !== JSON.stringify(s.envKeys)) prev.push(`env ${list(b.envKeys) || "(none)"}`);
    if (prev.length) lines.push(`  - previously: ${prev.join(" · ")}`);
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
  if (p.secretsRemoved.length) lines.push(`- secrets no longer requested: ${list(p.secretsRemoved)}`);
  if (p.providersAdded.length) lines.push(`- now also installs for: ${list(p.providersAdded)}`);
  if (p.author) lines.push(`- author changed: ${code(p.author.from)} → ${code(p.author.to)}`);
  if (p.contentFiles.length) {
    lines.push("- agent-facing files changed (read them in full):");
    for (const f of p.contentFiles) lines.push(`  - ${code(f)}`);
  }
  if (!isRuntimeChange(p)) lines.push("- Documentation or metadata only — no runtime change.");
  return lines;
}

/**
 * @param {ReturnType<typeof buildReport>} report
 * @returns {string}
 */
export function renderMarkdown(report) {
  const out = [MARKER, "### 🔒 Security review summary", ""];
  if (!report.reportable) {
    out.push("No plugin runtime or tooling changes detected.");
    return `${out.join("\n")}\n`;
  }
  out.push(
    "What this pull request changes on users' machines, generated from the diff by `scripts/security-report.mjs`. A Fleetify maintainer reviews every item below before merging.",
    ""
  );
  for (const p of report.plugins) out.push(...renderPlugin(p), "");
  if (report.tooling.length) {
    out.push("#### Tooling", "", "These files change what CI enforces:", "");
    for (const f of report.tooling) out.push(`- ${code(f)}`);
    out.push("");
  }
  out.push(
    "#### Reviewer checklist",
    "",
    "- [ ] Every package or endpoint is official or reputable, and open source where required",
    "- [ ] Requested secrets are least-privilege",
    "- [ ] Skill and template text reviewed for prompt injection or data exfiltration",
    "- [ ] Tooling changes reviewed line by line"
  );
  return `${out.join("\n")}\n`;
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
