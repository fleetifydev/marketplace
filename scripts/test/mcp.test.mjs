import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "../lib/catalog.mjs";
import { findPlaceholders, packageUrl, parsePackageSpec, summarizeServer } from "../lib/mcp.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("parsePackageSpec npx: scoped package without version", () => {
  assert.deepEqual(parsePackageSpec("npx", ["-y", "@modelcontextprotocol/server-github"]), {
    ecosystem: "npm",
    name: "@modelcontextprotocol/server-github",
    version: null,
    pinned: false,
    latest: false,
  });
});

test("parsePackageSpec npx: scoped package pinned to an exact version", () => {
  const pkg = parsePackageSpec("npx", ["-y", "@scope/pkg@1.2.3"]);
  assert.equal(pkg.name, "@scope/pkg");
  assert.equal(pkg.version, "1.2.3");
  assert.equal(pkg.pinned, true);
});

test("parsePackageSpec npx: @latest is flagged and not pinned", () => {
  const pkg = parsePackageSpec("npx", ["-y", "tavily-mcp@latest"]);
  assert.equal(pkg.name, "tavily-mcp");
  assert.equal(pkg.latest, true);
  assert.equal(pkg.pinned, false);
});

test("parsePackageSpec npx: trailing server flags are not the package", () => {
  assert.equal(parsePackageSpec("npx", ["-y", "figma-developer-mcp", "--stdio"]).name, "figma-developer-mcp");
});

test("parsePackageSpec npx: a semver range is not pinned", () => {
  assert.equal(parsePackageSpec("npx", ["-y", "pkg@^1.2.0"]).pinned, false);
});

test("parsePackageSpec uvx: @latest", () => {
  const pkg = parsePackageSpec("uvx", ["awslabs.aws-api-mcp-server@latest"]);
  assert.equal(pkg.ecosystem, "pypi");
  assert.equal(pkg.name, "awslabs.aws-api-mcp-server");
  assert.equal(pkg.latest, true);
});

test("parsePackageSpec uvx: package followed by server args", () => {
  assert.equal(parsePackageSpec("uvx", ["mcp-server-git", "--repository", "${env:HOME}"]).name, "mcp-server-git");
});

test("parsePackageSpec uvx: == pins an exact version", () => {
  const pkg = parsePackageSpec("uvx", ["mcp-server-fetch==1.2.3"]);
  assert.equal(pkg.name, "mcp-server-fetch");
  assert.equal(pkg.version, "1.2.3");
  assert.equal(pkg.pinned, true);
});

test("parsePackageSpec uvx: --from with extras", () => {
  const pkg = parsePackageSpec("uvx", ["--from", "pkg[extra]==2.0.0", "cmd"]);
  assert.equal(pkg.name, "pkg");
  assert.equal(pkg.version, "2.0.0");
  assert.equal(pkg.pinned, true);
});

test("parsePackageSpec returns null for other launchers", () => {
  assert.equal(parsePackageSpec("docker", ["run", "x"]), null);
});

test("findPlaceholders walks nested values in order", () => {
  const found = findPlaceholders({ a: ["Bearer ${secret:TOKEN}"], b: { c: "${env:HOME}" }, d: "${weird}" });
  assert.deepEqual(found.map((p) => p.kind), ["secret", "env", "unknown"]);
  assert.deepEqual(found.map((p) => p.key), ["TOKEN", "HOME", "weird"]);
  assert.equal(found[0].raw, "${secret:TOKEN}");
});

test("summarizeServer on the real github server", () => {
  const { mcpServers } = readJson(path.join(REPO_ROOT, "github", "mcp.json"));
  const s = summarizeServer("github", mcpServers.github);
  assert.equal(s.transport, "stdio");
  assert.equal(s.command, "npx");
  assert.equal(s.pkg.name, "@modelcontextprotocol/server-github");
  assert.deepEqual(s.envKeys, ["GITHUB_PERSONAL_ACCESS_TOKEN"]);
  assert.deepEqual(s.secretKeys, ["GITHUB_TOKEN"]);
});

test("summarizeServer on the real neon remote server", () => {
  const { mcpServers } = readJson(path.join(REPO_ROOT, "neon", "mcp.json"));
  const s = summarizeServer("neon", mcpServers.neon);
  assert.equal(s.transport, "http");
  assert.equal(s.url, "https://mcp.neon.tech/mcp");
  assert.equal(s.pkg, null);
});

test("packageUrl links npm and PyPI", () => {
  assert.equal(packageUrl({ ecosystem: "npm", name: "@scope/pkg" }), "https://www.npmjs.com/package/@scope/pkg");
  assert.equal(packageUrl({ ecosystem: "pypi", name: "mcp-server-git" }), "https://pypi.org/project/mcp-server-git/");
});
