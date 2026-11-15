#!/usr/bin/env node
/**
 * new-plugin.mjs — scaffold a new plugin folder that follows the marketplace
 * contract (see docs/plugin-reference.md).
 *
 * Usage:
 *   node scripts/new-plugin.mjs <name> --type mcp|skill|template
 *        [--display-name "GitHub"] [--description "One line."]
 *        [--author "Your Name"] [--author-url "https://…"] [--root <dir>]
 *
 * Missing metadata is prompted for in an interactive terminal; otherwise it is
 * left as a `TODO(new-plugin)` placeholder. Every placeholder fails
 * `node scripts/build-marketplace.mjs` until it is replaced, so nothing
 * half-finished can be merged by accident.
 *
 * Never touches marketplace.json. No third-party dependencies.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import {
  COMPONENT_PROVIDERS,
  MANIFEST_SUBPATH,
  MARKETPLACE_TREE_URL,
  NAME_RE,
  PROVIDER_SETS,
  SCAFFOLD_MARKER as TODO,
} from "./lib/constants.mjs";

const TYPES = ["mcp", "skill", "template"];
const USAGE =
  "Usage: node scripts/new-plugin.mjs <name> --type mcp|skill|template " +
  '[--display-name "…"] [--description "…"] [--author "…"] [--author-url "…"] [--root <dir>]';

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readme(displayName, description) {
  return `# ${displayName}

${description}

## What it does

${TODO}: explain what the plugin lets an agent do, and any limits users should know about.

## Requirements

${TODO}: list each secret from \`requires_secrets\`, the scopes or permissions it needs, and where to create it. Write "None" if the plugin needs no secrets.

## Upstream source

${TODO}: link the source repository of the MCP server, skill or template, and its license.

## Install

Use Fleet's Marketplace and click **Get** on the ${displayName} card.
`;
}

function changelog(today) {
  return `# Changelog

All notable changes to this plugin are documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [0.1.0] - ${today}

### Added
- Initial release.
`;
}

/**
 * Create `<root>/<name>/` for a plugin of `type`.
 * @param {{ root: string, name: string, type: "mcp"|"skill"|"template",
 *   displayName?: string, description?: string, author?: string,
 *   authorUrl?: string, today: string }} opts
 * @returns {string[]} repo-relative POSIX paths of the files created
 */
export function scaffoldPlugin({ root, name, type, displayName, description, author, authorUrl, today }) {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new Error(`invalid plugin name ${JSON.stringify(name)} — use lowercase letters, digits and hyphens (e.g. "my-service")`);
  }
  if (!TYPES.includes(type)) {
    throw new Error(`unknown plugin type ${JSON.stringify(type)} — use one of: ${TYPES.join(", ")}`);
  }
  const pluginDir = path.join(root, name);
  if (fs.existsSync(pluginDir)) {
    throw new Error(`${name}/ already exists — pick another name or edit the existing plugin`);
  }

  const display = displayName || `${TODO}: Display Name`;
  const summary = description || `${TODO}: one line shown on the Browse card`;
  const manifest = {
    name,
    display_name: display,
    version: "0.1.0",
    description: summary,
    author: authorUrl
      ? { name: author || `${TODO}: your name`, url: authorUrl }
      : { name: author || `${TODO}: your name` },
    providers: [...PROVIDER_SETS[type]],
    tags: ["productivity"],
    icon: "https://api.iconify.design/mdi:puzzle-outline.svg",
    requires_secrets: [],
    declares: { mcp_servers: 0, templates: 0, workflows: 0, prompts: 0, providers: {} },
    homepage: `${MARKETPLACE_TREE_URL}/${name}`,
    license: "MIT",
  };

  /** @type {Array<[string, string]>} [repo-relative path, contents] */
  const files = [];
  if (type === "mcp") {
    manifest.requires_secrets = [
      { key: "YOUR_API_KEY", label: `${TODO}: label shown in the install dialog`, url: `https://example.com/${TODO}` },
    ];
    manifest.declares.mcp_servers = 1;
    files.push([
      `${name}/mcp.json`,
      json({
        mcpServers: {
          [name]: {
            type: "stdio",
            command: "npx",
            args: ["-y", `${TODO}-npm-package`],
            env: { YOUR_API_KEY: "${secret:YOUR_API_KEY}" },
          },
        },
      }),
    ]);
  } else if (type === "skill") {
    for (const p of COMPONENT_PROVIDERS) manifest.declares.providers[p] = { skills: 1, commands: 0, hooks: 0 };
    files.push([
      `${name}/.claude/skills/${name}/SKILL.md`,
      `---\nname: ${name}\ndescription: ${TODO} one sentence on when the agent should use this skill\n---\n${TODO}: write the instructions the agent follows when this skill is active.\n`,
    ]);
  } else {
    manifest.declares.templates = 1;
    files.push([
      `${name}/templates/${name}.md`,
      `---\nname: ${name}\ndescription: ${TODO} one sentence on what this agent does\ntools: Read, Grep, Glob\n---\n${TODO}: write the agent's system prompt.\n`,
    ]);
  }

  files.unshift([`${name}/${MANIFEST_SUBPATH}`, json(manifest)]);
  files.push([`${name}/README.md`, readme(display, summary)]);
  files.push([`${name}/CHANGELOG.md`, changelog(today)]);

  for (const [rel, body] of files) {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return files.map(([rel]) => rel);
}

/** Parse `<name> --flag value --flag=value` into { name, flags }. */
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  const known = new Set(["type", "display-name", "description", "author", "author-url", "root"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return { help: true };
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (!known.has(key)) throw new Error(`unknown option --${key}`);
    const value = eq === -1 ? argv[++i] : a.slice(eq + 1);
    if (value === undefined) throw new Error(`--${key} needs a value`);
    flags[key] = value;
  }
  if (positional.length !== 1) throw new Error("expected exactly one plugin name");
  return { name: positional[0], flags };
}

async function promptMissing(flags) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = async (key, question) => {
      if (flags[key] !== undefined) return;
      const answer = (await rl.question(question)).trim();
      if (answer) flags[key] = answer;
    };
    await ask("display-name", "Display name, as shown in Fleet (e.g. GitHub): ");
    await ask("description", "One-line description (max 120 characters): ");
    await ask("author", "Author name: ");
    await ask("author-url", "Author URL (optional, press Enter to skip): ");
  } finally {
    rl.close();
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}\n${USAGE}`);
    process.exit(2);
  }
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  const { name, flags } = parsed;
  if (!flags.type) {
    console.error(`Error: --type is required\n${USAGE}`);
    process.exit(2);
  }
  if (process.stdin.isTTY) await promptMissing(flags);

  const root = flags.root
    ? path.resolve(flags.root)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let created;
  try {
    created = scaffoldPlugin({
      root,
      name,
      type: flags.type,
      displayName: flags["display-name"],
      description: flags.description,
      author: flags.author,
      authorUrl: flags["author-url"],
      today: new Date().toISOString().slice(0, 10),
    });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  console.log(`Created plugin "${name}" (${flags.type}):`);
  for (const f of created) console.log(`  ${f}`);
  console.log(`
Next steps:
  1. Replace every ${TODO} placeholder (see docs/plugin-reference.md).
  2. Run: node scripts/build-marketplace.mjs
  3. Optional: test the plugin in Fleet (see CONTRIBUTING.md, "Test in Fleet").
  4. Commit the plugin folder and marketplace.json, then open a pull request.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
