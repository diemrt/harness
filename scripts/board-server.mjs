#!/usr/bin/env node
// Live issue board, served from the plugin.
//
// Replaces the issues.html that older harness versions copied into every project: the page is
// served from the plugin, the data is read from the project, and nothing is written to the
// repository. Open the URL once at clock-in and the board follows the work — the server watches
// issues.json and pushes to the browser, which never polls.
//
// Usage:
//   node board-server.mjs [--project-dir <path>] [--port <n>]
//
// --project-dir defaults to the process cwd: the board shows the project you are working in.
// --port 0 (the default) lets the OS pick a free port. The socket is bound to 127.0.0.1: the
// board is never reachable from outside the machine.
//
// On startup the server prints exactly one line of JSON — the same contract as the other plugin
// scripts — and then keeps running:
//   {"ok":true,"data":{"url":"...","port":1234,"pid":999,"projectDir":"..."}}
//   {"ok":false,"error":"<message>","code":"<CODE>"}
//
// Error codes: UNKNOWN_ARGUMENT, INVALID_ARGUMENT_VALUE, FILE_NOT_FOUND, PORT_IN_USE, WATCH_LOST,
// ERROR.
//
// That line is printed at startup and then, at most, once more: when the server dies. A board that
// dies quietly leaves the caller holding an URL it believes is live, which is how this process
// spent its first weeks — three deaths in one session, at 50, 25 and 16 minutes, each one silent.
// WATCH_LOST is the case that can be provoked and therefore tested: the project directory
// disappears, and fs.watch answers not with an error but with an endless storm of rename events
// for the vanished path. The rest is caught by a last-resort handler on uncaughtException.

import { createServer } from "node:http";
import { existsSync, readFileSync, realpathSync, statSync, watch } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = path.join(__dirname, "board.html");

// Changes arrive in bursts: issue-manager writes a temp file and renames it over issues.json, so
// a single update can raise several watch events. One push per burst is enough.
const DEBOUNCE_MS = 60;

function writeFail(message, code = "ERROR") {
  process.stdout.write(JSON.stringify({ ok: false, error: message, code }) + "\n");
  process.exit(1);
}

function resolveProjectDir(projectDir) {
  const dir = path.resolve(projectDir ?? process.cwd());
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    writeFail(`Project directory '${dir}' does not exist.`, "FILE_NOT_FOUND");
  }
  // Windows still hands out 8.3 short paths — `C:\Users\DIEGO_~1\...` — through %TEMP%, through a
  // shortcut, through an old tool. watch() on one of them does not fail: it aborts the whole
  // process from inside libuv (`!_wcsnicmp(filename, dir, dirlen)`, src\win\fs-event.c), so the
  // board would die on the first change with an URL already announced as live. Canonicalise once,
  // here, and everything derived from it agrees: the file read, the directory watched, and the
  // projectDir printed at startup, which is what the caller checks it is serving the right project.
  try {
    return realpathSync.native(dir);
  } catch {
    // A directory that just passed statSync should always resolve. If it somehow does not, a short
    // path is the smaller problem: keep serving instead of refusing to start.
    return dir;
  }
}

// A project with no issues.json is not an error: the board shows an empty tracker, exactly like
// the issue manager reads one. The file may appear later, and the watcher will notice.
function readIssues(issuesFilePath, projectDir) {
  if (!existsSync(issuesFilePath)) {
    return { projectDir, issues: [], lastUpdated: null, project: null };
  }
  try {
    const data = JSON.parse(readFileSync(issuesFilePath, "utf8"));
    return {
      projectDir,
      issues: Array.isArray(data.issues) ? data.issues : [],
      lastUpdated: data.last_updated ?? null,
      // Older trackers named the project explicitly; the minimal seed the plugin writes today
      // (`{last_updated, issues}`) has no such field, and the board falls back to the directory
      // basename in that case (see projectNameFrom in board.html).
      project: typeof data.project === "string" && data.project ? data.project : null,
    };
  } catch {
    // A read landing between the temp write and the rename can see a partial file. Report it
    // instead of crashing the server the user is watching.
    return { projectDir, issues: [], lastUpdated: null, project: null, error: "issues.json is not readable right now" };
  }
}

function main() {
  // strict: an unknown flag must fail here, not start a server. This script has no subcommands —
  // a mistyped or invented flag (--start, --stop) used to be swallowed and produced one more
  // listening process on one more port, orphaned and invisible until something else broke.
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      options: {
        "project-dir": { type: "string" },
        port: { type: "string", default: "0" },
      },
    }));
  } catch (error) {
    // parseArgs raises the same kind of error for two different mistakes, and the `code` is the
    // part callers branch on: labelling both UNKNOWN_ARGUMENT told whoever asked "you invented a
    // flag" even when the flag was one of ours, just left without its value. The message stays
    // readable either way; the diagnosis is what has to be right.
    if (error.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
      writeFail(
        `${error.message.replace(/\.?$/, ".")} Both --project-dir and --port take a value.`,
        "INVALID_ARGUMENT_VALUE"
      );
    }
    writeFail(
      `${error.message.replace(/\.?$/, ".")} The board server takes --project-dir and --port only; it is stopped by killing its pid.`,
      "UNKNOWN_ARGUMENT"
    );
  }

  const projectDir = resolveProjectDir(values["project-dir"]);
  const issuesFilePath = path.join(projectDir, "issues.json");
  const page = readFileSync(PAGE_PATH, "utf8");

  /** @type {Set<import("node:http").ServerResponse>} */
  const clients = new Set();

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(page);
      return;
    }

    if (url.pathname === "/api/issues") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(readIssues(issuesFilePath, projectDir)));
      return;
    }

    if (url.pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write("retry: 1000\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      // A browser does not always leave politely: a tab killed, a laptop suspended, a network
      // dropped leave a socket that errors on the next write instead of firing 'close' first.
      // Without this listener that error has nowhere to go, and an unhandled 'error' event takes
      // the whole process down — which is what "the URL was announced and is already dead" looks
      // like from the outside.
      res.on("error", () => clients.delete(res));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found\n");
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      writeFail(`Port ${values.port} is already in use.`, "PORT_IN_USE");
    }
    writeFail(error.message, "ERROR");
  });

  // Watch the directory, not the file: issue-manager replaces issues.json by renaming a temp file
  // over it, and a watcher bound to the file itself would keep pointing at the replaced one and
  // go silent after the first change.
  let timer = null;
  const watcher = watch(projectDir, (_event, filename) => {
    if (filename !== "issues.json") {
      // The watched directory disappearing does NOT raise an error: fs.watch keeps firing rename
      // events for the vanished path, forever, at full speed. Serving on from there would mean
      // answering with a tracker nobody is following any more — a stale reading that looks fresh,
      // which is the one thing this board must never do. So the check runs on the events that are
      // not about issues.json, which in normal life are rare and during that storm are all of them.
      if (!existsSync(projectDir)) {
        stopWatching();
        writeFail(
          `The project directory '${projectDir}' is gone: the board cannot follow it any more.`,
          "WATCH_LOST"
        );
      }
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const client of clients) {
        try {
          client.write("event: issues\ndata: {}\n\n");
        } catch {
          // The client vanished between the check and the write. Dropping it is the whole
          // remedy: what must not happen is that one dead browser tab ends the process every
          // other tab is watching.
          clients.delete(client);
        }
      }
    }, DEBOUNCE_MS);
  });

  function stopWatching() {
    clearTimeout(timer);
    try {
      watcher.close();
    } catch {
      // Closing a watcher that already broke is not a second failure worth reporting.
    }
  }

  // Watchers do emit errors of their own on some platforms and filesystems. Losing the watcher
  // means losing the only reason this process exists — the page would keep answering with a
  // tracker it no longer follows — so it is a death, and a death is announced.
  watcher.on("error", (error) => {
    stopWatching();
    writeFail(`The watcher on '${projectDir}' failed: ${error.message}`, "WATCH_LOST");
  });

  function shutdown() {
    clearTimeout(timer);
    watcher.close();
    for (const client of clients) {
      client.end();
    }
    server.close(() => process.exit(0));
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Last resort, and deliberately not something a test can stage: whatever kills this process
  // after startup, it must not go without saying so. The caller has an URL it believes is live —
  // the one thing worse than the board dying is the board dying quietly.
  process.on("uncaughtException", (error) => {
    writeFail(`Unexpected error after startup: ${error && error.message ? error.message : String(error)}`, "ERROR");
  });
  process.on("unhandledRejection", (reason) => {
    writeFail(`Unhandled rejection after startup: ${reason && reason.message ? reason.message : String(reason)}`, "ERROR");
  });

  server.listen(Number.parseInt(values.port, 10), "127.0.0.1", () => {
    const { port } = server.address();
    process.stdout.write(
      JSON.stringify({
        ok: true,
        data: { url: `http://127.0.0.1:${port}/`, port, pid: process.pid, projectDir },
      }) + "\n"
    );
  });
}

try {
  main();
} catch (err) {
  writeFail(`Unexpected error: ${err && err.message ? err.message : String(err)}`, "ERROR");
}
