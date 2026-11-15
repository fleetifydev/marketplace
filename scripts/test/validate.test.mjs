import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDER_SETS } from "../lib/constants.mjs";
import { validatePlugin } from "../lib/validate.mjs";
import {
  makeTempDir,
  mcpPluginFiles,
  skillPluginFiles,
  templatePluginFiles,
  writeTree,
} from "./helpers.mjs";

const P = "demo";
const MANIFEST = `${P}/.fleetify-plugin/plugin.json`;

function run(t, files, dirName = P) {
  const root = makeTempDir(t);
  writeTree(root, files);
  return validatePlugin(root, dirName);
}

function show(issues) {
  return issues.map((i) => `  ${i.level} ${i.file}: ${i.message}`).join("\n") || "  (no issues)";
}

function expectIssue(result, level, re, file) {
  const hit = result.issues.find((i) => i.level === level && re.test(i.message));
  assert.ok(hit, `expected a ${level} matching ${re}, got:\n${show(result.issues)}`);
  if (file) assert.equal(hit.file, file);
}

function expectClean(result) {
  assert.deepEqual(result.issues, [], `expected no issues, got:\n${show(result.issues)}`);
}

// ── baseline ────────────────────────────────────────────────────────────────

test("valid MCP, skill and template plugins produce no issues", (t) => {
  expectClean(run(t, mcpPluginFiles(P)));
  expectClean(run(t, skillPluginFiles(P)));
  expectClean(run(t, templatePluginFiles(P)));
});

test("existing checks still apply: name must equal the directory", (t) => {
  const r = run(t, mcpPluginFiles(P, { manifest: { name: "other" } }));
  expectIssue(r, "error", /must equal the directory name/, MANIFEST);
});

// ── providers / declares keys ───────────────────────────────────────────────

test("rejects unknown providers", (t) => {
  const r = run(t, mcpPluginFiles(P, { manifest: { providers: [...PROVIDER_SETS.mcp, "gemini-cli"] } }));
  expectIssue(r, "error", /"gemini-cli" is not a known provider/, MANIFEST);
});

test("rejects duplicate providers", (t) => {
  const r = run(t, mcpPluginFiles(P, { manifest: { providers: ["claude-code", "claude-code"] } }));
  expectIssue(r, "error", /lists "claude-code" more than once/);
});

test("rejects declares.providers keys not listed in providers", (t) => {
  const declares = { mcp_servers: 1, templates: 0, workflows: 0, prompts: 0, providers: { "kimi-code": { skills: 0, commands: 0, hooks: 0 } } };
  const r = run(t, mcpPluginFiles(P, { manifest: { declares } }));
  expectIssue(r, "error", /"declares\.providers\.kimi-code" is not listed in "providers"/);
});

// ── layout ──────────────────────────────────────────────────────────────────

for (const dir of ["skills", "commands", "prompts", "hooks"]) {
  test(`rejects a legacy root-level ${dir}/ dir`, (t) => {
    const r = run(t, mcpPluginFiles(P, { files: { [`${P}/${dir}/x.md`]: "x\n" } }));
    expectIssue(r, "error", new RegExp(`root-level "${dir}/"`));
  });
}

test("warns about unknown dot-directories Fleet ignores", (t) => {
  const r = run(t, skillPluginFiles(P, { files: { [`${P}/.gemini/skills/${P}/SKILL.md`]: "x\n" } }));
  expectIssue(r, "warning", /unknown directory "\.gemini\/"/);
});

// ── metadata ────────────────────────────────────────────────────────────────

const metadataCases = [
  ["display_name", { display_name: "" }],
  ["description", { description: "" }],
  ["author.name", { author: { url: "https://example.com" } }],
  ["tags", { tags: [] }],
  ["icon", { icon: "" }],
  ["homepage", { homepage: "" }],
  ["license", { license: "" }],
];
for (const [field, patch] of metadataCases) {
  test(`requires ${field}`, (t) => {
    const r = run(t, mcpPluginFiles(P, { manifest: patch }));
    expectIssue(r, "error", new RegExp(`"${field.replace(".", "\\.")}"`), MANIFEST);
  });
}

test("rejects a description longer than 120 characters", (t) => {
  const r = run(t, mcpPluginFiles(P, { manifest: { description: "x".repeat(121) } }));
  expectIssue(r, "error", /"description" is 121 characters/);
});

test("rejects a multi-line description", (t) => {
  const r = run(t, mcpPluginFiles(P, { manifest: { description: "line one\nline two" } }));
  expectIssue(r, "error", /"description" must be a single line/);
});

test("rejects tags outside the allowed list", (t) => {
  const r = run(t, mcpPluginFiles(P, { manifest: { tags: ["productivity", "fun"] } }));
  expectIssue(r, "error", /"tags\[1\]" "fun" is not an allowed tag/);
});

test("accepts a relative icon path only when the file exists", (t) => {
  expectClean(run(t, mcpPluginFiles(P, { manifest: { icon: "icon.svg" }, files: { [`${P}/icon.svg`]: "<svg/>\n" } })));
  expectIssue(run(t, mcpPluginFiles(P, { manifest: { icon: "icon.svg" } })), "error", /"icon" points to "icon\.svg"/);
  expectIssue(run(t, mcpPluginFiles(P, { manifest: { icon: "http://example.com/i.svg" } })), "error", /"icon" must be an https:\/\/ URL/);
  expectIssue(run(t, mcpPluginFiles(P, { manifest: { icon: "../outside.svg" } })), "error", /"icon"/);
});

test("rejects a non-https homepage", (t) => {
  const r = run(t, mcpPluginFiles(P, { manifest: { homepage: "http://example.com" } }));
  expectIssue(r, "error", /"homepage" must be an https:\/\/ URL/);
});

// ── README / CHANGELOG / markers ────────────────────────────────────────────

test("requires README.md", (t) => {
  expectIssue(run(t, mcpPluginFiles(P, { files: { [`${P}/README.md`]: null } })), "error", /README\.md is missing/);
});

test("requires CHANGELOG.md", (t) => {
  expectIssue(run(t, mcpPluginFiles(P, { files: { [`${P}/CHANGELOG.md`]: null } })), "error", /CHANGELOG\.md is missing/);
});

test("requires a CHANGELOG section for the current version", (t) => {
  const r = run(t, mcpPluginFiles(P, { manifest: { version: "0.2.0" } }));
  expectIssue(r, "error", /no "## \[0\.2\.0\]" section/, `${P}/CHANGELOG.md`);
});

test("rejects leftover TODO(new-plugin) markers", (t) => {
  const r = run(t, mcpPluginFiles(P, { files: { [`${P}/README.md`]: "# Demo\n\nTODO(new-plugin): describe it\n" } }));
  expectIssue(r, "error", /TODO\(new-plugin\)/, `${P}/README.md`);
});

// ── declares counts ─────────────────────────────────────────────────────────

test("mcp_servers must equal the number of mcpServers entries", (t) => {
  const base = mcpPluginFiles(P);
  const declares = { ...base[MANIFEST].declares, mcp_servers: 2 };
  expectIssue(run(t, mcpPluginFiles(P, { manifest: { declares } })), "error", /"declares\.mcp_servers" is 2 but mcp\.json defines 1/);
});

test("mcp_servers > 0 requires mcp.json", (t) => {
  expectIssue(run(t, mcpPluginFiles(P, { mcp: null })), "error", /"declares\.mcp_servers" is 1 but there is no mcp\.json/);
});

test("an mcp.json with no servers is rejected", (t) => {
  const r = run(t, templatePluginFiles(P, { mcp: { mcpServers: {} } }));
  expectIssue(r, "error", /mcp\.json defines no servers/);
});

test("templates count must match templates/*.md", (t) => {
  const base = templatePluginFiles(P);
  const declares = { ...base[MANIFEST].declares, templates: 2 };
  expectIssue(run(t, templatePluginFiles(P, { manifest: { declares } })), "error", /"declares\.templates" is 2 but 1 template/);
});

test("skills fan out from the first shipped vendor dir", (t) => {
  const files = skillPluginFiles(P, {
    manifest: {
      providers: ["claude-code", "codex-cli"],
      declares: {
        mcp_servers: 0, templates: 0, workflows: 0, prompts: 0,
        providers: { "claude-code": { skills: 1, commands: 0, hooks: 0 }, "codex-cli": { skills: 1, commands: 0, hooks: 0 } },
      },
    },
    files: {
      [`${P}/.claude/skills/${P}/SKILL.md`]: null,
      [`${P}/.codex/skills/${P}/SKILL.md`]: `---\nname: ${P}\ndescription: x\n---\nbody\n`,
    },
  });
  expectClean(run(t, files));
});

test("skills count mismatch is reported per provider", (t) => {
  const base = skillPluginFiles(P);
  const declares = structuredClone(base[MANIFEST].declares);
  declares.providers["claude-code"].skills = 2;
  expectIssue(run(t, skillPluginFiles(P, { manifest: { declares } })), "error", /"declares\.providers\.claude-code\.skills" is 2 but 1 skill/);
});

test("commands: own dir, codex prompts, .claude/commands fallback; others must be 0", (t) => {
  const providers = ["claude-code", "opencode", "codex-cli", "cursor-cli"];
  const entry = (commands) => ({ skills: 1, commands, hooks: 0 });
  const declares = {
    mcp_servers: 0, templates: 0, workflows: 0, prompts: 0,
    providers: { "claude-code": entry(1), opencode: entry(1), "codex-cli": entry(1), "cursor-cli": entry(0) },
  };
  const extra = { [`${P}/.claude/commands/run.md`]: "Run it.\n" };
  expectClean(run(t, skillPluginFiles(P, { manifest: { providers, declares }, files: extra })));

  const bad = structuredClone(declares);
  bad.providers["cursor-cli"].commands = 1;
  expectIssue(run(t, skillPluginFiles(P, { manifest: { providers, declares: bad }, files: extra })), "error", /"declares\.providers\.cursor-cli\.commands" is 1 but 0 command/);
});

test("hooks, workflows and prompts counts are rejected", (t) => {
  const base = skillPluginFiles(P);
  const d1 = structuredClone(base[MANIFEST].declares);
  d1.providers["claude-code"].hooks = 1;
  expectIssue(run(t, skillPluginFiles(P, { manifest: { declares: d1 } })), "error", /hooks are not accepted yet/);
  expectIssue(run(t, skillPluginFiles(P, { manifest: { declares: { ...base[MANIFEST].declares, workflows: 1 } } })), "error", /workflows are not accepted yet/);
  expectIssue(run(t, skillPluginFiles(P, { manifest: { declares: { ...base[MANIFEST].declares, prompts: 1 } } })), "error", /prompts are not accepted yet/);
});

for (const dir of [".claude/hooks", ".claude/agents", "workflows", ".fleetify/prompts"]) {
  test(`rejects the unsupported component dir ${dir}/`, (t) => {
    const r = run(t, skillPluginFiles(P, { files: { [`${P}/${dir}/x.md`]: "x\n" } }));
    expectIssue(r, "error", new RegExp(`"${dir.replace(".", "\\.")}/".*not accepted yet`));
  });
}

// ── mcp.json shape ──────────────────────────────────────────────────────────

function withServer(server) {
  return mcpPluginFiles(P, { mcp: { mcpServers: { [P]: server } } });
}
const npxServer = { type: "stdio", command: "npx", args: ["-y", "@example/mcp-server"], env: { EXAMPLE_TOKEN: "${secret:EXAMPLE_TOKEN}" } };

test("mcp.json: rejects a launcher outside the allowlist", (t) => {
  expectIssue(run(t, withServer({ ...npxServer, command: "bash" })), "error", /command "bash" is not allowed/);
});

test("mcp.json: stdio args must name a package", (t) => {
  expectIssue(run(t, withServer({ ...npxServer, args: ["-y"] })), "error", /"args" must name the package/);
});

test("mcp.json: rejects a non-https remote url", (t) => {
  const r = run(t, mcpPluginFiles(P, {
    manifest: { requires_secrets: [] },
    mcp: { mcpServers: { [P]: { type: "http", url: "http://example.com/mcp" } } },
  }));
  expectIssue(r, "error", /"url" must start with https:\/\//);
});

test("mcp.json: rejects an unknown transport", (t) => {
  expectIssue(run(t, withServer({ ...npxServer, type: "sse" })), "error", /"type" must be one of stdio, http/);
});

test("mcp.json: warns on unknown server keys", (t) => {
  expectIssue(run(t, withServer({ ...npxServer, cwd: "/tmp" })), "warning", /unknown key "cwd"/);
});

// ── secrets / placeholders ──────────────────────────────────────────────────

test("every ${secret:KEY} must be declared in requires_secrets", (t) => {
  const r = run(t, withServer({ ...npxServer, env: { EXAMPLE_TOKEN: "${secret:EXAMPLE_TOKEN}", OTHER: "${secret:OTHER}" } }));
  expectIssue(r, "error", /\$\{secret:OTHER\} is not declared in "requires_secrets"/, `${P}/mcp.json`);
});

test("unsupported placeholders are rejected", (t) => {
  const r = run(t, withServer({ ...npxServer, args: ["-y", "@example/mcp-server", "${weird}"] }));
  expectIssue(r, "error", /unsupported placeholder \$\{weird\}/);
});

test("a declared secret that is never used is a warning", (t) => {
  const r = run(t, withServer({ ...npxServer, env: {} }));
  expectIssue(r, "warning", /"EXAMPLE_TOKEN" is never used in mcp\.json/);
});

test("requires_secrets keys must be UPPER_SNAKE_CASE", (t) => {
  const r = run(t, mcpPluginFiles(P, { manifest: { requires_secrets: [
    { key: "EXAMPLE_TOKEN", label: "Example token" },
    { key: "lower_key", label: "Lower" },
  ] } }));
  expectIssue(r, "error", /"requires_secrets\[1\]\.key" "lower_key" must be UPPER_SNAKE_CASE/);
});

test("requires_secrets keys must be unique", (t) => {
  const r = run(t, mcpPluginFiles(P, { manifest: { requires_secrets: [
    { key: "EXAMPLE_TOKEN", label: "Example token" },
    { key: "EXAMPLE_TOKEN", label: "Again" },
  ] } }));
  expectIssue(r, "error", /"EXAMPLE_TOKEN" is declared more than once/);
});

// ── robustness ──────────────────────────────────────────────────────────────

test("invalid plugin.json and mcp.json are reported, not thrown", (t) => {
  const r1 = run(t, mcpPluginFiles(P, { files: { [MANIFEST]: "{ nope" } }));
  assert.equal(r1.manifest, null);
  expectIssue(r1, "error", /invalid JSON/, MANIFEST);
  const r2 = run(t, mcpPluginFiles(P, { mcp: "{ nope" }));
  expectIssue(r2, "error", /invalid JSON/, `${P}/mcp.json`);
});

test("issue file paths are repo-relative POSIX paths", (t) => {
  const r = run(t, skillPluginFiles(P, {
    manifest: { tags: ["nope"], icon: "missing.svg" },
    files: { [`${P}/README.md`]: null, [`${P}/.claude/hooks/h.json`]: "{}\n", [`${P}/skills/x.md`]: "x\n" },
  }));
  assert.ok(r.issues.length >= 4, show(r.issues));
  for (const i of r.issues) {
    assert.match(i.file, /^[^\\/][^\\]*$/, `bad path ${i.file}`);
    assert.ok(i.file.startsWith(`${P}/`), `not repo-relative: ${i.file}`);
  }
});
