import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

test("withTrackerLock never releases a successor's token", () => {
  const dir = tempProject();
  const lockPath = path.join(dir, ".harness", "issue-manager.lock");
  try {
    withTrackerLock(dir, () => {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString(), token: "successor" }));
    });
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).token, "successor");
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

test("withTrackerLock does not steal an old lock whose owner is alive", () => {
  const dir = tempProject();
  const lockPath = path.join(dir, ".harness", "issue-manager.lock");
  try {
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, created_at: "1970-01-01T00:00:00.000Z", token: "live-old" }));
    assert.throws(
      () => withTrackerLock(dir, () => {}, { retryMs: 1, timeoutMs: 5, graceMs: 1 }),
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

test("withTrackerLock waits for a partial lock, then recovers it after its grace period", () => {
  const dir = tempProject();
  const lockPath = path.join(dir, ".harness", "issue-manager.lock");
  try {
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, "{");
    assert.throws(
      () => withTrackerLock(dir, () => {}, { retryMs: 1, timeoutMs: 5, graceMs: 60_000 }),
      (error) => error.code === "TRACKER_BUSY"
    );
    const old = new Date(0);
    utimesSync(lockPath, old, old);
    assert.equal(withTrackerLock(dir, () => "recovered", { graceMs: 1 }), "recovered");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
