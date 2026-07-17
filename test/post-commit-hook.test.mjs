import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const templateHookPath = join(rootDir, "template", "hooks", "post-commit.mjs");
const templateMatchPath = join(rootDir, "template", "hooks", "match.mjs");
const templateIssueManagerPath = join(rootDir, "template", "issue-manager.mjs");
const templateIssuesSeedPath = join(rootDir, "template", "issues.json");

const DEFAULT_DOCS_GATE = {
  enabled: true,
  include: [
    "**/*.mjs",
    "**/*.js",
    "**/*.cjs",
    "**/*.ts",
    "**/*.tsx",
    "**/*.jsx",
    "**/*.py",
    "**/*.go",
    "**/*.cs",
    "**/*.java",
    "**/*.rb",
    "**/*.rs",
    "**/*.php",
  ],
  exclude: [
    "docs/**",
    "test/**",
    "tests/**",
    "**/*.md",
    "issues.json",
    ".harness-manifest.json",
  ],
};

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8" });
}

function runGit(cwd, ...args) {
  const result = run("git", args, cwd);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function writeUtf8(baseDir, relPath, content) {
  const absPath = join(baseDir, ...relPath.split("/"));
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, "utf8");
}

function commitFile(repoDir, relPath, content, subject) {
  writeUtf8(repoDir, relPath, content);
  runGit(repoDir, "add", relPath);
  runGit(repoDir, "commit", "-m", subject);
}

function setupHarnessRepo(t, options = {}) {
  const { withConfig = true, docsGateConfig = DEFAULT_DOCS_GATE, withIssueManager = true } = options;
  const dir = mkdtempSync(join(tmpdir(), "harness-post-commit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  mkdirSync(join(dir, "hooks"), { recursive: true });
  copyFileSync(templateHookPath, join(dir, "hooks", "post-commit.mjs"));
  copyFileSync(templateMatchPath, join(dir, "hooks", "match.mjs"));
  if (withIssueManager) {
    copyFileSync(templateIssueManagerPath, join(dir, "issue-manager.mjs"));
  }
  copyFileSync(templateIssuesSeedPath, join(dir, "issues.json"));

  if (withConfig) {
    writeFileSync(join(dir, "init.config.json"), `${JSON.stringify({ docsGate: docsGateConfig }, null, 2)}\n`, "utf8");
  }

  runGit(dir, "init");
  runGit(dir, "config", "user.email", "harness@example.com");
  runGit(dir, "config", "user.name", "Harness Test");
  runGit(dir, "config", "commit.gpgsign", "false");
  return dir;
}

function runPostCommitHook(repoDir) {
  return run(process.execPath, [join(repoDir, "hooks", "post-commit.mjs")], repoDir);
}

function readIssues(repoDir) {
  const data = JSON.parse(readFileSync(join(repoDir, "issues.json"), "utf8"));
  return data.issues;
}

test("code commit creates docs issue with expected payload and warning", (t) => {
  const repoDir = setupHarnessRepo(t);
  commitFile(repoDir, "a.mjs", "export const a = 1;\n", "feat: add a module");

  const shortSha = runGit(repoDir, "rev-parse", "--short", "HEAD");
  const hookResult = runPostCommitHook(repoDir);

  assert.equal(hookResult.status, 0);
  assert.equal(hookResult.stdout, "");

  const issues = readIssues(repoDir);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].status, "backlog");
  assert.equal(issues[0].validation.state, "unknown");
  assert.match(
    issues[0].validation.criteria,
    /che non siano state introdotte delle ripetizioni in documenti diversi/
  );
  assert.match(issues[0].description, /- a\.mjs/);
  assert.match(issues[0].description, new RegExp(shortSha));
  assert.match(hookResult.stderr, new RegExp(issues[0].id));
});

test("docs-only commit does not create any issue and stays silent", (t) => {
  const repoDir = setupHarnessRepo(t);
  commitFile(repoDir, "docs/x.md", "# docs only\n", "docs: update notes");

  const hookResult = runPostCommitHook(repoDir);

  assert.equal(hookResult.status, 0);
  assert.equal(hookResult.stdout, "");
  assert.equal(hookResult.stderr, "");
  assert.equal(readIssues(repoDir).length, 0);
});

test("docsGate.enabled false disables issue creation", (t) => {
  const repoDir = setupHarnessRepo(t, {
    docsGateConfig: {
      ...DEFAULT_DOCS_GATE,
      enabled: false,
    },
  });
  commitFile(repoDir, "a.mjs", "export const a = 2;\n", "feat: gate off");

  const hookResult = runPostCommitHook(repoDir);

  assert.equal(hookResult.status, 0);
  assert.equal(hookResult.stdout, "");
  assert.equal(hookResult.stderr, "");
  assert.equal(readIssues(repoDir).length, 0);
});

test("missing init.config.json uses internal defaults and still creates issue", (t) => {
  const repoDir = setupHarnessRepo(t, { withConfig: false });
  commitFile(repoDir, "a.mjs", "export const a = 3;\n", "feat: missing config");

  const hookResult = runPostCommitHook(repoDir);

  assert.equal(hookResult.status, 0);
  assert.equal(readIssues(repoDir).length, 1);
  assert.match(hookResult.stderr, /HARNESS: creata issue docs/);
});

test("missing issue-manager.mjs warns and never crashes", (t) => {
  const repoDir = setupHarnessRepo(t, { withIssueManager: false });
  commitFile(repoDir, "a.mjs", "export const a = 4;\n", "feat: missing manager");

  const hookResult = runPostCommitHook(repoDir);

  assert.equal(hookResult.status, 0);
  assert.equal(hookResult.stdout, "");
  assert.match(hookResult.stderr, /HARNESS: post-commit warning/i);
  assert.match(hookResult.stderr, /issue-manager\.mjs/i);
  assert.equal(readIssues(repoDir).length, 0);
});

test("two consecutive code commits create two distinct docs issues", (t) => {
  const repoDir = setupHarnessRepo(t);
  commitFile(repoDir, "a.mjs", "export const a = 5;\n", "feat: first");
  const firstRun = runPostCommitHook(repoDir);
  commitFile(repoDir, "b.mjs", "export const b = 6;\n", "feat: second");
  const secondRun = runPostCommitHook(repoDir);

  assert.equal(firstRun.status, 0);
  assert.equal(secondRun.status, 0);

  const issues = readIssues(repoDir);
  assert.equal(issues.length, 2);
  assert.notEqual(issues[0].id, issues[1].id);
});
