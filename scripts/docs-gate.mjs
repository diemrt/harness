#!/usr/bin/env node
// Cumulative check on the documentation gate: which commits touched code without any issue naming
// them in `covers`.
//
// Usage:
//   node docs-gate.mjs [--project-dir <path>] [--since <rev>] [--help]
//
// STDOUT IS TEXT, NOT JSON — the same deliberate break status-cli.mjs makes. This talks to a
// person reading a code block in the session: it has no automated consumers and must not acquire
// any. Nothing is ever written to stderr.
//
// The check is CUMULATIVE, never pointwise, and that is the whole design. A gate that answers
// about HEAD, run by hand after fifteen commits, says the right thing about the wrong commit —
// which is exactly how the manual instruction it replaces failed. Whoever remembers it once at the
// end of the day gets all fifteen commits back, not the last one: forgetting costs a delay, not a
// loss.
//
// Autonomous like every other script in this plugin: it resolves the project, reads
// .harness/config.json and issues.json on its own, and imports nothing from its neighbours. The
// pure functions below are exported so the tests can prove the decision without a fake repository
// and without a process, the way status-cli.mjs exports buildSnapshot.

// Fixed 80 columns, no colour, no ANSI, no isTTY: the surface this exists for is
// `/harness:docs-gate`, where stdout is a pipe to the agent and a colour branch would never run.
export const WIDTH = 80;
export const SUBJECT_MAX = 45;

// The docsGate globs are matched against repository-relative paths with forward slashes, which is
// what `git log --name-only` prints on every platform. The supported subset is the one the shipped
// defaults use: `**/` for zero or more directories, `**` for anything at all, `*` for anything but
// a separator, `?` for one character, and literals. No brace expansion and no character classes —
// a glob syntax nobody can predict is worse than one that is small and written down here.
export function globToRegExp(glob) {
  let source = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*" && glob[i + 2] === "/") {
      // Zero or more, not one or more: `**/*.mjs` must also match a file sitting at the root.
      source += "(?:[^/]*/)*";
      i += 3;
    } else if (ch === "*" && glob[i + 1] === "*") {
      source += ".*";
      i += 2;
    } else if (ch === "*") {
      source += "[^/]*";
      i += 1;
    } else if (ch === "?") {
      source += "[^/]";
      i += 1;
    } else {
      // Escaped, so a literal dot in `issues.json` cannot also match `issuesXjson`.
      source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesAny(file, globs) {
  return globs.some((glob) => globToRegExp(glob).test(file));
}

// Exclude wins over include, which is the only reading that makes the shipped defaults work:
// `**/*.mjs` sweeps in every script and `test/**` has to be able to take the tests back out.
export function isCodeFile(file, include, exclude) {
  if (matchesAny(file, exclude)) {
    return false;
  }
  return matchesAny(file, include);
}

// Every reference every issue declares, WHATEVER its status. Coverage means an issue naming the
// commit exists, not that it is closed: the gate is a tracked reminder and not a veto, and
// filtering by status here would quietly turn it into one.
//
// A missing `covers` key reads as [] — a tracker still at schema_version 1 has none at all, and
// must simply come out as "no declared revisions" rather than as a crash.
export function declaredRefs(issues) {
  const refs = [];
  for (const issue of issues) {
    const declared = Array.isArray(issue?.covers) ? issue.covers : [];
    for (const entry of declared) {
      if (typeof entry !== "string") {
        continue;
      }
      const ref = entry.trim();
      if (ref !== "" && !refs.includes(ref)) {
        refs.push(ref);
      }
    }
  }
  return refs;
}

// The whole decision, as a function of data in memory.
//
// `commits` is the window as git hands it back, newest first: { sha, subject, files }.
// `covered` is the set of RESOLVED full shas the tracker declares — resolution needs git and so it
// happens in the shell below, which is exactly why it arrives here already done.
export function buildGateReport({ commits, covered, include, exclude }) {
  const coveredSet = covered instanceof Set ? covered : new Set(covered);
  const code = [];
  for (const commit of commits) {
    const files = (commit.files ?? []).filter((file) => isCodeFile(file, include, exclude));
    if (files.length === 0) {
      continue;
    }
    code.push({
      sha: commit.sha,
      subject: commit.subject,
      files,
      covered: coveredSet.has(commit.sha),
    });
  }
  return {
    scanned: commits.length,
    code,
    uncovered: code.filter((entry) => !entry.covered),
  };
}

export function shortSha(sha) {
  return String(sha ?? "").slice(0, 8);
}

// A subject is one line or it is not a table. Whitespace is collapsed first, so a newline smuggled
// into a commit message cannot add a row to the output.
function truncate(text, max) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3)}...`;
}

const RULE = ` ${"─".repeat(WIDTH - 1)}`;

// An alert is data, and data must not run off the row. An unresolved reference is wrapped, never
// truncated: it is the one string the reader has to copy back out.
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

function uncoveredRow(entry) {
  return (
    `  ${shortSha(entry.sha).padEnd(8)}  ` +
    `${truncate(entry.subject, SUBJECT_MAX).padEnd(SUBJECT_MAX)}  ${entry.files.length} file`
  );
}

export function renderGateReport(report, { project, window, unresolved = [] }) {
  const alerts = [];
  if (unresolved.length > 0) {
    const verb =
      unresolved.length === 1
        ? "riferimento dichiarato non risolve"
        : "riferimenti dichiarati non risolvono";
    alerts.push(`${unresolved.length} ${verb}: ${unresolved.join(" ")}`);
  }

  // Italian agreement, on the line a person reads first: a plural verb on a single item reads as
  // a bug in the count itself.
  const touching =
    report.code.length === 1 ? "1 tocca codice" : `${report.code.length} toccano codice`;
  const missing =
    report.uncovered.length === 1
      ? "1 non coperto"
      : `${report.uncovered.length} non coperti`;

  return [
    // Two lines, not one. Folded together they run to 93 columns on an ordinary project name —
    // the window label alone is 55 of them — and the whole point of a fixed width is that it
    // holds without anyone checking.
    ` ${project} · gate documentale`,
    ` ${window}`,
    ...alertLines(alerts),
    "═".repeat(WIDTH),
    ` ${report.scanned} commit nella finestra · ${touching} · ${missing}`,
    "",
    " NON COPERTI",
    RULE,
    ...(report.uncovered.length > 0
      ? report.uncovered.map(uncoveredRow)
      : ["  nessun commit di codice scoperto"]),
    RULE,
    " coperto = una issue lo dichiara in covers, in qualunque stato",
  ].join("\n");
}
