import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLI_PATH = join(REPO_ROOT, "src", "cli.mjs");
const TEMPLATE_DIR = join(REPO_ROOT, "template");
const MANIFEST_FILE = ".harness-manifest.json";

function toPosixPath(p) {
  return p.split("\\").join("/");
}

function walkFiles(rootDir) {
  const results = [];
  function walk(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(toPosixPath(relative(rootDir, fullPath)));
      }
    }
  }
  walk(rootDir);
  return results.sort();
}

function walkAllEntries(rootDir) {
  // returns relative paths (posix) for both files and directories, excluding rootDir itself
  const results = [];
  function walk(currentDir, prefix) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      results.push({ path: toPosixPath(relPath), isDirectory: entry.isDirectory() });
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      }
    }
  }
  walk(rootDir, "");
  return results;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function expectedPolicy(relPath) {
  if (relPath === "issues.json") return "data";
  if (
    relPath === "AGENTS.md" ||
    relPath === "docs/ARCHITECTURE.md" ||
    relPath === "init.config.json"
  ) {
    return "seeded-once";
  }
  return "managed";
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  return pkg.version;
}

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "harness-cli-"));
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
  });
}

const TEMPLATE_FILES = walkFiles(TEMPLATE_DIR);
const PACKAGE_VERSION = readPackageVersion();

test("init into an empty dir creates every template file plus the manifest", (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const result = runCli(["init", tmpDir]);
  assert.equal(result.status, 0, result.stderr);

  for (const relPath of TEMPLATE_FILES) {
    const destPath = join(tmpDir, ...relPath.split("/"));
    assert.ok(existsSync(destPath), `expected ${relPath} to exist`);
  }

  // only subdirectory should be docs/
  const entries = walkAllEntries(tmpDir);
  const dirs = entries.filter((e) => e.isDirectory).map((e) => e.path);
  assert.deepEqual(dirs.sort(), ["docs"]);

  const manifestPath = join(tmpDir, MANIFEST_FILE);
  assert.ok(existsSync(manifestPath), "manifest should exist");
});

test("manifest content: version, generatedAt, hashes, and policies", (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const result = runCli(["init", tmpDir]);
  assert.equal(result.status, 0, result.stderr);

  const manifest = JSON.parse(readFileSync(join(tmpDir, MANIFEST_FILE), "utf8"));

  assert.equal(manifest.harnessVersion, PACKAGE_VERSION);
  assert.ok(!Number.isNaN(Date.parse(manifest.generatedAt)), "generatedAt should parse as a date");

  const manifestKeys = Object.keys(manifest.files);
  assert.deepEqual(manifestKeys, TEMPLATE_FILES, "manifest should list exactly the template files, sorted");

  // keys must be lexicographically sorted
  const sortedKeys = [...manifestKeys].sort();
  assert.deepEqual(manifestKeys, sortedKeys);

  for (const relPath of TEMPLATE_FILES) {
    const entry = manifest.files[relPath];
    assert.ok(entry, `manifest missing entry for ${relPath}`);

    const destPath = join(tmpDir, ...relPath.split("/"));
    const onDisk = readFileSync(destPath);
    assert.equal(entry.sha256, sha256(onDisk), `hash mismatch for ${relPath}`);

    assert.equal(entry.policy, expectedPolicy(relPath), `policy mismatch for ${relPath}`);
  }
});

test("init reports files as added on first run", (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const result = runCli(["init", tmpDir, "--json"]);
  assert.equal(result.status, 0, result.stderr);

  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 1, "expected exactly one line of JSON");
  const json = JSON.parse(lines[0]);

  assert.equal(json.ok, true);
  assert.equal(json.action, "init");
  assert.deepEqual(json.added, TEMPLATE_FILES);
  assert.deepEqual(json.updated, []);
  assert.deepEqual(json.skipped, []);
  assert.deepEqual(json.conflicts, []);
  assert.deepEqual(json.removed, []);
});

test("init over a pre-existing file leaves content untouched and reports skipped; --force overwrites", (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const sentinelRelPath = TEMPLATE_FILES[0];
  const sentinelDestPath = join(tmpDir, ...sentinelRelPath.split("/"));
  const customContent = "custom user content that must survive\n";
  writeFileSync(sentinelDestPath, customContent);

  const result1 = runCli(["init", tmpDir, "--json"]);
  assert.equal(result1.status, 0, result1.stderr);
  const json1 = JSON.parse(result1.stdout.trim());

  assert.ok(json1.skipped.includes(sentinelRelPath), "expected file to be skipped");
  assert.ok(!json1.added.includes(sentinelRelPath));
  assert.ok(!json1.updated.includes(sentinelRelPath));
  assert.equal(readFileSync(sentinelDestPath, "utf8"), customContent, "content should be untouched");

  // even though skipped, the manifest must record the template hash
  const manifest1 = JSON.parse(readFileSync(join(tmpDir, MANIFEST_FILE), "utf8"));
  const templateBuf = readFileSync(join(TEMPLATE_DIR, ...sentinelRelPath.split("/")));
  assert.equal(manifest1.files[sentinelRelPath].sha256, sha256(templateBuf));

  // now force overwrite
  const result2 = runCli(["init", tmpDir, "--force", "--json"]);
  assert.equal(result2.status, 0, result2.stderr);
  const json2 = JSON.parse(result2.stdout.trim());

  assert.ok(json2.updated.includes(sentinelRelPath), "expected file to be updated with --force");
  assert.ok(!json2.skipped.includes(sentinelRelPath));
  assert.equal(readFileSync(sentinelDestPath, "utf8"), templateBuf.toString("utf8"), "content should now match template");
});

test("--dry-run on an empty dir creates nothing on disk yet reports files it would add", (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const result = runCli(["init", tmpDir, "--dry-run", "--json"]);
  assert.equal(result.status, 0, result.stderr);

  const json = JSON.parse(result.stdout.trim());
  assert.deepEqual(json.added, TEMPLATE_FILES);

  const entries = readdirSync(tmpDir);
  assert.deepEqual(entries, [], "directory should still be empty, manifest included");
  assert.ok(!existsSync(join(tmpDir, MANIFEST_FILE)), "manifest should not be written on dry-run");
});

test("--json prints exactly one line of parsable JSON", (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const result = runCli(["init", tmpDir, "--json"]);
  assert.equal(result.status, 0, result.stderr);

  const trimmed = result.stdout.replace(/\n+$/, "");
  const lines = trimmed.split("\n");
  assert.equal(lines.length, 1);
  assert.doesNotThrow(() => JSON.parse(lines[0]));
});

test("update exits 1 with a clean error rather than a stack trace", (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const result = runCli(["update", tmpDir]);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /at .*\.mjs:\d+:\d+/, "stderr should not contain a stack trace");
  assert.doesNotMatch(result.stdout, /at .*\.mjs:\d+:\d+/, "stdout should not contain a stack trace");

  const jsonResult = runCli(["update", tmpDir, "--json"]);
  assert.equal(jsonResult.status, 1);
  const lines = jsonResult.stdout.trim().split("\n");
  assert.equal(lines.length, 1, "expected exactly one line of JSON on fatal error");
  const json = JSON.parse(lines[0]);
  assert.equal(json.ok, false);
  assert.ok(typeof json.error === "string" && json.error.length > 0);
  assert.ok(typeof json.code === "string" && json.code.length > 0);
});

test("--help and --version work", () => {
  const helpResult = runCli(["--help"]);
  assert.equal(helpResult.status, 0);
  assert.match(helpResult.stdout, /Usage: harness/);

  const versionResult = runCli(["--version"]);
  assert.equal(versionResult.status, 0);
  assert.equal(versionResult.stdout.trim(), PACKAGE_VERSION);
});

test("unknown command prints usage to stderr and exits 1", () => {
  const result = runCli(["frobnicate"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: harness/);
});

test("no command prints usage to stderr and exits 1", () => {
  const result = runCli([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: harness/);
});
