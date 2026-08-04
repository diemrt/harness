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

export const WIDTH = 80;
export const BAR_INNER = 77; // WIDTH minus the leading space and the two brackets
export const TITLE_MAX = 45;
export const WORKABLE_SHOWN = 3;

function emptyCounts() {
  return { backlog: 0, in_progress: 0, in_review: 0, blocked: 0, done: 0 };
}

function dependsOn(issue) {
  return Array.isArray(issue.depends_on) ? issue.depends_on : [];
}

// A dangling id — one that matches no issue in the tracker — leaves the issue unworkable. It
// happens after a hand edit of issues.json, and after an archive that took away something still
// referenced. Either way we do not know what is missing, so we do not clear the issue for work.
function danglingDeps(issue, byId) {
  return dependsOn(issue).filter((id) => !byId.has(id));
}

function isWorkable(issue, byId) {
  if (issue.status !== "backlog") return false;
  const deps = dependsOn(issue);
  if (danglingDeps(issue, byId).length > 0) return false;
  return deps.every((id) => byId.get(id).status === "done");
}

export function shortId(id) {
  return String(id ?? "").slice(0, 8);
}

// Depth-first search restricted to open issues. A cycle among closed ones is a fact of history:
// nothing is waiting on it any more, and reporting it every time would train the reader to skip
// the alert line.
function findCycle(issues, byId) {
  const openIds = new Set(issues.filter((i) => i.status !== "done").map((i) => i.id));
  const state = new Map(); // id -> "visiting" | "settled"
  const stack = [];
  let cycle = null;

  function visit(id) {
    if (cycle || state.get(id) === "settled") return;
    if (state.get(id) === "visiting") {
      cycle = stack.slice(stack.indexOf(id));
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of dependsOn(byId.get(id))) {
      if (openIds.has(dep)) visit(dep);
    }
    stack.pop();
    state.set(id, "settled");
  }

  for (const id of openIds) visit(id);
  return cycle;
}

function buildAlerts(issues, byId, counts, workableTotal) {
  const alerts = [];

  const cycle = findCycle(issues, byId);
  if (cycle) {
    alerts.push(`ciclo nei depends_on: ${cycle.map(shortId).join(" ")}`);
  }

  const broken = issues.filter((issue) => danglingDeps(issue, byId).length > 0);
  if (broken.length > 0) {
    const missing = [...new Set(broken.flatMap((issue) => danglingDeps(issue, byId)))]
      .map(shortId)
      .join(" ");
    const verb =
      broken.length === 1 ? "issue dipende da id inesistente" : "issue dipendono da id inesistenti";
    alerts.push(`${broken.length} ${verb}: ${missing}`);
  }

  if (counts.backlog > 0 && workableTotal === 0) {
    alerts.push(`lavorabili 0 di ${counts.backlog} — ogni issue in backlog attende qualcosa`);
  }

  return alerts;
}

export function buildSnapshot(issues) {
  const counts = emptyCounts();
  for (const issue of issues) {
    if (Object.hasOwn(counts, issue.status)) {
      counts[issue.status] += 1;
    }
  }

  const inFlight = issues
    .filter((issue) => IN_FLIGHT_ORDER.includes(issue.status))
    .sort(
      (a, b) =>
        IN_FLIGHT_ORDER.indexOf(a.status) - IN_FLIGHT_ORDER.indexOf(b.status) ||
        String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))
    );

  const byId = new Map(issues.map((issue) => [issue.id, issue]));

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

function inFlightRow(issue) {
  return (
    `  ${STATUS_ICON[issue.status]} ${shortId(issue.id).padEnd(8)}  ` +
    `${issue.status.padEnd(11)}  ${tierIcon(issue.tier).padEnd(3)}  ` +
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
