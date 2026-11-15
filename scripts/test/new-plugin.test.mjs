import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scaffoldPlugin } from "../new-plugin.mjs";
import { validatePlugin } from "../lib/validate.mjs";
import { makeTempDir } from "./helpers.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "new-plugin.mjs");
const TYPES = ["mcp", "skill", "template"];

function show(issues) {
  return issues.map((i) => `  ${i.level} ${i.file}: ${i.message}`).join("\n") || "  (no issues)";
}

/** Replace every scaffold placeholder the way a contributor would. */
function fillIn(root, files) {
  for (const rel of files) {
    const abs = path.join(root, ...rel.split("/"));
    const filled = fs
      .readFileSync(abs, "utf8")
      .replaceAll("TODO(new-plugin)-npm-package", "@scope/real-server")
      .replaceAll("https://example.com/TODO(new-plugin)", "https://example.com/keys")
      .replaceAll("TODO(new-plugin)", "Filled in");
    fs.writeFileSync(abs, filled);
  }
}

for (const type of TYPES) {
  test(`${type}: a fresh scaffold fails validation only on TODO markers`, (t) => {
    const root = makeTempDir(t);
    scaffoldPlugin({ root, name: "demo", type, today: "2026-11-15" });
    const { issues } = validatePlugin(root, "demo");
    const errors = issues.filter((i) => i.level === "error");
    assert.ok(errors.length > 0, "a fresh scaffold must not validate clean");
    for (const e of errors) assert.match(e.message, /TODO\(new-plugin\)/, show(issues));
    assert.deepEqual(issues.filter((i) => i.level === "warning"), [], show(issues));
  });

  test(`${type}: a filled-in scaffold validates clean`, (t) => {
    const root = makeTempDir(t);
    const files = scaffoldPlugin({ root, name: "demo", type, today: "2026-11-15" });
    fillIn(root, files);
    const { issues } = validatePlugin(root, "demo");
    assert.deepEqual(issues, [], show(issues));
  });
}

test("scaffoldPlugin returns repo-relative paths of the files it created", (t) => {
  const root = makeTempDir(t);
  const files = scaffoldPlugin({ root, name: "demo", type: "mcp", today: "2026-11-15" });
  assert.deepEqual(files, [
    "demo/.fleetify-plugin/plugin.json",
    "demo/mcp.json",
    "demo/README.md",
    "demo/CHANGELOG.md",
  ]);
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), f);
});

test("provided metadata is used instead of placeholders", (t) => {
  const root = makeTempDir(t);
  scaffoldPlugin({
    root, name: "demo", type: "skill", today: "2026-11-15",
    displayName: "Demo", description: "Does demo things.", author: "Jane Doe", authorUrl: "https://example.com/jane",
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "demo/.fleetify-plugin/plugin.json"), "utf8"));
  assert.equal(manifest.display_name, "Demo");
  assert.equal(manifest.description, "Does demo things.");
  assert.deepEqual(manifest.author, { name: "Jane Doe", url: "https://example.com/jane" });
  assert.equal(manifest.homepage, "https://github.com/fleetifydev/marketplace/tree/main/demo");
});

test("refuses an invalid name, an existing dir, and an unknown type", (t) => {
  const root = makeTempDir(t);
  assert.throws(() => scaffoldPlugin({ root, name: "Bad_Name", type: "mcp", today: "2026-11-15" }), /name/);
  scaffoldPlugin({ root, name: "demo", type: "mcp", today: "2026-11-15" });
  assert.throws(() => scaffoldPlugin({ root, name: "demo", type: "mcp", today: "2026-11-15" }), /already exists/);
  assert.throws(() => scaffoldPlugin({ root, name: "other", type: "hooks", today: "2026-11-15" }), /type/);
});

test("CHANGELOG uses the injected date", (t) => {
  const root = makeTempDir(t);
  scaffoldPlugin({ root, name: "demo", type: "template", today: "2026-11-15" });
  assert.match(fs.readFileSync(path.join(root, "demo/CHANGELOG.md"), "utf8"), /^## \[0\.1\.0\] - 2026-11-15$/m);
});

test("CLI scaffolds non-interactively and prints next steps", (t) => {
  const root = makeTempDir(t);
  const r = spawnSync(process.execPath, [SCRIPT, "demo", "--type", "mcp", "--root", root], { encoding: "utf8", input: "" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /demo\/mcp\.json/);
  assert.match(r.stdout, /node scripts\/build-marketplace\.mjs/);
});

test("CLI rejects a missing --type with usage", (t) => {
  const root = makeTempDir(t);
  const r = spawnSync(process.execPath, [SCRIPT, "demo", "--root", root], { encoding: "utf8", input: "" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage: node scripts\/new-plugin\.mjs/);
});
