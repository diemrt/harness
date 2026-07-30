// Packaging smoke test. The v1 harness shipped an npm CLI, so this file used to guard
// `bin`, `files` and the template seed. The repository is a Claude Code plugin now: what
// has to stay honest is the plugin manifest and the marketplace entry that points at it,
// plus the leftovers of package.json that are still real (the test script CI runs, and a
// `files` list that must not name paths the demolition removed).

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function readJson(...segments) {
  return JSON.parse(readFileSync(path.join(rootDir, ...segments), "utf8"));
}

test("package.json parses and only declares what still exists", () => {
  const pkg = readJson("package.json");

  assert.equal(pkg.name, "@diemrt/harness");
  assert.equal(pkg.type, "module");
  assert.ok(pkg.scripts?.test, "the verification command CI runs must be defined");
  assert.equal(
    pkg.bin,
    undefined,
    "the npm CLI is gone: a bin entry would point at a file that no longer exists"
  );
  for (const script of Object.values(pkg.scripts)) {
    assert.ok(
      !script.includes("src/cli.mjs"),
      `no npm script may still call the removed update engine: ${script}`
    );
  }
});

test("every path listed in files exists on disk", () => {
  const pkg = readJson("package.json");

  assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0, "files must be a non-empty array");

  for (const entry of pkg.files) {
    const stripped = entry.endsWith("/") ? entry.slice(0, -1) : entry;
    const fullPath = path.resolve(rootDir, stripped);
    assert.ok(existsSync(fullPath), `files entry must exist on disk: ${entry} (${fullPath})`);
  }
});

test("plugin.json carries the fields the plugin loader needs", () => {
  const plugin = readJson(".claude-plugin", "plugin.json");

  assert.equal(plugin.name, "harness");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.description?.length > 40, "description must say what the plugin is");
});

test("the marketplace entry points at this repository's plugin", () => {
  const marketplace = readJson(".claude-plugin", "marketplace.json");
  const plugin = readJson(".claude-plugin", "plugin.json");

  const entry = marketplace.plugins?.find((candidate) => candidate.name === plugin.name);
  assert.ok(entry, `marketplace.json must list a plugin named ${plugin.name}`);
  assert.equal(entry.version, plugin.version, "marketplace and plugin manifest must agree");
  assert.ok(
    existsSync(path.resolve(rootDir, entry.source)),
    `marketplace source must resolve: ${entry.source}`
  );
});

test("the plugin components the manifests promise are on disk", () => {
  for (const relPath of [
    "skills/harness/SKILL.md",
    "agents/harness-verifier.md",
    "scripts/issue-manager.mjs",
    "scripts/board-server.mjs",
    "scripts/harness-config.mjs",
    "scripts/harness-worker.mjs",
  ]) {
    assert.ok(existsSync(path.join(rootDir, relPath)), `missing plugin component: ${relPath}`);
  }
});
