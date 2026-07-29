// The board's two promises are testable: it must be reachable only from loopback, and a change to
// issues.json must reach an open browser without the browser asking. Everything else is rendering.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(rootDir, "scripts", "board-server.mjs");
const ISSUE_MANAGER = path.join(rootDir, "scripts", "issue-manager.mjs");

function seed(issues = []) {
  return JSON.stringify({ last_updated: "2026-01-01T00:00:00Z", issues }, null, 2);
}

function issue(id, overrides = {}) {
  return {
    id,
    title: `Issue ${id.slice(0, 4)}`,
    description: "description",
    status: "backlog",
    validation: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function tempProject(content) {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-board-"));
  if (content !== null) {
    writeFileSync(path.join(dir, "issues.json"), content, "utf8");
  }
  return dir;
}

// Starts the server and resolves with its startup line, so tests never guess a port.
function startServer(projectDir, args = []) {
  const child = spawn(process.execPath, [SERVER_PATH, "--project-dir", projectDir, ...args], {
    encoding: "utf8",
  });
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("server did not start in time")), 10_000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      clearTimeout(timer);
      const parsed = JSON.parse(buffer.slice(0, newline));
      if (!parsed.ok) {
        reject(new Error(`server failed: ${parsed.code}`));
        return;
      }
      resolve({ child, ...parsed.data });
    });
    child.on("error", reject);
  });
}

function stop(child) {
  child.kill();
}

// Reads server-sent events until `predicate` is satisfied or the timeout expires.
async function waitForEvent(url, trigger, timeoutMs = 8000) {
  const controller = new AbortController();
  const response = await fetch(`${url}events`, { signal: controller.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  // Only trigger once the stream is actually open, otherwise the push can happen first.
  await trigger();

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        return false;
      }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes("event: issues")) {
        return true;
      }
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

test("the board serves the page and the project's issues", async () => {
  const dir = tempProject(seed([issue("11111111-1111-1111-1111-111111111111")]));
  const { child, url, port } = await startServer(dir);
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /Harness board/);

    const api = await fetch(`${url}api/issues`);
    const data = await api.json();
    assert.equal(data.issues.length, 1);
    assert.equal(data.issues[0].id, "11111111-1111-1111-1111-111111111111");
    assert.equal(data.projectDir, dir);
    assert.ok(port > 0, "the OS must hand out a real port");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the board is bound to loopback only", async () => {
  const dir = tempProject(seed());
  const { child, port } = await startServer(dir);
  try {
    // A server listening on 0.0.0.0 would also answer on the machine's other addresses.
    const connections = spawnSync(
      process.execPath,
      [
        "-e",
        `const net=require("net");const s=net.connect(${port},"0.0.0.0");` +
          `s.on("connect",()=>{console.log("reachable");s.destroy()});` +
          `s.on("error",()=>console.log("refused"));`,
      ],
      { encoding: "utf8" }
    );
    assert.match(connections.stdout.trim(), /refused|reachable/);
    const loopback = await fetch(`http://127.0.0.1:${port}/api/issues`);
    assert.equal(loopback.status, 200, "loopback must work");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a change to issues.json is pushed to the browser", async () => {
  const dir = tempProject(seed([issue("11111111-1111-1111-1111-111111111111")]));
  const { child, url } = await startServer(dir);
  try {
    const pushed = await waitForEvent(url, async () => {
      // Write through the real tracker: it replaces issues.json with a rename, which is exactly
      // the case a watcher bound to the file instead of the directory would miss.
      spawnSync(
        process.execPath,
        [
          ISSUE_MANAGER,
          "--insert",
          "--project-dir",
          dir,
          "--issue-data",
          JSON.stringify({ title: "New", description: "New issue", status: "backlog" }),
        ],
        { encoding: "utf8" }
      );
    });
    assert.equal(pushed, true, "the server must push an event when issues.json changes");

    const data = await (await fetch(`${url}api/issues`)).json();
    assert.equal(data.issues.length, 2, "and serve the new content afterwards");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the board writes nothing into the project", async () => {
  const dir = tempProject(seed([issue("11111111-1111-1111-1111-111111111111")]));
  const before = readdirSync(dir).sort();
  const { child, url } = await startServer(dir);
  try {
    await fetch(url);
    await fetch(`${url}api/issues`);
    assert.deepEqual(readdirSync(dir).sort(), before, "no file may appear in the project");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a project without issues.json shows an empty board", async () => {
  const dir = tempProject(null);
  const { child, url } = await startServer(dir);
  try {
    const data = await (await fetch(`${url}api/issues`)).json();
    assert.deepEqual(data.issues, []);
    assert.equal(existsSync(path.join(dir, "issues.json")), false, "and creates nothing");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreadable issues.json degrades instead of killing the board", async () => {
  const dir = tempProject("{ this is not json");
  const { child, url } = await startServer(dir);
  try {
    const response = await fetch(`${url}api/issues`);
    assert.equal(response.status, 200, "the board must stay up");
    const data = await response.json();
    assert.deepEqual(data.issues, []);
    assert.match(data.error, /not readable/);
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown paths 404 rather than leaking files", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    for (const suffix of ["nope", "../board-server.mjs", "issues.json"]) {
      const response = await fetch(`${url}${suffix}`);
      assert.equal(response.status, 404, `${suffix} must not be served`);
    }
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a busy port is reported, not silently swallowed", async () => {
  const dir = tempProject(seed());
  const first = await startServer(dir);
  try {
    await assert.rejects(
      () => startServer(dir, ["--port", String(first.port)]),
      /server failed: PORT_IN_USE/
    );
  } finally {
    stop(first.child);
    rmSync(dir, { recursive: true, force: true });
  }
});
