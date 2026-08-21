import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const lockWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

export class TrackerLockError extends Error {
  constructor(message) {
    super(message);
    this.code = "TRACKER_BUSY";
  }
}

function sleep(milliseconds) {
  Atomics.wait(lockWaitBuffer, 0, 0, milliseconds);
}

function lockPathFor(projectDir) {
  return path.join(projectDir, ".harness", "issue-manager.lock");
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function lockIsAbandoned(lockPath, now, graceMs) {
  let raw;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch (error) {
    return error?.code === "ENOENT";
  }
  try {
    const owner = JSON.parse(raw);
    return !processIsAlive(owner.pid);
  } catch {
    return now - statSync(lockPath).mtimeMs > graceMs;
  }
}

function acquire(projectDir, { retryMs, timeoutMs, graceMs, now }) {
  const lockPath = lockPathFor(projectDir);
  const token = randomUUID();
  const started = now();
  mkdirSync(path.dirname(lockPath), { recursive: true });
  while (true) {
    try {
      const file = openSync(lockPath, "wx");
      try {
        writeFileSync(file, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString(), token }) + "\n", "utf8");
      } finally {
        closeSync(file);
      }
      return { lockPath, token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    if (lockIsAbandoned(lockPath, now(), graceMs)) {
      rmSync(lockPath, { force: true });
      continue;
    }
    if (now() - started >= timeoutMs) {
      throw new TrackerLockError(`Tracker is busy: '${lockPath}' remained locked for ${timeoutMs} ms.`);
    }
    sleep(retryMs);
  }
}

function release(owner) {
  if (!existsSync(owner.lockPath)) return;
  try {
    const onDisk = JSON.parse(readFileSync(owner.lockPath, "utf8"));
    if (onDisk.token === owner.token) {
      rmSync(owner.lockPath, { force: true });
    }
  } catch {
    // A successor or an abandoned-lock recovery owns an unreadable/replaced file. Never remove it.
  }
}

export function withTrackerLock(projectDir, callback, options = {}) {
  const owner = acquire(projectDir, {
    retryMs: options.retryMs ?? 50,
    timeoutMs: options.timeoutMs ?? 5000,
    graceMs: options.graceMs ?? 5000,
    now: options.now ?? Date.now,
  });
  try {
    return callback();
  } finally {
    release(owner);
  }
}
