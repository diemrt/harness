#!/usr/bin/env node
// One screen of tracker status, printed into the session.
//
// Usage:
//   node status-cli.mjs [--project-dir <path>] [--help]
//
// STDOUT IS TEXT, NOT JSON. This is a deliberate break from issue-manager.mjs and
// board-server.mjs, which print one line of JSON because an agent parses it. This script talks to
// a human reading a code block in the session: it has no automated consumers and must not acquire
// any. Nothing is ever written to stderr.
//
// No colour, no ANSI, no isTTY: the surface this exists for is `/harness:status`, where stdout is
// a pipe to the agent and a colour branch would never run. Alignment and ASCII icons carry the
// distinctions instead, and they survive a markdown code block.

import { existsSync, readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildAlerts,
  countByStatus,
  indexById,
  isWorkable,
  shortId,
} from "./tracker-graph.mjs";

// Re-exported, not redefined: shortId moved to the graph module when the export needed it too, and
// the importers of this file should not have to care where it lives now.
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
  // The age is metadata about the line, not one of the things being counted: grey keeps it from
  // competing for attention with the work.
  age: "90",
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

// How long ago the tracker was last written, for the status line. This is the line's heartbeat:
// the command has no cache and rereads issues.json every run, so a line that RUNS is aligned by
// construction and the only possible mismatch is not running at all — which a frozen line and a
// fresh one showing the same counts cannot be told apart by.
//
// The seconds are in all three brackets on purpose. Drop them above the minute and the heartbeat
// stops for sixty seconds at a time, which is exactly the dead line this exists to rule out.
//
// A timestamp in the future is clock skew between whoever wrote and whoever reads, not news: it
// flattens to 0s rather than spending the row on a negative number.
export function formatAge(lastUpdated, now = Date.now()) {
  if (!lastUpdated) return null;
  const when = new Date(lastUpdated);
  if (Number.isNaN(when.getTime())) return null;

  const total = Math.max(0, Math.floor((now - when.getTime()) / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  if (total < 60) return `${seconds}s`;
  if (total < 3600) return `${minutes}m ${seconds}s`;
  return `${hours}h ${minutes}m ${seconds}s`;
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

// How far the execution tasks of an issue have got. A dash where there are none, exactly like an
// undeclared tier: "none" is a normal state here, not a hole to fill. A backlog issue has none by
// design — the steps are materialized by whoever takes it — which is why this column belongs to
// the in-flight table and to no other.
export function taskProgress(issue) {
  const tasks = Array.isArray(issue.tasks) ? issue.tasks : [];
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
// The age of the tracker closes the line, and is the one field here that changes on its own: see
// formatAge() for why it is a heartbeat and not decoration. Absent or unparseable last_updated
// prints nothing rather than a placeholder — the same rule the task brackets follow.
export function renderOneline(snapshot, { color = false, lastUpdated = null, now = Date.now() } = {}) {
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

  // Before the age, and deliberately: an empty tracker has no news, and an age alone would be a
  // heartbeat for counts nobody is showing.
  if (parts.length === 0) return "";
  const alert = snapshot.alerts.length > 0 ? ` ${paint("!", ONELINE_COLOR.alert, color)}` : "";
  const age = formatAge(lastUpdated, now);
  const heartbeat = age ? ` | ${paint(age, ONELINE_COLOR.age, color)}` : "";
  return `${parts.join(" | ")}${alert}${heartbeat}`;
}

const USAGE = [
  "Usage:",
  "  node status-cli.mjs [--project-dir <path>] [--oneline [--color]] [--help]",
  "",
  "Prints one screen of tracker status: counts, what is in flight, what can be taken now.",
  "Output is text, not JSON, and nothing is ever written to stderr.",
  "",
  "--project-dir  directory holding issues.json (default: the current directory).",
  "               A project without issues.json reads as an empty tracker, not an error.",
  "--oneline      one ASCII line of counts for a host status bar (tmux, starship, a shell",
  "               prompt, the Claude Code statusLine). Always exits 0 and stays silent on",
  "               any problem: an error repeated on every refresh is worse than no line.",
  "               Shows [done/total] tasks only when exactly one issue is in flight, and",
  "               closes with how long ago the tracker was written (12s, 3m 12s, 1h 2m 12s):",
  "               that age is the heartbeat that tells a live line from a frozen one.",
  "--color        add ANSI colour to --oneline. Off by default: the host may be a prompt",
  "               that renders the escape codes literally. No effect without --oneline.",
  "",
  "Exit codes: 0 on success and on an empty tracker; 1 on a missing project directory, an",
  "unreadable issues.json, or an unknown flag. --oneline always exits 0.",
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

// Every way this can go wrong, collected in one place and turned into an empty line. It does not
// share resolveProjectDir() on purpose: that one calls fail(), which exits 1, and this command must
// not — see the branch in main() for why.
function onelineFor(projectDirArg, color) {
  try {
    const dir = path.resolve(projectDirArg ?? process.cwd());
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return "";
    const trackerPath = path.join(dir, "issues.json");
    // A missing tracker is not an error: issue-manager.mjs reads it as an empty tracker, and so
    // does this. The line comes out empty because every count is zero, not because we gave up.
    if (!existsSync(trackerPath)) return "";
    const data = JSON.parse(readFileSync(trackerPath, "utf8"));
    const issues = Array.isArray(data.issues) ? data.issues : [];
    return renderOneline(buildSnapshot(issues), { color, lastUpdated: data.last_updated ?? null });
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
  const fallbackName = path.basename(projectDir);
  const trackerPath = path.join(projectDir, "issues.json");

  if (!existsSync(trackerPath)) {
    process.stdout.write(` ${fallbackName} · tracker vuoto\n`);
    return;
  }

  let data;
  try {
    data = JSON.parse(readFileSync(trackerPath, "utf8"));
  } catch {
    fail(`'${trackerPath}' non è un JSON valido: il tracker non è leggibile.`);
  }

  const issues = Array.isArray(data.issues) ? data.issues : [];
  const project = typeof data.project === "string" && data.project ? data.project : fallbackName;
  const rendered = renderSnapshot(buildSnapshot(issues), {
    project,
    lastUpdated: data.last_updated ?? null,
  });
  process.stdout.write(`${rendered}\n`);
}

// The two pure functions above are imported by the tests; main() must not run then.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
