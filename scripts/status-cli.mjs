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

  return { counts, inFlight, workable: [], workableTotal: 0, alerts: [] };
}
