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
// Autonomous like every other script in this plugin: it resolves the project and reads
// .harness/config.json on its own, and imports nothing from its neighbours. The tracker is the one
// exception, and it is a deliberate one: it comes from `issue-manager --dump`, run as a child
// process, because storage is one Markdown file per issue and a second reader of that layout would
// be a second place to fix every time it moves. Running it is not importing it — no module of the
// storage crosses into this script.
// The pure functions below are exported so the tests can prove the decision without a fake
// repository and without a process, the way status-cli.mjs exports buildSnapshot.

import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// A copy of harness-config.mjs's DEFAULT_DOCS_GATE, not an import: this script is autonomous by
// design, and one script reaching into another's constant is the coupling that autonomy exists to
// avoid. It only ever applies to the fields a hand-written config.json omits — `--init` always
// writes all three, so on a project configured through the plugin this is dead weight that costs
// nothing and covers the case where it is not.
const DEFAULT_DOCS_GATE = {
  enabled: true,
  include: [
    "**/*.mjs",
    "**/*.js",
    "**/*.cjs",
    "**/*.ts",
    "**/*.tsx",
    "**/*.jsx",
    "**/*.py",
    "**/*.go",
    "**/*.cs",
    "**/*.java",
    "**/*.rb",
    "**/*.rs",
    "**/*.php",
  ],
  exclude: ["docs/**", "test/**", "tests/**", "**/*.md", ".harness/**"],
};

// Unit separator: it cannot occur in a commit subject or in a path, so it separates the fields of
// a log record without any quoting to undo.
//
// Written as an escape, never as the literal byte: an invisible control character in a source
// file survives no diff review and no copy-paste through a terminal.
const SEP = "\u001f";

const USAGE = [
  "Usage:",
  "  node docs-gate.mjs [--project-dir <path>] [--since <rev>] [--help]",
  "",
  "Prints which commits touched code without any issue naming them in 'covers'. Cumulative, not",
  "pointwise: it answers over a window of history, not about HEAD.",
  "Output is text, not JSON, and nothing is ever written to stderr.",
  "",
  "--project-dir  root of the project, holding .harness/config.json (default: the current one)",
  "--since <rev>  start the window at this revision instead of the oldest declared one",
  "",
  "The window starts at the oldest revision any issue declares in 'covers'. When no issue declares",
  "anything, the script stops and asks for an explicit --since instead of guessing a starting",
  "point: a wrong default here does not produce an error, it produces a plausible useless list.",
  "",
  "Exit codes: 0 on a printed report, including one that found uncovered commits, and on a gate",
  "disabled in config.json; 1 when the request could not be carried out at all — missing project,",
  "missing or unreadable .harness/config.json, a tracker issue-manager cannot read, no window and",
  "no --since,",
  "a --since that does not resolve, no git repository, an unknown flag.",
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

// Every git call goes through here, so "git is not installed" is reported once, as a sentence,
// instead of surfacing as an unhandled spawn error.
function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) {
    fail(`git non è disponibile: ${result.error.message}`);
  }
  return result;
}

// The gate reads which files count as code from .harness/config.json. A missing config is not a
// case to guess through: which globs are code is the project's decision, and inventing it silently
// is the thing references/config.md forbids.
function readDocsGate(projectDir) {
  const configPath = path.join(projectDir, ".harness", "config.json");
  if (!existsSync(configPath)) {
    fail(
      `Nessuna configurazione harness in '${projectDir}': manca '.harness/config.json'. ` +
        "Il gate legge da lì quali file contano come codice, e indovinarlo non è una cosa che harness fa."
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    fail(`'${configPath}' non è un JSON valido: la configurazione non è leggibile.`);
  }
  // Field by field, exactly as harness-config.mjs merges on --init: a partial docsGate must never
  // end up active with an empty include, which would report itself as a working gate matching
  // nothing.
  return { ...DEFAULT_DOCS_GATE, ...(parsed.docsGate ?? {}) };
}

const ISSUE_MANAGER = path.join(path.dirname(fileURLToPath(import.meta.url)), "issue-manager.mjs");

// The tracker is read through `issue-manager --dump`, never off disk. Storage is one Markdown file
// per issue, and a second reader of that layout would be a second place to fix every time it moves.
// This is the one thing this script does not do on its own any more, and the exception is the
// point: the gate cares about what an issue DECLARES in `covers`, not about where issues are kept.
//
// A project with no tracker at all is still an empty tracker and not an error — --dump says so
// itself, with ok:true and no issues. It declares no revision, so the window question comes up next.
function readIssues(projectDir) {
  const result = spawnSync(process.execPath, [ISSUE_MANAGER, "--dump", "--project-dir", projectDir], {
    encoding: "utf8",
    // A tracker has no size this gate can outgrow. The 1 MiB default does.
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    fail(`issue-manager non è eseguibile: ${result.error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    fail("issue-manager --dump non ha risposto con un envelope JSON: il tracker non è leggibile.");
  }
  if (!parsed.ok) {
    // Verbatim from issue-manager: a tracker still on the legacy JSON says so and names the command
    // that migrates it, and repeating that here in other words would only make the two disagree.
    fail(`Il tracker di '${projectDir}' non è leggibile: ${parsed.error}`);
  }
  return Array.isArray(parsed.data.issues) ? parsed.data.issues : [];
}

// Every declared reference goes through rev-parse, so a short sha and a long one are the same
// revision and a tag is the commit it points at. A reference that does not resolve is REPORTED,
// never silently dropped: that is the difference between a wrong datum you can see and one that
// passes.
function resolveRefs(refs, cwd) {
  const resolved = new Map();
  const unresolved = [];
  for (const ref of refs) {
    const result = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
    const sha = result.stdout.trim();
    if (result.status !== 0 || sha === "") {
      unresolved.push(ref);
      continue;
    }
    resolved.set(ref, sha);
  }
  return { resolved, unresolved };
}

// Oldest by committer date, in one process: --no-walk asks git about exactly these revisions
// instead of walking all the history behind them.
function oldestCommit(shas, cwd) {
  if (shas.length === 0) {
    // Guarded, not left to git: `git log --no-walk` with no revision quietly falls back to HEAD,
    // which would turn "nothing is declared" into a window of exactly one commit.
    return null;
  }
  const result = git(["log", "--no-walk", `--format=%H${SEP}%ct`, ...shas], cwd);
  if (result.status !== 0) {
    fail(`git log --no-walk è fallito: ${result.stdout.trim() || "nessun output"}`);
  }
  let oldest = null;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    const [sha, stamp] = line.split(SEP);
    const when = Number.parseInt(stamp, 10);
    if (oldest === null || when < oldest.when) {
      oldest = { sha, when };
    }
  }
  return oldest === null ? null : oldest.sha;
}

// Exported for the tests: the parsing is where a format string and a stream of file names can
// quietly disagree, and it deserves a check that costs no repository.
export function parseLog(stdout) {
  const commits = [];
  let current = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(SEP)) {
      const [, sha, subject] = line.split(SEP);
      current = { sha, subject: subject ?? "", files: [] };
      commits.push(current);
      continue;
    }
    if (current === null || line.trim() === "") {
      continue;
    }
    current.files.push(line.trim());
  }
  return commits;
}

// The window is what came AFTER the starting revision: that commit is covered by definition — it
// is the one an issue names — so `start..HEAD` loses nothing and avoids the `^` that has no
// meaning on a root commit.
//
// Merges are skipped: --name-only prints nothing for them anyway, so counting them would only
// inflate the scanned figure with rows that can never be code.
function readWindow(startSha, cwd) {
  const result = git(
    [
      // Paths stay literal UTF-8 instead of being octal-escaped by git's default quoting, or a
      // non-ASCII filename would never match a glob.
      "-c",
      "core.quotePath=false",
      "log",
      "--no-merges",
      "--name-only",
      `--format=${SEP}%H${SEP}%s`,
      `${startSha}..HEAD`,
    ],
    cwd
  );
  if (result.status !== 0) {
    fail(`git log è fallito: ${result.stdout.trim() || "nessun output"}`);
  }
  return parseLog(result.stdout);
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      options: {
        "project-dir": { type: "string" },
        since: { type: "string" },
        help: { type: "boolean", default: false },
      },
    }));
  } catch (error) {
    // strict on purpose, like status-cli.mjs: an invented flag must stop here. A report that looks
    // right but answers a different question is worse than no report.
    fail(
      `${error.message.replace(/\.?$/, ".")} docs-gate.mjs accetta solo --project-dir, --since e --help.`
    );
  }

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const projectDir = resolveProjectDir(values["project-dir"]);
  const project = path.basename(projectDir);

  const docsGate = readDocsGate(projectDir);
  if (docsGate.enabled === false) {
    process.stdout.write(
      ` ${project} · gate documentale disabilitato in .harness/config.json\n`
    );
    return;
  }

  if (git(["rev-parse", "--is-inside-work-tree"], projectDir).status !== 0) {
    fail(
      `'${projectDir}' non è un repository git: il gate legge la storia dei commit, e senza git non ha niente da leggere.`
    );
  }

  const { resolved, unresolved } = resolveRefs(declaredRefs(readIssues(projectDir)), projectDir);

  let startSha;
  let window;
  if (values.since) {
    const start = git(["rev-parse", "--verify", "--quiet", `${values.since}^{commit}`], projectDir);
    startSha = start.stdout.trim();
    if (start.status !== 0 || startSha === "") {
      fail(`--since '${values.since}' non è una revisione di questo repository.`);
    }
    window = `finestra da ${shortSha(startSha)} · --since`;
  } else {
    startSha = oldestCommit([...new Set(resolved.values())], projectDir);
    if (startSha === null) {
      // Harness only knows the period in which it was used: a window of "all the history" on a
      // repository that predates it by years produces thousands of rows.
      fail(
        "Nessuna issue dichiara una revisione in 'covers': non c'è un punto di partenza da cui " +
          "calcolare la finestra. Rilancia con --since <rev> esplicito — un default indovinato qui " +
          "non produce un errore, produce un elenco plausibile e inutile, che è peggio."
      );
    }
    window = `finestra da ${shortSha(startSha)} · più vecchia revisione dichiarata`;
  }

  const report = buildGateReport({
    commits: readWindow(startSha, projectDir),
    covered: new Set(resolved.values()),
    include: docsGate.include,
    exclude: docsGate.exclude,
  });

  process.stdout.write(`${renderGateReport(report, { project, window, unresolved })}\n`);
}

// The pure functions above are imported by the tests; main() must not run then.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
