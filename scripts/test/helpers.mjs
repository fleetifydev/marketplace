/**
 * Shared test helpers (not a test file — the runner only picks up *.test.mjs).
 *
 * Builders return file maps of VALID plugins; tests break exactly one thing.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { COMPONENT_PROVIDERS, PROVIDER_SETS } from "../lib/constants.mjs";

/**
 * Create a temp dir that is removed when the test finishes.
 * @param {import("node:test").TestContext} t
 * @returns {string}
 */
export function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleetify-mkt-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Write a map of repo-relative POSIX paths to contents. Objects are written as
 * 2-space JSON + newline; `null` entries are skipped (lets overrides delete).
 * @param {string} root
 * @param {Record<string, string|object|null>} files
 */
export function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue;
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const body = typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
    fs.writeFileSync(abs, body);
  }
}

/**
 * Run git in `cwd` with a fixed identity (CI runners have none configured).
 * @param {string} cwd
 * @param {...string} args
 * @returns {string}
 */
export function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "init.defaultBranch=main", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
}

function changelog(version) {
  return `# Changelog

All notable changes to this plugin are documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [${version}] - 2026-11-15

### Added
- Initial release.
`;
}

function baseManifest(name, type) {
  return {
    name,
    display_name: "Example",
    version: "0.1.0",
    description: "An example plugin used in tests.",
    author: { name: "Test Author", url: "https://example.com" },
    providers: [...PROVIDER_SETS[type]],
    tags: ["productivity"],
    icon: "https://api.iconify.design/mdi:puzzle-outline.svg",
    requires_secrets: [],
    declares: { mcp_servers: 0, templates: 0, workflows: 0, prompts: 0, providers: {} },
    homepage: `https://github.com/fleetifydev/marketplace/tree/main/${name}`,
    license: "MIT",
  };
}

/**
 * @typedef {{ manifest?: object, mcp?: object|string|null, files?: Record<string, string|object|null> }} Overrides
 */

function assemble(name, manifest, files, overrides = {}) {
  const out = {
    [`${name}/.fleetify-plugin/plugin.json`]: { ...manifest, ...(overrides.manifest || {}) },
    [`${name}/README.md`]: `# Example\n\nAn example plugin used in tests.\n`,
    [`${name}/CHANGELOG.md`]: changelog(manifest.version),
    ...files,
  };
  if (Object.prototype.hasOwnProperty.call(overrides, "mcp")) out[`${name}/mcp.json`] = overrides.mcp;
  return { ...out, ...(overrides.files || {}) };
}

/**
 * A valid stdio MCP plugin with one secret.
 * @param {string} name
 * @param {Overrides} [overrides]
 */
export function mcpPluginFiles(name, overrides) {
  const manifest = baseManifest(name, "mcp");
  manifest.requires_secrets = [
    { key: "EXAMPLE_TOKEN", label: "Example token", url: "https://example.com/token" },
  ];
  manifest.declares.mcp_servers = 1;
  const mcp = {
    mcpServers: {
      [name]: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@example/mcp-server"],
        env: { EXAMPLE_TOKEN: "${secret:EXAMPLE_TOKEN}" },
      },
    },
  };
  return assemble(name, manifest, { [`${name}/mcp.json`]: mcp }, overrides);
}

/**
 * A valid skill plugin shipping one skill under `.claude/skills/` (fans out to
 * every component provider).
 * @param {string} name
 * @param {Overrides} [overrides]
 */
export function skillPluginFiles(name, overrides) {
  const manifest = baseManifest(name, "skill");
  for (const p of COMPONENT_PROVIDERS) {
    manifest.declares.providers[p] = { skills: 1, commands: 0, hooks: 0 };
  }
  const skill = `---\nname: ${name}\ndescription: An example skill used in tests\n---\nDo the example thing.\n`;
  return assemble(name, manifest, { [`${name}/.claude/skills/${name}/SKILL.md`]: skill }, overrides);
}

/**
 * A valid template plugin shipping one agent template.
 * @param {string} name
 * @param {Overrides} [overrides]
 */
export function templatePluginFiles(name, overrides) {
  const manifest = baseManifest(name, "template");
  manifest.declares.templates = 1;
  const template = `---\nname: ${name}\ndescription: An example template used in tests\ntools: Read, Grep, Glob\n---\nYou are an example agent.\n`;
  return assemble(name, manifest, { [`${name}/templates/${name}.md`]: template }, overrides);
}
