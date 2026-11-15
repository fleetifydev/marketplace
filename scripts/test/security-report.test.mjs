import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildReport, renderMarkdown } from "../security-report.mjs";
import {
  git,
  makeTempDir,
  mcpPluginFiles,
  skillPluginFiles,
  templatePluginFiles,
  writeTree,
} from "./helpers.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "security-report.mjs");
const MARKER = "<!-- fleetify-security-review -->";

function repo(t, files = { "README.md": "# catalog\n" }) {
  const root = makeTempDir(t);
  git(root, "init", "-q");
  const base = commit(root, files);
  return { root, base };
}

function commit(root, files, remove = []) {
  writeTree(root, files);
  for (const rel of remove) fs.rmSync(path.join(root, rel), { recursive: true, force: true });
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", "change");
  return git(root, "rev-parse", "HEAD").trim();
}

function withArgs(name, args) {
  return mcpPluginFiles(name, {
    mcp: { mcpServers: { [name]: { type: "stdio", command: "npx", args, env: { EXAMPLE_TOKEN: "${secret:EXAMPLE_TOKEN}" } } } },
  });
}

test("added plugin lists its server, package link, unpinned flag and secrets", (t) => {
  const { root, base } = repo(t);
  const head = commit(root, mcpPluginFiles("demo"));
  const report = buildReport({ cwd: root, base, head });
  assert.deepEqual(report.labels, ["new-plugin", "security-review"]);
  assert.equal(report.plugins[0].status, "added");
  assert.equal(report.plugins[0].servers[0].status, "added");
  assert.deepEqual(report.plugins[0].secretsAdded, ["EXAMPLE_TOKEN"]);
  const md = renderMarkdown(report);
  assert.match(md, /https:\/\/www\.npmjs\.com\/package\/@example\/mcp-server/);
  assert.match(md, /unpinned/);
  assert.match(md, /`EXAMPLE_TOKEN`/);
});

test("changed package version is reported before → after and flags unpinned", (t) => {
  const { root, base } = repo(t, withArgs("demo", ["-y", "@example/mcp-server@1.0.0"]));
  const head = commit(root, withArgs("demo", ["-y", "@example/mcp-server@^2.0.0"]));
  const report = buildReport({ cwd: root, base, head });
  assert.equal(report.plugins[0].status, "modified");
  assert.equal(report.plugins[0].servers[0].status, "changed");
  assert.deepEqual(report.labels, ["plugin-update", "security-review"]);
  const md = renderMarkdown(report);
  assert.match(md, /`1\.0\.0` → `\^2\.0\.0`/);
  assert.match(md, /unpinned/);
});

test("README/CHANGELOG-only change is not a runtime change", (t) => {
  const { root, base } = repo(t, mcpPluginFiles("demo"));
  const head = commit(root, { "demo/README.md": "# Demo\n\nBetter docs.\n", "demo/CHANGELOG.md": "# Changelog\n\n## [0.1.0] - 2026-11-15\n" });
  const report = buildReport({ cwd: root, base, head });
  assert.deepEqual(report.labels, ["plugin-update"]);
  assert.equal(report.runtimeChanged, false);
  assert.equal(report.reportable, true);
  assert.match(renderMarkdown(report), /no runtime change/i);
});

test("removed plugin is reported as removed", (t) => {
  const { root, base } = repo(t, mcpPluginFiles("demo"));
  const head = commit(root, {}, ["demo"]);
  const report = buildReport({ cwd: root, base, head });
  assert.equal(report.plugins[0].name, "demo");
  assert.equal(report.plugins[0].status, "removed");
  assert.match(renderMarkdown(report), /`demo` — removed/);
});

test("skill and template edits are content changes", (t) => {
  const { root, base } = repo(t, { ...skillPluginFiles("sk"), ...templatePluginFiles("tp") });
  const head = commit(root, {
    "sk/.claude/skills/sk/SKILL.md": "---\nname: sk\ndescription: changed\n---\nNew instructions.\n",
    "tp/templates/tp.md": "---\nname: tp\ndescription: changed\ntools: Read\n---\nNew prompt.\n",
  });
  const report = buildReport({ cwd: root, base, head });
  const byName = Object.fromEntries(report.plugins.map((p) => [p.name, p]));
  assert.deepEqual(byName.sk.contentFiles, ["sk/.claude/skills/sk/SKILL.md"]);
  assert.deepEqual(byName.tp.contentFiles, ["tp/templates/tp.md"]);
  assert.equal(report.runtimeChanged, true);
  assert.match(renderMarkdown(report), /`sk\/\.claude\/skills\/sk\/SKILL\.md`/);
});

test("manifest metadata changes are not content changes", (t) => {
  const files = mcpPluginFiles("demo");
  const { root, base } = repo(t, files);
  const manifest = { ...files["demo/.fleetify-plugin/plugin.json"], description: "A better description." };
  const head = commit(root, { "demo/.fleetify-plugin/plugin.json": manifest });
  const report = buildReport({ cwd: root, base, head });
  assert.deepEqual(report.plugins[0].contentFiles, []);
  assert.equal(report.runtimeChanged, false);
});

test("added providers, secrets and author changes are reported", (t) => {
  const files = mcpPluginFiles("demo", { manifest: { providers: ["claude-code"] } });
  const { root, base } = repo(t, files);
  const manifest = {
    ...files["demo/.fleetify-plugin/plugin.json"],
    providers: ["claude-code", "codex-cli"],
    author: { name: "Someone Else" },
    requires_secrets: [
      { key: "EXAMPLE_TOKEN", label: "Example token" },
      { key: "EXTRA_TOKEN", label: "Extra" },
    ],
  };
  const head = commit(root, { "demo/.fleetify-plugin/plugin.json": manifest });
  const p = buildReport({ cwd: root, base, head }).plugins[0];
  assert.deepEqual(p.providersAdded, ["codex-cli"]);
  assert.deepEqual(p.secretsAdded, ["EXTRA_TOKEN"]);
  assert.deepEqual(p.author, { from: "Test Author", to: "Someone Else" });
});

test("scripts/ and .github/ edits are tooling", (t) => {
  const { root, base } = repo(t);
  const head = commit(root, { "scripts/x.mjs": "export {};\n", ".github/workflows/y.yml": "name: y\n" });
  const report = buildReport({ cwd: root, base, head });
  assert.deepEqual(report.tooling, [".github/workflows/y.yml", "scripts/x.mjs"]);
  assert.deepEqual(report.labels, ["security-review", "tooling"]);
  assert.match(renderMarkdown(report), /#### Tooling/);
});

test("invalid JSON at head is reported, not thrown", (t) => {
  const { root, base } = repo(t, mcpPluginFiles("demo"));
  const head = commit(root, { "demo/mcp.json": "{ nope" });
  const report = buildReport({ cwd: root, base, head });
  assert.ok(report.plugins[0].errors.length > 0);
  assert.equal(report.runtimeChanged, true);
  assert.match(renderMarkdown(report), /not valid JSON/);
});

test("hostile values render inert", (t) => {
  const hostile = "a`b\n@octocat " + "x".repeat(1000);
  const { root, base } = repo(t);
  const head = commit(root, withArgs("demo", ["-y", "@example/mcp-server", hostile]));
  const md = renderMarkdown(buildReport({ cwd: root, base, head }));
  const span = md.match(/`([^`]*octocat[^`]*)`/);
  assert.ok(span, "hostile value must be inside a code span");
  assert.ok(!span[1].includes("\n"), "no newline inside the span");
  assert.ok(span[1].endsWith("…"), "long values are truncated");
  assert.ok(span[1].length <= 201, `span too long: ${span[1].length}`);
  assert.ok(!md.replace(/`[^`]*`/g, "").includes("@octocat"), "@mention outside a code span");
});

test("markdown starts with the sticky marker, also when there is nothing to report", (t) => {
  const { root, base } = repo(t);
  const report = buildReport({ cwd: root, base, head: base });
  assert.equal(report.reportable, false);
  const md = renderMarkdown(report);
  assert.equal(md.split("\n")[0], MARKER);
  assert.match(md, /No plugin runtime or tooling changes detected\./);
});

test("CLI --json prints labels, reportable and runtimeChanged", (t) => {
  const { root, base } = repo(t);
  const head = commit(root, mcpPluginFiles("demo"));
  const r = spawnSync(process.execPath, [SCRIPT, base, head, "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { labels: ["new-plugin", "security-review"], reportable: true, runtimeChanged: true });
});

test("CLI prints markdown by default", (t) => {
  const { root, base } = repo(t);
  const head = commit(root, mcpPluginFiles("demo"));
  const r = spawnSync(process.execPath, [SCRIPT, base, head], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split("\n")[0], MARKER);
});
