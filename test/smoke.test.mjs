// Packaging smoke test. The v1 harness shipped an npm CLI, so this file used to guard
// `bin`, `files` and the template seed. The repository is a Claude Code plugin now: what
// has to stay honest is the plugin manifest and the marketplace entry that points at it,
// plus the one thing package.json is still for — the test script CI runs. Everything else
// npm-shaped is asserted ABSENT, so the publishing surface cannot grow back unnoticed.

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

test("package.json declares no npm publishing surface", () => {
  const pkg = readJson("package.json");

  // This replaces a test that walked the `files` list. publish.yml was deleted in ec832c6, so no
  // workflow reacts to a v* tag any more — but a deleted file protects today, not the decision.
  // `private: true` is the lock that outlives it, and it bites on a REAL publish only: measured on
  // npm 11.8.0, `npm publish --dry-run` ignores `private` entirely — it builds the tarball, says
  // "Publishing to registry (dry-run)" and exits 0. So do not read a green dry-run as proof of
  // anything here; this assertion is the check, not npm's own behaviour.
  assert.equal(pkg.private, true, "the package must be private so a real npm publish refuses");

  // A `version` here would be a SECOND version number beside .claude-plugin/, which is the only
  // one consumers ever see; `files` and `publishConfig` describe a tarball nobody builds. Each is
  // harmless on its own and misleading together, which is why they go as a set.
  for (const field of ["version", "files", "publishConfig"]) {
    assert.equal(
      pkg[field],
      undefined,
      `${field} belongs to publishing a package this repository does not publish`
    );
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
