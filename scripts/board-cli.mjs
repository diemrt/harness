#!/usr/bin/env node
// The board, as a command that prints and ends.
//
// This is the only file of the board with side effects: it reads the arguments, reads the tracker,
// decides whether colour is allowed and writes to stdout. Everything about how the board *looks*
// lives in board-render.mjs, which is pure and therefore testable without a browser, a server or a
// port; everything about the shape of the dependency graph lives in board-graph.mjs.
//
// Usage:
//   node board-cli.mjs [--project-dir <path>] [--view chains|cards] [--status <s>]
//                      [--tier <t>] [--search <text>] [--all] [--width <n>] [--no-color]
//
// --project-dir defaults to the process cwd: the board shows the project you are working in.
// issues.json is never resolved next to this script — one installed copy serves every project,
// exactly as issue-manager.mjs already declares. A project without issues.json is an empty
// tracker, not an error.
//
// On success it prints text, not JSON: this is a view, not an API. On failure it prints one line
// of JSON on stdout and exits 1 — the same contract as the other plugin scripts:
//   {"ok":false,"error":"<message>","code":"<CODE>"}
//
// Error codes: FILE_NOT_FOUND (--project-dir does not exist), INVALID_ARGUMENT (a flag this script
// declares, used wrong), UNKNOWN_ARGUMENT (a flag that does not exist), ERROR (the tracker is
// there but unreadable). The same set board-server.mjs uses and commands/board.md teaches to read.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildGraph } from "./board-graph.mjs";
import { renderChains, renderCards } from "./board-render.mjs";

const VALUE_FLAGS = new Set(["--project-dir", "--view", "--status", "--tier", "--search", "--width"]);
const BOOL_FLAGS = new Set(["--all", "--no-color"]);
const VIEWS = ["chains", "cards"];

// Below this the tree has no room left for a title, and every line runs long anyway: a width that
// small is a typo, not a request.
const MIN_WIDTH = 20;
// What a pipe gets. `process.stdout.columns` is undefined without a TTY, and 100 is the width the
// renderer already defaults to.
const DEFAULT_WIDTH = 100;

const USAGE_TAIL =
  "The board takes --project-dir, --view, --status, --tier, --search, --all, --width and --no-color.";

function fail(error, code) {
  process.stdout.write(`${JSON.stringify({ ok: false, error, code })}\n`);
  process.exit(1);
}

function invalid(message) {
  return { ok: false, error: message, code: "INVALID_ARGUMENT" };
}

/**
 * Reads the command line into the options the rest of the file works with. Returns instead of
 * exiting, so the whole argument contract is testable without spawning a process.
 *
 * Hand-rolled rather than node:util's parseArgs for one behaviour that matters here: `--search
 * --all` must be refused, not read as a search for the text "--all". node:util accepts the second
 * flag as the value of the first, and a filter that silently matches nothing is worse than an
 * error.
 *
 * @param {string[]} argv the arguments, already stripped of node and the script path
 * @returns {{ok: true, value: object} | {ok: false, error: string, code: string}}
 */
export function parseArgs(argv) {
  const value = {
    projectDir: process.cwd(),
    view: "chains",
    status: [],
    tier: [],
    search: null,
    width: null,
    all: false,
    noColor: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index]);
    // `--flag=value` arrives as a single token. Splitting it here means the loop below only ever
    // deals with the two-token form.
    const equals = token.indexOf("=");
    const flag = equals === -1 ? token : token.slice(0, equals);
    const inline = equals === -1 ? null : token.slice(equals + 1);

    if (BOOL_FLAGS.has(flag)) {
      if (inline !== null) {
        return invalid(`${flag} takes no value.`);
      }
      if (flag === "--all") {
        value.all = true;
      }
      if (flag === "--no-color") {
        value.noColor = true;
      }
      continue;
    }

    if (!VALUE_FLAGS.has(flag)) {
      // Includes the positionals: this script has no subcommands, so `board-cli start` is an
      // invention and not a mode.
      return { ok: false, error: `Unknown argument: ${token}. ${USAGE_TAIL}`, code: "UNKNOWN_ARGUMENT" };
    }

    let next;
    if (inline !== null) {
      if (inline === "") {
        return invalid(`${flag} requires a value.`);
      }
      // The `=` form is also the way out for a value that really does start with two dashes,
      // which the two-token form below refuses on purpose.
      next = inline;
    } else {
      next = argv[index + 1];
      if (next === undefined || String(next).startsWith("--")) {
        return invalid(`${flag} requires a value.`);
      }
      next = String(next);
      index += 1;
    }

    switch (flag) {
      case "--project-dir":
        value.projectDir = path.resolve(next);
        break;
      case "--view":
        // This script validates what it owns. --status and --tier are the tracker's vocabulary,
        // not this file's: matching them literally keeps the filter working the day the tracker
        // grows a status, instead of rejecting it from a list copied here and left behind.
        if (!VIEWS.includes(next)) {
          return invalid(`--view accepts ${VIEWS.join(" or ")}.`);
        }
        value.view = next;
        break;
      case "--status":
        value.status.push(next);
        break;
      case "--tier":
        value.tier.push(next);
        break;
      case "--search":
        value.search = next.toLowerCase();
        break;
      case "--width": {
        // Whole token or nothing: Number.parseInt("80px") is 80, and a width silently taken from
        // half a typo is the kind of bug nobody reports because the board still draws.
        if (!/^-?\d+$/.test(next)) {
          return invalid("--width must be an integer.");
        }
        const parsed = Number.parseInt(next, 10);
        if (parsed < MIN_WIDTH) {
          return invalid(`--width must be at least ${MIN_WIDTH}.`);
        }
        value.width = parsed;
        break;
      }
    }
  }

  return { ok: true, value };
}

/**
 * The issues of a project, read from the project and never from next to this script.
 *
 * A missing issues.json is an empty tracker, the reading issue-manager.mjs already gives it. A
 * file that parses but is not the expected object — a bare array, a null, an object without
 * `issues` — also reads as empty, because that is what issue-manager.mjs and board-server.mjs
 * both do with it, and a third dialect here would only mean the same file shows three things.
 * Invalid JSON is the one case that throws: the caller turns it into the error line, since
 * pretending a corrupt tracker is an empty one hides the very thing the reader needs to know.
 *
 * @param {string} projectDir
 * @returns {object[]}
 */
export function readIssues(projectDir) {
  const file = path.join(projectDir, "issues.json");
  if (!existsSync(file)) {
    return [];
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  return data && Array.isArray(data.issues) ? data.issues : [];
}

/**
 * The issues that survive the filters: the chips and the search box of the old page, as flags.
 *
 * @param {object[]} issues
 * @param {{status: string[], tier: string[], search: ?string, all: boolean}} filters
 * @returns {object[]}
 */
export function selectIssues(issues, { status, tier, search, all }) {
  const list = Array.isArray(issues) ? issues : [];
  return list.filter((issue) => {
    if (!issue || typeof issue !== "object") {
      return false;
    }
    if (!all && issue.status === "done") {
      return false;
    }
    if (status.length > 0 && !status.includes(issue.status)) {
      return false;
    }
    if (tier.length > 0 && !tier.includes(issue.tier || "standard")) {
      return false;
    }
    if (search) {
      // Only the strings: joining an absent description would search the word "undefined", and
      // some search would match it.
      const haystack = [issue.id, issue.title, issue.description]
        .filter((field) => typeof field === "string")
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Whether this run may emit ANSI escapes. Taken apart from the printing so the rule is checkable
 * without a terminal, and stated in one place instead of being re-derived per line.
 *
 * Colour is on only with a TTY — a pipe or a file gets none of it — and off when it is refused,
 * by `--no-color` or by the NO_COLOR convention, which speaks of a variable that is *set to
 * something*: an empty NO_COLOR is not a refusal.
 *
 * @param {{noColor: boolean}} options
 * @param {Record<string, string|undefined>} env
 * @param {boolean|undefined} isTTY
 * @returns {boolean}
 */
export function decideColors({ noColor }, env, isTTY) {
  if (noColor === true) {
    return false;
  }
  const refused = env ? env.NO_COLOR : undefined;
  if (typeof refused === "string" && refused !== "") {
    return false;
  }
  return isTTY === true;
}

/**
 * One frame of the board, as a string. Reads the tracker and the terminal; writes nothing.
 *
 * @param {object} options the value returned by `parseArgs`
 * @returns {string}
 */
export function draw(options) {
  const issues = readIssues(options.projectDir);
  const colors = decideColors(options, process.env, process.stdout.isTTY);
  const width = options.width ?? process.stdout.columns ?? DEFAULT_WIDTH;
  const shared = { width, colors };

  if (options.view === "cards") {
    return renderCards(selectIssues(issues, options), shared);
  }

  // The tree is built from the whole tracker, filters and all: a chain is a fact of the graph, and
  // hiding half of it would either cut edges or turn the issues left out into ghosts the reader
  // cannot tell from a closed dependency. The filters narrow the card view, which is the one meant
  // for looking at issues one by one. `done` needs no filtering here either — buildGraph already
  // keeps closed issues out of the nodes and shows them as ghosts where something still waits for
  // them.
  const isDone = (issue) => issue && issue.status === "done";
  return renderChains({
    graph: buildGraph(issues),
    project: path.basename(options.projectDir),
    branch: "",
    counts: {
      open: issues.filter((issue) => !isDone(issue)).length,
      done: issues.filter((issue) => isDone(issue)).length,
    },
    ...shared,
  });
}

export function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    fail(parsed.error, parsed.code);
  }
  const options = parsed.value;

  if (!existsSync(options.projectDir)) {
    fail(`Project directory '${options.projectDir}' does not exist.`, "FILE_NOT_FOUND");
  }
  if (!statSync(options.projectDir).isDirectory()) {
    fail(`'${options.projectDir}' is not a directory.`, "FILE_NOT_FOUND");
  }

  let frame;
  try {
    frame = draw(options);
  } catch (error) {
    fail(
      `issues.json in '${options.projectDir}' is not readable: ${error && error.message ? error.message : String(error)}`,
      "ERROR"
    );
  }
  process.stdout.write(`${frame}\n`);
}

// Whether this file was run or imported. The obvious spelling — comparing `import.meta.url` with
// `file://${process.argv[1]}` — is false on Windows every single time: argv[1] is
// `C:\dir\board-cli.mjs` and the URL is `file:///C:/dir/board-cli.mjs`, so main() never runs and
// the command exits 0 having printed nothing. fileURLToPath is the translation between the two.
// realpath on top of it because the same file reaches here under more than one name: an 8.3 short
// path, a symlinked plugin directory, a drive letter in the other case.
function isEntrypoint() {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry === "") {
    return false;
  }
  const self = fileURLToPath(import.meta.url);
  if (path.resolve(entry) === self) {
    return true;
  }
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main();
}
