import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SRC_DIR = join(REPO_ROOT, "src");
const MANIFEST_FILE = ".harness-manifest.json";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Writes a { "relative/path": "content" } map to baseDir, creating
 * intermediate directories as needed.
 */
function writeFilesMap(baseDir, filesMap) {
  for (const [relPath, content] of Object.entries(filesMap)) {
    const destPath = join(baseDir, ...relPath.split("/"));
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, content);
  }
}

/**
 * Builds a standalone fake package root inside a fresh tmp dir: a
 * package.json with the given version, a template/ directory authored
 * from templateFilesMap, and a copy of this repo's src/ so that
 * actions.mjs (which locates template/ and package.json relative to its
 * own file location) resolves everything inside the fake root instead of
 * the real repo.
 */
function buildFakeRoot(version, templateFilesMap) {
  const root = makeTmpDir("harness-fakepkg-");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "@diemrt/harness", version }, null, 2)
  );
  cpSync(SRC_DIR, join(root, "src"), { recursive: true });
  mkdirSync(join(root, "template"), { recursive: true });
  writeFilesMap(join(root, "template"), templateFilesMap);
  return { root, cliPath: join(root, "src", "cli.mjs") };
}

/**
 * Writes a manifest by hand (bypassing init) so tests can construct exact
 * "old manifest" scenarios, including entries deliberately absent.
 */
function writeManifestFile(projectDir, harnessVersion, filesEntries) {
  const manifest = {
    harnessVersion,
    generatedAt: new Date().toISOString(),
    files: filesEntries,
  };
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function readManifestFile(projectDir) {
  return JSON.parse(readFileSync(join(projectDir, MANIFEST_FILE), "utf8"));
}

function runUpdate(cliPath, projectDir, extraArgs = []) {
  return spawnSync(process.execPath, [cliPath, "update", projectDir, ...extraArgs], {
    encoding: "utf8",
  });
}

function cleanup(t, ...dirs) {
  t.after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
}

test("managed + pristine (disk matches old manifest hash, template changed) -> overwritten, classified updated, exit 0", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const v1 = "v1 content\n";
  const v2 = "v2 content\n";
  cleanup(t, projectDir);

  writeFilesMap(projectDir, { "foo.txt": v1 });
  writeManifestFile(projectDir, "1.0.0", {
    "foo.txt": { sha256: sha256(v1), policy: "managed" },
  });

  const { root, cliPath } = buildFakeRoot("2.0.0", { "foo.txt": v2 });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--json"]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.deepEqual(json.updated, ["foo.txt"]);
  assert.deepEqual(json.conflicts, []);
  assert.equal(readFileSync(join(projectDir, "foo.txt"), "utf8"), v2);
});

test("managed + already current (disk matches new template hash) -> skipped, file untouched", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const v1 = "v1 content\n";
  const v2 = "v2 content\n";
  cleanup(t, projectDir);

  // Disk already holds the new template's bytes (e.g. user already applied
  // it by hand), while the manifest still records the old hash.
  writeFilesMap(projectDir, { "foo.txt": v2 });
  writeManifestFile(projectDir, "1.0.0", {
    "foo.txt": { sha256: sha256(v1), policy: "managed" },
  });

  const { root, cliPath } = buildFakeRoot("2.0.0", { "foo.txt": v2 });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--json"]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.deepEqual(json.skipped, ["foo.txt"]);
  assert.deepEqual(json.updated, []);
  assert.equal(readFileSync(join(projectDir, "foo.txt"), "utf8"), v2);
});

test("managed + diverged, no --force -> .new holds new template bytes, original untouched, classified conflicted, exit 2", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const v1 = "v1 content\n";
  const v2 = "v2 content\n";
  const userContent = "user edited this file by hand\n";
  cleanup(t, projectDir);

  writeFilesMap(projectDir, { "foo.txt": userContent });
  writeManifestFile(projectDir, "1.0.0", {
    "foo.txt": { sha256: sha256(v1), policy: "managed" },
  });

  const { root, cliPath } = buildFakeRoot("2.0.0", { "foo.txt": v2 });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--json"]);
  assert.equal(result.status, 2, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.deepEqual(json.conflicts, ["foo.txt"]);
  assert.equal(readFileSync(join(projectDir, "foo.txt"), "utf8"), userContent, "original must be byte-identical to user content");
  assert.ok(existsSync(join(projectDir, "foo.txt.new")), "expected foo.txt.new to exist");
  assert.equal(readFileSync(join(projectDir, "foo.txt.new"), "utf8"), v2, ".new must hold new template bytes");

  // Manifest converges to the new template hash even for conflicted files.
  const manifest = readManifestFile(projectDir);
  assert.equal(manifest.harnessVersion, "2.0.0");
  assert.equal(manifest.files["foo.txt"].sha256, sha256(v2));
});

test("managed + diverged, with --force -> file overwritten, no .new written, classified updated, exit 0", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const v1 = "v1 content\n";
  const v2 = "v2 content\n";
  const userContent = "user edited this file by hand\n";
  cleanup(t, projectDir);

  writeFilesMap(projectDir, { "foo.txt": userContent });
  writeManifestFile(projectDir, "1.0.0", {
    "foo.txt": { sha256: sha256(v1), policy: "managed" },
  });

  const { root, cliPath } = buildFakeRoot("2.0.0", { "foo.txt": v2 });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--force", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.deepEqual(json.updated, ["foo.txt"]);
  assert.deepEqual(json.conflicts, []);
  assert.equal(readFileSync(join(projectDir, "foo.txt"), "utf8"), v2);
  assert.ok(!existsSync(join(projectDir, "foo.txt.new")), "no .new file should be written with --force");
});

test("seeded-once, present and user-modified -> never touched, no .new, classified skipped", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const userContent = "my own agent notes\n";
  cleanup(t, projectDir);

  writeFilesMap(projectDir, { "AGENTS.md": userContent });
  writeManifestFile(projectDir, "1.0.0", {
    "AGENTS.md": { sha256: sha256("template v1 agents\n"), policy: "seeded-once" },
  });

  const { root, cliPath } = buildFakeRoot("2.0.0", { "AGENTS.md": "template v2 agents\n" });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--json"]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.deepEqual(json.skipped, ["AGENTS.md"]);
  assert.equal(readFileSync(join(projectDir, "AGENTS.md"), "utf8"), userContent);
  assert.ok(!existsSync(join(projectDir, "AGENTS.md.new")));
});

test("seeded-once, absent -> written, classified added", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  cleanup(t, projectDir);

  writeManifestFile(projectDir, "1.0.0", {});

  const { root, cliPath } = buildFakeRoot("2.0.0", { "AGENTS.md": "template v2 agents\n" });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--json"]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.deepEqual(json.added, ["AGENTS.md"]);
  assert.equal(readFileSync(join(projectDir, "AGENTS.md"), "utf8"), "template v2 agents\n");
});

test("data (issues.json) with user content -> never touched, classified skipped", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const userContent = JSON.stringify({ issues: [{ id: 1, title: "user issue" }] });
  cleanup(t, projectDir);

  writeFilesMap(projectDir, { "issues.json": userContent });
  writeManifestFile(projectDir, "1.0.0", {
    "issues.json": { sha256: sha256("[]"), policy: "data" },
  });

  const { root, cliPath } = buildFakeRoot("2.0.0", { "issues.json": "[]" });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--json"]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.deepEqual(json.skipped, ["issues.json"]);
  assert.equal(readFileSync(join(projectDir, "issues.json"), "utf8"), userContent);
});

test("file new in template, absent from old manifest, not on disk -> added", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const keep = "unchanged\n";
  cleanup(t, projectDir);

  writeFilesMap(projectDir, { "keep.txt": keep });
  writeManifestFile(projectDir, "1.0.0", {
    "keep.txt": { sha256: sha256(keep), policy: "managed" },
  });

  const { root, cliPath } = buildFakeRoot("2.0.0", {
    "keep.txt": keep,
    "bar.txt": "brand new file\n",
  });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--json"]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.deepEqual(json.added, ["bar.txt"]);
  assert.equal(readFileSync(join(projectDir, "bar.txt"), "utf8"), "brand new file\n");
});

test("file new in template, absent from old manifest, already on disk with different content -> conflicted, exit 2", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const keep = "unchanged\n";
  const existingBar = "pre-existing unrelated content\n";
  cleanup(t, projectDir);

  writeFilesMap(projectDir, { "keep.txt": keep, "bar.txt": existingBar });
  writeManifestFile(projectDir, "1.0.0", {
    "keep.txt": { sha256: sha256(keep), policy: "managed" },
  });

  const { root, cliPath } = buildFakeRoot("2.0.0", {
    "keep.txt": keep,
    "bar.txt": "brand new template content\n",
  });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--json"]);
  assert.equal(result.status, 2, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.deepEqual(json.conflicts, ["bar.txt"]);
  assert.equal(readFileSync(join(projectDir, "bar.txt"), "utf8"), existingBar);
  assert.equal(readFileSync(join(projectDir, "bar.txt.new"), "utf8"), "brand new template content\n");
});

test("managed file dropped from template, pristine on disk -> deleted, classified removed, entry gone from manifest", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const dropped = "old managed content\n";
  cleanup(t, projectDir);

  writeFilesMap(projectDir, { "dropped.txt": dropped });
  writeManifestFile(projectDir, "1.0.0", {
    "dropped.txt": { sha256: sha256(dropped), policy: "managed" },
  });

  const { root, cliPath } = buildFakeRoot("2.0.0", { "keep.txt": "keep\n" });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--json"]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.deepEqual(json.removed, ["dropped.txt"]);
  assert.ok(!existsSync(join(projectDir, "dropped.txt")), "dropped.txt should be deleted");

  const manifest = readManifestFile(projectDir);
  assert.ok(!("dropped.txt" in manifest.files), "manifest entry should be gone");
});

test("managed file dropped from template, diverged on disk -> left on disk, classified orphaned, entry gone from manifest", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const original = "old managed content\n";
  const userEdited = "user edited this before it got dropped\n";
  cleanup(t, projectDir);

  writeFilesMap(projectDir, { "dropped.txt": userEdited });
  writeManifestFile(projectDir, "1.0.0", {
    "dropped.txt": { sha256: sha256(original), policy: "managed" },
  });

  const { root, cliPath } = buildFakeRoot("2.0.0", { "keep.txt": "keep\n" });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--json"]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.deepEqual(json.orphaned, ["dropped.txt"]);
  assert.ok(existsSync(join(projectDir, "dropped.txt")), "dropped.txt should remain on disk");
  assert.equal(readFileSync(join(projectDir, "dropped.txt"), "utf8"), userEdited);

  const manifest = readManifestFile(projectDir);
  assert.ok(!("dropped.txt" in manifest.files), "manifest entry should be gone");
});

test("seeded-once file dropped from template -> left on disk", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const content = "seeded once content, possibly user-edited\n";
  cleanup(t, projectDir);

  writeFilesMap(projectDir, { "AGENTS.md": content });
  writeManifestFile(projectDir, "1.0.0", {
    "AGENTS.md": { sha256: sha256("template v1 agents\n"), policy: "seeded-once" },
  });

  const { root, cliPath } = buildFakeRoot("2.0.0", { "keep.txt": "keep\n" });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--json"]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.ok(!json.removed.includes("AGENTS.md"));
  assert.ok(!json.orphaned.includes("AGENTS.md"));
  assert.ok(existsSync(join(projectDir, "AGENTS.md")), "AGENTS.md should remain on disk");
  assert.equal(readFileSync(join(projectDir, "AGENTS.md"), "utf8"), content);

  const manifest = readManifestFile(projectDir);
  assert.ok(!("AGENTS.md" in manifest.files), "manifest entry should be gone");
});

test("--dry-run on a dir with a pending conflict writes nothing at all, yet reports the conflict", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const v1 = "v1 content\n";
  const v2 = "v2 content\n";
  const userContent = "user edited this file by hand\n";
  cleanup(t, projectDir);

  writeFilesMap(projectDir, { "foo.txt": userContent });
  writeManifestFile(projectDir, "1.0.0", {
    "foo.txt": { sha256: sha256(v1), policy: "managed" },
  });
  const manifestBefore = readFileSync(join(projectDir, MANIFEST_FILE), "utf8");

  const { root, cliPath } = buildFakeRoot("2.0.0", { "foo.txt": v2 });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--dry-run", "--json"]);
  assert.equal(result.status, 2, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.deepEqual(json.conflicts, ["foo.txt"]);
  assert.ok(!existsSync(join(projectDir, "foo.txt.new")), "dry-run must not write .new");
  assert.equal(readFileSync(join(projectDir, "foo.txt"), "utf8"), userContent, "dry-run must not touch the original");
  assert.equal(readFileSync(join(projectDir, MANIFEST_FILE), "utf8"), manifestBefore, "dry-run must not touch the manifest");
});

test("update on a directory with no manifest behaves like init, but action is 'update'", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  cleanup(t, projectDir);

  const { root, cliPath } = buildFakeRoot("2.0.0", {
    "foo.txt": "hello\n",
    "docs/bar.txt": "nested\n",
  });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir, ["--json"]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout.trim());

  assert.equal(json.ok, true);
  assert.equal(json.action, "update");
  assert.deepEqual(json.added.sort(), ["docs/bar.txt", "foo.txt"]);
  assert.deepEqual(json.conflicts, []);
  assert.ok(existsSync(join(projectDir, "foo.txt")));
  assert.ok(existsSync(join(projectDir, "docs", "bar.txt")));

  const manifest = readManifestFile(projectDir);
  assert.equal(manifest.harnessVersion, "2.0.0");
  assert.ok("foo.txt" in manifest.files);
  assert.ok("docs/bar.txt" in manifest.files);
});

test("human-readable output prints one line per file with its classification and a hint for conflicts", (t) => {
  const projectDir = makeTmpDir("harness-proj-");
  const v1 = "v1 content\n";
  const v2 = "v2 content\n";
  const userContent = "user edited this file by hand\n";
  cleanup(t, projectDir);

  writeFilesMap(projectDir, { "foo.txt": userContent });
  writeManifestFile(projectDir, "1.0.0", {
    "foo.txt": { sha256: sha256(v1), policy: "managed" },
  });

  const { root, cliPath } = buildFakeRoot("2.0.0", { "foo.txt": v2 });
  cleanup(t, root);

  const result = runUpdate(cliPath, projectDir);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /conflicts\s+foo\.txt/);
  assert.match(result.stdout, /foo\.txt\.new/, "expected a hint naming the .new file");
  assert.match(result.stdout, /1 conflict/i);
  assert.match(result.stdout, /exit code 2/i);
});
