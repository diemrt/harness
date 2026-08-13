#!/usr/bin/env node
// Instrumented wrapper around `status-cli.mjs --oneline`, for one question only:
//
//   does Claude Code actually invoke the status line command, and does it let it finish?
//
// It logs a line when it STARTS and a line when it ENDS, so a run killed in flight shows up as a
// START with no matching END. Whatever it prints on stdout is exactly what status-cli printed, so
// the log also records what the host was handed at that instant — which is the half of the
// evidence that can be compared against what the screen was showing.
//
// It must never break the status line: any failure degrades to an empty line, like the command it
// wraps.

import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const BASE =
  "C:/Users/diego_martignoni/AppData/Local/Temp/claude/C--Users-diego-martignoni-Documents-Workspace-Projects-personal-herness/f7632714-92d8-45b3-a406-e92ab5f71663/scratchpad/statusline-probe";
const LOG = `${BASE}/probe.log`;
const PROJECT = BASE;
const SCRIPT =
  "C:/Users/diego_martignoni/Documents/Workspace/Projects/personal/herness/scripts/status-cli.mjs";

const stamp = () => new Date().toISOString();
const note = (text) => {
  try {
    appendFileSync(LOG, `${text}\n`);
  } catch {
    // A probe that breaks the thing it observes is not a probe.
  }
};

const pid = process.pid;
const startedAt = Date.now();
note(`${stamp()} pid=${pid} START`);

let line = "";
try {
  const run = spawnSync(process.execPath, [SCRIPT, "--oneline", "--color", "--project-dir", PROJECT], {
    encoding: "utf8",
  });
  line = (run.stdout ?? "").replace(/\r?\n+$/, "");
} catch {
  line = "";
}

note(`${stamp()} pid=${pid} END   ${Date.now() - startedAt}ms  line=${JSON.stringify(line)}`);
process.stdout.write(`${line}\n`);
