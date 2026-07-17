import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const hookPath = join(rootDir, "template", "hooks", "pre-commit.mjs");
const legacyDocsBypassKey = ["HARNESS", "DOCS", "VERIFIED"].join("_");

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "harness-pre-commit-"));
  return dir;
}

test("worker role is always blocked with an explicit no-bypass message", (t) => {
  const tmpDir = createTempDir();
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [hookPath], {
    cwd: tmpDir,
    encoding: "utf8",
    env: {
      ...process.env,
      HARNESS_ROLE: "worker",
      [legacyDocsBypassKey]: "1",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /worker/i);
  assert.match(result.stderr, /regola di ruolo definitiva/i);
  assert.match(result.stderr, /non esiste alcun bypass/i);
  assert.equal(result.stdout, "");
});

test("non-worker exits 0 with no output", (t) => {
  const tmpDir = createTempDir();
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.HARNESS_ROLE;
  delete env[legacyDocsBypassKey];

  const result = spawnSync(process.execPath, [hookPath], {
    cwd: tmpDir,
    encoding: "utf8",
    env,
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("legacy docs bypass variable has no effect for non-worker", (t) => {
  const tmpDir = createTempDir();
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));
  const env = { ...process.env, [legacyDocsBypassKey]: "1" };
  delete env.HARNESS_ROLE;

  const result = spawnSync(process.execPath, [hookPath], {
    cwd: tmpDir,
    encoding: "utf8",
    env,
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
