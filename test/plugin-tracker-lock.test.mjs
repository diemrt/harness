import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { withTrackerLock } from "../scripts/tracker-lock.mjs";

function tempProject() {
  return mkdtempSync(path.join(tmpdir(), "harness-tracker-lock-"));
}

test("withTrackerLock writes ownership and removes its lock", () => {
  const dir = tempProject();
  const lockPath = path.join(dir, ".harness", "issue-manager.lock");
  try {
    withTrackerLock(dir, () => {
      const owner = JSON.parse(readFileSync(lockPath, "utf8"));
      assert.equal(owner.pid, process.pid);
      assert.equal(typeof owner.token, "string");
      assert.equal(typeof owner.created_at, "string");
    });
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withTrackerLock releases after a failing callback", () => {
  const dir = tempProject();
  const lockPath = path.join(dir, ".harness", "issue-manager.lock");
  try {
    assert.throws(() => withTrackerLock(dir, () => { throw new Error("boom"); }), /boom/);
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withTrackerLock reports a live owner as busy", () => {
  const dir = tempProject();
  const lockPath = path.join(dir, ".harness", "issue-manager.lock");
  try {
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString(), token: "other" }));
    assert.throws(
      () => withTrackerLock(dir, () => {}, { retryMs: 1, timeoutMs: 5 }),
      (error) => error.code === "TRACKER_BUSY"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withTrackerLock recovers an abandoned owner", () => {
  const dir = tempProject();
  const lockPath = path.join(dir, ".harness", "issue-manager.lock");
  try {
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, created_at: new Date().toISOString(), token: "abandoned" }));
    assert.equal(withTrackerLock(dir, () => "acquired"), "acquired");
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
