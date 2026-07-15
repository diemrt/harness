import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const hookPath = join(rootDir, "template", "hooks", "pre-commit.mjs");

/**
 * Creates a throwaway git repository in a temp dir with a dummy identity
 * and one staged file, so the hook has something to report on.
 */
function createStagedRepo() {
  const dir = mkdtempSync(join(tmpdir(), "harness-pre-commit-"));

  const run = (args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(
      result.status,
      0,
      `git ${args.join(" ")} failed: ${result.stderr}`,
    );
    return result;
  };

  run(["init"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test User"]);

  writeFileSync(join(dir, "file.txt"), "hello\n", "utf8");
  run(["add", "file.txt"]);

  return dir;
}

test("bypass: HARNESS_DOCS_VERIFIED=1 lets the commit through with no gate output", (t) => {
  const tmpRepo = createStagedRepo();
  t.after(() => rmSync(tmpRepo, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [hookPath], {
    cwd: tmpRepo,
    encoding: "utf8",
    env: { ...process.env, HARNESS_DOCS_VERIFIED: "1" },
  });

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stderr, /HARNESS PRE-COMMIT GATE/);
  assert.doesNotMatch(result.stdout, /HARNESS PRE-COMMIT GATE/);
});

test("worker role: HARNESS_ROLE=worker blocks the commit even with HARNESS_DOCS_VERIFIED=1", (t) => {
  const tmpRepo = createStagedRepo();
  t.after(() => rmSync(tmpRepo, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [hookPath], {
    cwd: tmpRepo,
    encoding: "utf8",
    env: { ...process.env, HARNESS_ROLE: "worker", HARNESS_DOCS_VERIFIED: "1" },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /worker/i);
  assert.doesNotMatch(result.stderr, /HARNESS PRE-COMMIT GATE — verifica documentazione/);
});

test("block: without HARNESS_DOCS_VERIFIED the commit is blocked with instructions", (t) => {
  const tmpRepo = createStagedRepo();
  t.after(() => rmSync(tmpRepo, { recursive: true, force: true }));

  const env = { ...process.env };
  delete env.HARNESS_DOCS_VERIFIED;

  const result = spawnSync(process.execPath, [hookPath], {
    cwd: tmpRepo,
    encoding: "utf8",
    env,
  });

  assert.equal(result.status, 1);
  // The gate now instructs the agent to FILE a new docs issue rather than
  // edit docs inline; assert the message reflects that flow.
  assert.match(result.stderr, /nuova issue/i);
  assert.match(result.stderr, /issue-manager\.mjs --insert/);
  assert.match(result.stderr, /meno testo possibile/);
  assert.match(result.stderr, /AGENTS\.md/);
  assert.match(result.stderr, /HARNESS_DOCS_VERIFIED/);
  assert.match(result.stderr, /file\.txt/);
});
