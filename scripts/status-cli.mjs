#!/usr/bin/env node
// One screen of tracker status, printed into the session.
//
// Usage:
//   node status-cli.mjs [--project-dir <path>] [--help]
//
// STDOUT IS TEXT, NOT JSON. This is a deliberate break from issue-manager.mjs, which prints one
// line of JSON because an agent parses it. This script talks to
// a human reading a code block in the session: it has no automated consumers and must not acquire
// any. Nothing is ever written to stderr.
//
// No colour, no ANSI, no isTTY: the surface this exists for is `/harness:status`, where stdout is
// a pipe to the agent and a colour branch would never run. Alignment and ASCII icons carry the
// distinctions instead, and they survive a markdown code block.

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildAlerts,
  countByStatus,
  indexById,
  isWorkable,
  shortId,
} from "./tracker-graph.mjs";

// Re-exported, not redefined: shortId lives in the graph module, and whoever imports it from here
// should not have to care that it moved.
export { shortId };

export const STATUS_ICON = {
  backlog: "o",
  in_progress: "+",
  in_review: "~",
  blocked: "!",
  done: "#",
};

export const TIER_ICON = { economy: "$", standard: "$$", reasoning: "$$$" };

// Reading order of the in-flight section: what is moving, then what is waiting on a verifier,
// then what is stuck.
export const IN_FLIGHT_ORDER = ["in_progress", "in_review", "blocked"];

// Reading order of the bar and its legend: closed work on the left, untouched backlog on the
// right, so the bar fills left to right as the project advances.
export const BAR_ORDER = ["done", "in_progress", "in_review", "blocked", "backlog"];

// Reading order of the one-line summary, and deliberately NOT BAR_ORDER. The bar answers "how far
// has this project got", so it opens with the closed work; this line answers "where are we right
// now", and closed work is the least urgent thing on it.
export const ONELINE_ORDER = ["in_progress", "in_review", "blocked", "backlog", "done"];

export const ONELINE_LABEL = {
  in_progress: "in corso",
  in_review: "in verifica",
  blocked: "bloccate",
  backlog: "backlog",
  done: "chiuse",
};

// SGR codes, applied only under --color. Cyan for what is moving, yellow for what waits on someone
// else's judgement, red for what is stuck, grey for what nothing has touched yet, green for closed.
export const ONELINE_COLOR = {
  in_progress: "36",
  in_review: "33",
  blocked: "31",
  backlog: "90",
  done: "32",
  alert: "31",
  // Age and clock are metadata about the reading, not things being counted: grey keeps them from
  // competing for attention with the work.
  tail: "90",
};

export const WIDTH = 80;
export const BAR_INNER = 77; // WIDTH minus the leading space and the two brackets
// Narrower than it was: the count column took seven columns, and a title that runs past the edge
// breaks the table for every row, not just its own.
export const TITLE_MAX = 38;
// Five columns fit "12/34". A three-digit count makes the row longer instead of being truncated:
// a cut number lies, a long row does not.
export const TASKS_COL = 5;
export const WORKABLE_SHOWN = 3;

export function buildSnapshot(issues) {
  const counts = countByStatus(issues);

  const inFlight = issues
    .filter((issue) => IN_FLIGHT_ORDER.includes(issue.status))
    .sort(
      (a, b) =>
        IN_FLIGHT_ORDER.indexOf(a.status) - IN_FLIGHT_ORDER.indexOf(b.status) ||
        String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))
    );

  const byId = indexById(issues);

  const workableAll = issues
    .filter((issue) => isWorkable(issue, byId))
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));

  return {
    counts,
    inFlight,
    workable: workableAll.slice(0, WORKABLE_SHOWN),
    workableTotal: workableAll.length,
    alerts: buildAlerts(issues, byId, counts, workableAll.length),
  };
}

// Local time, minute precision: this is read by a person who wants to know whether the tracker
// moved since they last looked, not by anything that parses it.
function formatWhen(lastUpdated) {
  if (!lastUpdated) return null;
  const when = new Date(lastUpdated);
  if (Number.isNaN(when.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ` +
    `${pad(when.getHours())}:${pad(when.getMinutes())}`
  );
}

// The instant of the render, in local time, and the whole tail of the status line.
//
// It is the line's heartbeat: the command has no cache — every run rereads the tracker and exits —
// so a line that RUNS is aligned by construction, and the only possible mismatch is not running at
// all, which a frozen line and a fresh one showing the same counts cannot be told apart by.
//
// The line used to carry the age of the tracker beside it — how long ago the tracker was written.
// That answered a question nobody asks of a status bar, and it took a reading to answer: an age has
// to be watched moving. The clock is checked against a clock the reader already has, in one glance,
// and it is the only one of the two that the reader wanted.
//
// It never returns null: "now" is always knowable, so the tail has no branch.
export function formatClock(now = Date.now()) {
  const when = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
}

// Segments are proportional, but a status holding at least one issue always gets a column: a
// single blocked issue among two hundred is exactly the thing worth seeing. The rounding error
// that leaves behind is absorbed by the widest segment, which is always big enough to take it.
function barSegments(counts) {
  const present = BAR_ORDER.filter((status) => counts[status] > 0);
  if (present.length === 0) return [];
  const total = present.reduce((sum, status) => sum + counts[status], 0);
  const segments = present.map((status) => ({
    status,
    width: Math.max(1, Math.floor((counts[status] / total) * BAR_INNER)),
  }));
  const drift = BAR_INNER - segments.reduce((sum, segment) => sum + segment.width, 0);
  const widest = segments.reduce((a, b) => (b.width > a.width ? b : a));
  widest.width += drift;
  return segments;
}

function renderBar(counts) {
  const inner = barSegments(counts)
    .map((segment) => STATUS_ICON[segment.status].repeat(segment.width))
    .join("");
  return ` [${inner}]`;
}

function renderLegend(counts) {
  const parts = BAR_ORDER.filter((status) => counts[status] > 0).map(
    (status) => `${STATUS_ICON[status]} ${status} ${counts[status]}`
  );
  return `  ${parts.join("  ")}`;
}

const RULE = ` ${"─".repeat(WIDTH - 1)}`;

const TIER_LEGEND = " tier  $ economy   $$ standard   $$$ reasoning   - non dichiarato";

// A title is one line or it is not a table. Whitespace is collapsed first so a newline inside a
// title cannot smuggle a second row into the output.
function truncate(text, max) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3)}...`;
}

function tierIcon(tier) {
  return TIER_ICON[tier] ?? "-";
}

// The checklist that can still move, which is not the same array at every status.
//
// Under `in_progress` it is the worker's `tasks`. Under `in_review` the worker has finished —
// finishing is what put the issue there — so its execution tasks are ticked by construction, and
// the only checklist still advancing is the verifier's `validation.tasks`. Reading the execution
// tasks during review is why the column showed 6/6 the instant an issue entered verification and
// never moved again: not a wrong count, a count of the wrong thing.
//
// It stayed invisible for as long as `validation.tasks` were never ticked at all (bfb0a23f) —
// switching the source then would have traded a frozen N/N for a frozen 0/N, and nothing would have
// looked any better.
//
// `blocked` keeps the execution tasks: a failed issue goes back to the worker, and it is the
// worker's progress that matters again, even though the fail left judgement tasks partly ticked.
function progressTasks(issue) {
  if (issue.status === "in_review") {
    return Array.isArray(issue.validation?.tasks) ? issue.validation.tasks : [];
  }
  return Array.isArray(issue.tasks) ? issue.tasks : [];
}

// How far the issue has got, measured on whoever is holding it now. A dash where there are none,
// exactly like an undeclared tier: "none" is a normal state here, not a hole to fill. A backlog
// issue has none by design — the steps are materialized by whoever takes it — which is why this
// column belongs to the in-flight table and to no other. An issue under light verification carries
// no judgement checklist either, and shows that same dash for as long as it is in review.
export function taskProgress(issue) {
  const tasks = progressTasks(issue);
  if (tasks.length === 0) {
    return "-";
  }
  return `${tasks.filter((task) => task && task.checked === true).length}/${tasks.length}`;
}

function inFlightRow(issue) {
  return (
    `  ${STATUS_ICON[issue.status]} ${shortId(issue.id).padEnd(8)}  ` +
    `${issue.status.padEnd(11)}  ${tierIcon(issue.tier).padEnd(3)}  ` +
    `${taskProgress(issue).padEnd(TASKS_COL)}  ` +
    truncate(issue.title, TITLE_MAX)
  );
}

function workableRow(issue) {
  return (
    `  ${STATUS_ICON.backlog} ${shortId(issue.id).padEnd(8)}  ` +
    `${tierIcon(issue.tier).padEnd(3)}  ${truncate(issue.title, TITLE_MAX)}`
  );
}

// An alert is data, and data must not run off the row. Wrapping keeps the ids readable where
// truncation would hide exactly the one you need.
function alertLines(alerts) {
  const rows = [];
  for (const alert of alerts) {
    let current = " !";
    for (const word of `${alert}`.split(" ")) {
      if (current.length + 1 + word.length > WIDTH) {
        rows.push(current);
        current = `   ${word}`;
      } else {
        current += ` ${word}`;
      }
    }
    rows.push(current);
  }
  return rows;
}

export function renderSnapshot(snapshot, { project, lastUpdated }) {
  const total = Object.values(snapshot.counts).reduce((sum, n) => sum + n, 0);
  if (total === 0) {
    // Not an error and not a failure to read: a project that has not opened an issue yet.
    return ` ${project} · tracker vuoto`;
  }

  const when = formatWhen(lastUpdated);
  return [
    ` ${project} · ${total} issue${when ? ` · aggiornato ${when}` : ""}`,
    ...alertLines(snapshot.alerts),
    "═".repeat(WIDTH),
    renderBar(snapshot.counts),
    renderLegend(snapshot.counts),
    "",
    " IN CORSO",
    RULE,
    ...(snapshot.inFlight.length > 0
      ? snapshot.inFlight.map(inFlightRow)
      : ["  nessuna issue aperta"]),
    "",
    ` LAVORABILI · ${snapshot.workable.length} di ${snapshot.workableTotal}`,
    RULE,
    ...(snapshot.workable.length > 0 ? snapshot.workable.map(workableRow) : ["  niente in backlog"]),
    RULE,
    TIER_LEGEND,
  ].join("\n");
}

function paint(text, code, color) {
  return color ? `\x1b[${code}m${text}\x1b[0m` : text;
}

// The task count appears only when EXACTLY ONE issue is in flight across in_progress and in_review.
// With two, "[2/9]" would be the progress of which one? A number that needs a question before it
// can be read is worse than no number at all.
function soleInFlight(snapshot) {
  if (snapshot.counts.in_progress + snapshot.counts.in_review !== 1) return null;
  if (!Array.isArray(snapshot.inFlight)) return null;
  return (
    snapshot.inFlight.find(
      (issue) => issue.status === "in_progress" || issue.status === "in_review"
    ) ?? null
  );
}

// One line for a host status bar: tmux, starship, a shell prompt, the Claude Code statusLine.
// ASCII by default and no ANSI — the full-screen summary can afford box drawing because it lands in
// a markdown code block, this lands in a prompt where the encoding is not guaranteed. Colour is
// opt-in through `color`, never assumed.
//
// An empty tracker prints nothing at all: a status bar saying "zero" spends the row it was given
// on the absence of news.
//
// The instant of the render closes the line, and is the one field here that changes on its own:
// see formatClock() for why it is a heartbeat and not decoration.
export function renderOneline(snapshot, { color = false, now = Date.now() } = {}) {
  const sole = soleInFlight(snapshot);
  const soleProgress = sole ? taskProgress(sole) : "-";

  const parts = ONELINE_ORDER.filter((status) => snapshot.counts[status] > 0).map((status) => {
    let label = `${snapshot.counts[status]} ${ONELINE_LABEL[status]}`;
    // Square brackets, not a glyph: in this repository they already mean checklist — `- [x]` in the
    // export, `[x]` in the task lists — so the number reads as tasks without a legend. An issue
    // with no tasks yet shows nothing rather than "[-]": a dash here is noise, not information.
    if (sole && sole.status === status && soleProgress !== "-") {
      label += ` [${soleProgress}]`;
    }
    return paint(label, ONELINE_COLOR[status], color);
  });

  // Before the tail, and deliberately: an empty tracker has no news, and "nothing, as of 16:34:50"
  // still spends on the absence of news the row it was given.
  if (parts.length === 0) return "";
  const alert = snapshot.alerts.length > 0 ? ` ${paint("!", ONELINE_COLOR.alert, color)}` : "";

  // `T @ 16:34:50` — the instant of the reading, and nothing about the tracker: no branch, because
  // "now" is the one thing that is always knowable.
  const tail = `T @ ${formatClock(now)}`;
  return `${parts.join(" | ")}${alert} | ${paint(tail, ONELINE_COLOR.tail, color)}`;
}

const USAGE = [
  "Usage:",
  "  node status-cli.mjs [--project-dir <path>] [--oneline [--color]] [--help]",
  "",
  "Prints one screen of tracker status: counts, what is in flight, what can be taken now.",
  "Output is text, not JSON, and nothing is ever written to stderr.",
  "",
  "--project-dir  root of the project whose tracker to read (default: the current directory).",
  "               The tracker is read through `issue-manager --dump`, never off disk: a project",
  "               with no tracker at all reads as an empty one, not an error, and a project still",
  "               on the legacy issues.json says so and names the command that migrates it.",
  "--oneline      one ASCII line of counts for a host status bar (tmux, starship, a shell",
  "               prompt, the Claude Code statusLine). Always exits 0 and stays silent on",
  "               any problem: an error repeated on every refresh is worse than no line.",
  "               Shows [done/total] tasks only when exactly one issue is in flight, and closes",
  "               with `T @ 16:34:50`: the local time of this render, and nothing else. It tells",
  "               a live line from a frozen one at a glance — the host can stop invoking this",
  "               command, and then nothing on the row moves.",
  "--color        add ANSI colour to --oneline. Off by default: the host may be a prompt",
  "               that renders the escape codes literally. No effect without --oneline.",
  "",
  "Exit codes: 0 on success and on an empty tracker; 1 on a missing project directory, a tracker",
  "issue-manager cannot read, or an unknown flag. --oneline always exits 0.",
  "",
].join("\n");

function fail(message) {
  process.stdout.write(`${message}\n`);
  process.exit(1);
}

function resolveProjectDir(projectDir) {
  const dir = path.resolve(projectDir ?? process.cwd());
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`La directory di progetto '${dir}' non esiste.`);
  }
  return dir;
}

const ISSUE_MANAGER = path.join(path.dirname(fileURLToPath(import.meta.url)), "issue-manager.mjs");

// The tracker is read through `issue-manager --dump`, never off disk. Storage is one Markdown file
// per issue now, and a second reader of that layout would be a second place to fix every time it
// moves — a cost a single JSON file never had, because a JSON file is its own reader. The price is
// one child process per run, on a command that already is one.
//
// Never throws: it returns the failure instead, because its two callers want opposite things done
// with it. The screen prints it and exits 1; the status line swallows it and prints nothing.
function readDump(projectDir) {
  const result = spawnSync(process.execPath, [ISSUE_MANAGER, "--dump", "--project-dir", projectDir], {
    encoding: "utf8",
    // A tracker has no size a status screen can outgrow. The 1 MiB default does.
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    return { ok: false, error: "issue-manager --dump non ha risposto con un envelope JSON." };
  }
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, issues: Array.isArray(parsed.data.issues) ? parsed.data.issues : [] };
}

// The tracker has no `last_updated` of its own any more: with one file per issue there is no root
// object to hold one. The newest `updated_at` in the tracker is the same fact, read off the issues
// instead of maintained beside them — and it cannot go stale against them, which the root key could.
export function lastUpdatedOf(issues) {
  let latest = null;
  for (const issue of issues) {
    const stamp = issue.updated_at;
    // Lexical comparison, which is exact on the format harness writes and only that one: ISO-8601
    // in UTC, always the same width. Nothing in the tracker ever writes an offset.
    if (typeof stamp === "string" && (latest === null || stamp > latest)) {
      latest = stamp;
    }
  }
  return latest;
}

// Every way this can go wrong, collected in one place and turned into an empty line. It does not
// share resolveProjectDir() on purpose: that one calls fail(), which exits 1, and this command must
// not — see the branch in main() for why.
function onelineFor(projectDirArg, color) {
  try {
    const dir = path.resolve(projectDirArg ?? process.cwd());
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return "";
    // A tracker that cannot be read is silence here, exactly like a missing one: this line is the
    // one surface of harness that must never argue with its host.
    const dump = readDump(dir);
    if (!dump.ok) return "";
    return renderOneline(buildSnapshot(dump.issues), { color });
  } catch {
    return "";
  }
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      options: {
        "project-dir": { type: "string" },
        oneline: { type: "boolean", default: false },
        color: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    }));
  } catch (error) {
    // strict on purpose: an invented flag must stop here. A summary that looks right but answers
    // a different question is worse than no summary.
    fail(
      `${error.message.replace(/\.?$/, ".")} status-cli.mjs accetta solo --project-dir e --help.`
    );
  }

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  // Inverted output contract, on purpose, and it must stay before resolveProjectDir() — that one
  // calls fail(), which exits 1. This command runs on every refresh of a host status bar, and an
  // error message repeated there is worse than silence: it occupies the row that existed to show
  // the work, and cannot be dismissed. So it never fails, never writes to stderr, and degrades to
  // an empty line. Do not "fix" this back to the contract of the rest of the CLI: the reason is
  // written in references/status.md, not only here.
  if (values.oneline) {
    process.stdout.write(`${onelineFor(values["project-dir"], values.color)}\n`);
    return;
  }

  const projectDir = resolveProjectDir(values["project-dir"]);

  const dump = readDump(projectDir);
  if (!dump.ok) {
    // The reason comes from issue-manager and is passed on verbatim: a tracker still on the legacy
    // JSON says so and names the command that fixes it, and repeating that here in other words
    // would only make the two disagree.
    fail(`Il tracker di '${projectDir}' non è leggibile: ${dump.error}`);
  }

  // The project name is the directory, and only the directory. It used to come from a `project`
  // key in issues.json when that key was there — decorative metadata of the root object, which
  // Markdown storage has no room for and no reason to reinvent.
  const rendered = renderSnapshot(buildSnapshot(dump.issues), {
    project: path.basename(projectDir),
    lastUpdated: lastUpdatedOf(dump.issues),
  });
  process.stdout.write(`${rendered}\n`);
}

// The two pure functions above are imported by the tests; main() must not run then.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
