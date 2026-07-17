#!/usr/bin/env node
/**
 * Installer for the harness git hooks.
 *
 * Idempotent: safe to run on every `setup` (fresh clone, re-run, CI, ...).
 * core.hooksPath is local git config per clone, so it must be re-applied
 * every time this script runs; setting it again when already correct is a
 * harmless no-op.
 *
 * Zero runtime dependencies: only node:* builtins plus the git binary.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";

const HOOKS_DIR = "hooks";
const PRE_COMMIT_HOOK = "hooks/pre-commit";
const POST_COMMIT_HOOK = "hooks/post-commit";

function hasGitDir() {
  if (existsSync(".git")) {
    return true;
  }
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!hasGitDir()) {
  console.warn(
    "WARNING: no .git directory found, skipping git hooks installation."
  );
  process.exit(0);
}

try {
  execFileSync("git", ["config", "core.hooksPath", HOOKS_DIR]);
} catch (error) {
  console.warn(
    `WARNING: failed to set core.hooksPath, skipping git hooks installation: ${error.message}`
  );
  process.exit(0);
}

// Best-effort: mark the hook as executable. chmod is a no-op on Windows and
// must never fail the installer.
for (const hookPath of [PRE_COMMIT_HOOK, POST_COMMIT_HOOK]) {
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // ignore: harmless on platforms without POSIX permission bits, or if the
    // hook file does not exist yet.
  }
}

console.log(`Git hooks installed: core.hooksPath=${HOOKS_DIR}`);
process.exit(0);
