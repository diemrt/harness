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
// Error codes: UNKNOWN_ARGUMENT, INVALID_ARGUMENT, FILE_NOT_FOUND, PORT_IN_USE, ERROR.

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = path.join(__dirname, "board.html");

// Static route table for the page's own assets: declared one by one, never built from the
// request URL, so "no arbitrary file is served" stays true after the split of board.html into
// three files. Anything not listed here — /board-graph.mjs included, not yet wired to the page —
// falls through to the catch-all 404, traversal attempts among them.
const ASSET_ROUTES = [
  { pathname: "/board.css", filePath: path.join(__dirname, "board.css"), contentType: "text/css" },
  { pathname: "/board.js", filePath: path.join(__dirname, "board.js"), contentType: "text/javascript" },
];

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
  return dir;
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
    // node:util distingue i due casi nel proprio error.code: un flag mai dichiarato o un
    // positional inatteso restano ERR_PARSE_ARGS_UNKNOWN_OPTION / ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL
    // e mappano su UNKNOWN_ARGUMENT ("hai inventato qualcosa"); un flag che lo script dichiara ma
    // usato male (--port senza valore, o reso ambiguo dal token successivo) è
    // ERR_PARSE_ARGS_INVALID_OPTION_VALUE e prende un code suo, INVALID_ARGUMENT: chi ramifica su
    // UNKNOWN_ARGUMENT per dire "hai inventato un flag" altrimenti sbaglierebbe diagnosi.
    const code = error.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" ? "INVALID_ARGUMENT" : "UNKNOWN_ARGUMENT";
    writeFail(
      `${error.message.replace(/\.?$/, ".")} The board server takes --project-dir and --port only; it is stopped by killing its pid.`,
      code
    );
  }

  const projectDir = resolveProjectDir(values["project-dir"]);
  const issuesFilePath = path.join(projectDir, "issues.json");
  const page = readFileSync(PAGE_PATH, "utf8");
  // Read once at startup, same as the page: these are plugin assets, not project data, so there
  // is nothing to watch and nothing to re-read per request.
  const assets = new Map(
    ASSET_ROUTES.map((route) => [route.pathname, { body: readFileSync(route.filePath, "utf8"), contentType: route.contentType }])
  );

  /** @type {Set<import("node:http").ServerResponse>} */
  const clients = new Set();

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(page);
      return;
    }

    const asset = assets.get(url.pathname);
    if (asset) {
      res.writeHead(200, { "content-type": `${asset.contentType}; charset=utf-8`, "cache-control": "no-store" });
      res.end(asset.body);
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
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const client of clients) {
        client.write("event: issues\ndata: {}\n\n");
      }
    }, DEBOUNCE_MS);
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
