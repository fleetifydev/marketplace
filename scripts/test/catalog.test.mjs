import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverPluginDirs, readJson } from "../lib/catalog.mjs";
import { makeTempDir, writeTree } from "./helpers.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const M = ".fleetify-plugin/plugin.json";

test("discoverPluginDirs finds only top-level dirs with a manifest, sorted, skipping ignored and dot dirs", (t) => {
  const root = makeTempDir(t);
  writeTree(root, {
    [`b/${M}`]: { name: "b" },
    [`a/${M}`]: { name: "a" },
    [`scripts/${M}`]: { name: "scripts" },
    [`docs/${M}`]: { name: "docs" },
    [`node_modules/${M}`]: { name: "node_modules" },
    [`.hidden/${M}`]: { name: "hidden" },
    "nomanifest/README.md": "# no manifest\n",
    "file.txt": "not a dir\n",
  });
  assert.deepEqual(discoverPluginDirs(root), ["a", "b"]);
});

test("readJson reports invalid JSON with the file path", (t) => {
  const root = makeTempDir(t);
  writeTree(root, { "bad.json": "{ not json" });
  assert.throws(() => readJson(path.join(root, "bad.json")), /invalid JSON in .*bad\.json/);
});

test("readJson reports an unreadable file with the file path", (t) => {
  const root = makeTempDir(t);
  assert.throws(() => readJson(path.join(root, "missing.json")), /cannot read .*missing\.json/);
});

test("build-marketplace --check passes on the real catalog", () => {
  const r = spawnSync(process.execPath, ["scripts/build-marketplace.mjs", "--check"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK {2}marketplace\.json in sync — \d+ plugins/);
});
