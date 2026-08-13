// buildSnapshot and renderSnapshot are pure: they take issues in and give a snapshot or a string
// back. Everything worth getting wrong — what counts as workable, what a cycle is, how wide a row
// may be — is provable here with objects in memory. main() gets its own process-level tests.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSnapshot,
  renderSnapshot,
  renderOneline,
  formatAge,
  STATUS_ICON,
  TIER_ICON,
  WIDTH,
  BAR_INNER,
  TITLE_MAX,
  taskProgress,
} from "../scripts/status-cli.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "status-cli.mjs");

function runIn(projectDir, args = []) {
  return spawnSync(process.execPath, [SCRIPT, "--project-dir", projectDir, ...args], {
    encoding: "utf8",
  });
}

function tempProject(tracker) {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-status-"));
  if (tracker !== undefined) {
    writeFileSync(path.join(dir, "issues.json"), tracker);
  }
  return dir;
}

function issue(id, overrides = {}) {
  return {
    id,
    title: `Issue ${id.slice(0, 4)}`,
    description: "description",
    status: "backlog",
    tier: "standard",
    depends_on: [],
    validation: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("counts cover every status, including the ones nothing is in", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "done" }),
    issue("bbbbbbbb", { status: "done" }),
    issue("cccccccc", { status: "in_progress" }),
    issue("dddddddd"),
  ]);
  assert.deepEqual(snapshot.counts, {
    backlog: 1,
    in_progress: 1,
    in_review: 0,
    blocked: 0,
    done: 2,
  });
});

test("an empty tracker counts zero everywhere instead of missing keys", () => {
  assert.deepEqual(buildSnapshot([]).counts, {
    backlog: 0,
    in_progress: 0,
    in_review: 0,
    blocked: 0,
    done: 0,
  });
});

test("in flight is in_progress, in_review and blocked, in that order", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "blocked" }),
    issue("bbbbbbbb", { status: "in_review" }),
    issue("cccccccc", { status: "in_progress" }),
    issue("dddddddd", { status: "done" }),
    issue("eeeeeeee"),
  ]);
  assert.deepEqual(
    snapshot.inFlight.map((i) => i.id),
    ["cccccccc", "bbbbbbbb", "aaaaaaaa"]
  );
});

test("inside one status the most recently touched issue comes first", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "in_progress", updated_at: "2026-01-01T00:00:00Z" }),
    issue("bbbbbbbb", { status: "in_progress", updated_at: "2026-03-01T00:00:00Z" }),
    issue("cccccccc", { status: "in_progress", updated_at: "2026-02-01T00:00:00Z" }),
  ]);
  assert.deepEqual(
    snapshot.inFlight.map((i) => i.id),
    ["bbbbbbbb", "cccccccc", "aaaaaaaa"]
  );
});

test("in flight is never truncated: twelve open issues are a WIP problem to see", () => {
  const many = Array.from({ length: 12 }, (_, n) =>
    issue(`${n}`.padStart(8, "0"), { status: "in_progress" })
  );
  assert.equal(buildSnapshot(many).inFlight.length, 12);
});

test("the icon tables are the ASCII ones the spec fixes", () => {
  assert.deepEqual(STATUS_ICON, {
    backlog: "o",
    in_progress: "+",
    in_review: "~",
    blocked: "!",
    done: "#",
  });
  assert.deepEqual(TIER_ICON, { economy: "$", standard: "$$", reasoning: "$$$" });
});

test("an issue with no dependencies is workable", () => {
  const snapshot = buildSnapshot([issue("aaaaaaaa")]);
  assert.deepEqual(snapshot.workable.map((i) => i.id), ["aaaaaaaa"]);
  assert.equal(snapshot.workableTotal, 1);
});

test("an issue is workable once every dependency is done", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "done" }),
    issue("bbbbbbbb", { status: "done" }),
    issue("cccccccc", { depends_on: ["aaaaaaaa", "bbbbbbbb"] }),
  ]);
  assert.deepEqual(snapshot.workable.map((i) => i.id), ["cccccccc"]);
});

test("one dependency still open is enough to keep an issue out", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "done" }),
    issue("bbbbbbbb", { status: "in_progress" }),
    issue("cccccccc", { depends_on: ["aaaaaaaa", "bbbbbbbb"] }),
  ]);
  assert.deepEqual(snapshot.workable, []);
  assert.equal(snapshot.workableTotal, 0);
});

test("only backlog issues are workable: in flight ones are already taken", () => {
  const snapshot = buildSnapshot([issue("aaaaaaaa", { status: "in_progress" })]);
  assert.deepEqual(snapshot.workable, []);
});

test("a dependency that does not exist makes the issue not workable", () => {
  // Conservative on purpose: we do not know what is missing, and calling an issue that depends on
  // nothing workable is how the wrong work gets started.
  const snapshot = buildSnapshot([issue("cccccccc", { depends_on: ["ffffffff"] })]);
  assert.deepEqual(snapshot.workable, []);
  assert.equal(snapshot.workableTotal, 0);
});

test("workable issues come out oldest first", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { created_at: "2026-03-01T00:00:00Z" }),
    issue("bbbbbbbb", { created_at: "2026-01-01T00:00:00Z" }),
    issue("cccccccc", { created_at: "2026-02-01T00:00:00Z" }),
  ]);
  assert.deepEqual(
    snapshot.workable.map((i) => i.id),
    ["bbbbbbbb", "cccccccc", "aaaaaaaa"]
  );
});

test("workable is cut to three, and the total says how many there really are", () => {
  const many = Array.from({ length: 7 }, (_, n) =>
    issue(`${n}`.padStart(8, "0"), { created_at: `2026-01-0${n + 1}T00:00:00Z` })
  );
  const snapshot = buildSnapshot(many);
  assert.equal(snapshot.workable.length, 3);
  assert.equal(snapshot.workableTotal, 7);
  assert.deepEqual(
    snapshot.workable.map((i) => i.id),
    ["00000000", "00000001", "00000002"]
  );
});

test("a missing depends_on field reads as no dependencies", () => {
  const bare = issue("aaaaaaaa");
  delete bare.depends_on;
  assert.deepEqual(buildSnapshot([bare]).workable.map((i) => i.id), ["aaaaaaaa"]);
});

test("no alerts on a healthy tracker", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "done" }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
  ]);
  assert.deepEqual(snapshot.alerts, []);
});

test("a cycle among open issues is reported with every id involved", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { depends_on: ["bbbbbbbb"] }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
  ]);
  // Two issues waiting on each other are also two issues nobody can take, so the standstill alert
  // fires alongside the cycle. Both are true and neither implies the other: a standstill can come
  // from a plain chain, and a cycle can sit next to workable issues elsewhere.
  const cycle = snapshot.alerts.find((a) => a.startsWith("ciclo nei depends_on: "));
  assert.ok(cycle, `no cycle alert among ${JSON.stringify(snapshot.alerts)}`);
  assert.match(cycle, /aaaaaaaa/);
  assert.match(cycle, /bbbbbbbb/);
  assert.equal(snapshot.alerts[0], cycle, "the cycle explains the rest and must come first");
});

test("a cycle among done issues is history, not an alert", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "done", depends_on: ["bbbbbbbb"] }),
    issue("bbbbbbbb", { status: "done", depends_on: ["aaaaaaaa"] }),
  ]);
  assert.deepEqual(snapshot.alerts, []);
});

test("a cycle does not stop the rest of the snapshot", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { depends_on: ["bbbbbbbb"] }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
    issue("cccccccc", { status: "in_progress" }),
  ]);
  assert.equal(snapshot.counts.in_progress, 1);
  assert.deepEqual(snapshot.inFlight.map((i) => i.id), ["cccccccc"]);
});

test("dangling dependencies are counted and their missing ids named", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { depends_on: ["ffffffff"] }),
    issue("bbbbbbbb", { depends_on: ["ffffffff"] }),
  ]);
  const alert = snapshot.alerts.find((a) => a.includes("id inesistenti"));
  assert.match(alert, /^2 issue dipendono da id inesistenti: ffffffff$/);
});

test("one dangling dependency reads in the singular", () => {
  const snapshot = buildSnapshot([issue("aaaaaaaa", { depends_on: ["ffffffff"] })]);
  const alert = snapshot.alerts.find((a) => a.includes("id inesistente"));
  assert.match(alert, /^1 issue dipende da id inesistente: ffffffff$/);
});

test("a full backlog with nothing workable is a standstill", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "in_progress" }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
    issue("cccccccc", { depends_on: ["aaaaaaaa"] }),
  ]);
  const alert = snapshot.alerts.find((a) => a.startsWith("backlog fermo"));
  assert.equal(alert, "backlog fermo: 2 issue, nessuna lavorabile — tutte attendono qualcosa");
});

test("the standstill alert names the backlog, never in the 'N di M' shape of the heading", () => {
  // The two numbers on screen count different things: the alert counts the BACKLOG, the heading
  // counts the WORKABLE ones. They used to share the "N di M" shape two lines apart, which is
  // what made them unreadable together. The alert dropped the shape; this test pins both.
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "in_progress" }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
    issue("cccccccc", { depends_on: ["aaaaaaaa"] }),
    issue("dddddddd", { depends_on: ["aaaaaaaa"] }),
    issue("eeeeeeee", { depends_on: ["aaaaaaaa"] }),
  ]);
  assert.equal(snapshot.counts.backlog, 4, "four issues sit in backlog");
  assert.equal(snapshot.workableTotal, 0, "none of them is workable");

  const alert = snapshot.alerts.find((a) => a.startsWith("backlog fermo"));
  assert.equal(alert, "backlog fermo: 4 issue, nessuna lavorabile — tutte attendono qualcosa");
  assert.ok(!/\bdi \d/.test(alert), "the alert must not reuse the heading's 'N di M' shape");

  const out = renderSnapshot(snapshot, { project: "harness", lastUpdated: null });
  assert.ok(out.includes(" LAVORABILI · 0 di 0"), "the heading counts workable, not backlog");
});

test("with workable issues the heading shows shown-of-workable and no standstill fires", () => {
  const issues = [
    issue("aaaaaaaa", { status: "done" }),
    ...Array.from({ length: 7 }, (_, n) =>
      issue(`${n}`.padStart(8, "0"), {
        depends_on: ["aaaaaaaa"],
        created_at: `2026-01-0${n + 1}T00:00:00Z`,
      })
    ),
    issue("ffffffff", { depends_on: ["nonesiste"] }),
  ];
  const snapshot = buildSnapshot(issues);
  assert.equal(snapshot.counts.backlog, 8, "eight in backlog");
  assert.equal(snapshot.workableTotal, 7, "one of them depends on a missing id");
  assert.ok(!snapshot.alerts.some((a) => a.startsWith("backlog fermo")));

  const out = renderSnapshot(snapshot, { project: "harness", lastUpdated: null });
  assert.ok(out.includes(" LAVORABILI · 3 di 7"), "three shown out of seven workable, not eight");
});

test("an empty backlog is not a standstill", () => {
  const snapshot = buildSnapshot([issue("aaaaaaaa", { status: "done" })]);
  assert.deepEqual(snapshot.alerts, []);
});

test("blocked issues raise no alert: they are already in the in-flight section", () => {
  const snapshot = buildSnapshot([issue("aaaaaaaa", { status: "blocked" })]);
  assert.deepEqual(snapshot.alerts, []);
  assert.deepEqual(snapshot.inFlight.map((i) => i.id), ["aaaaaaaa"]);
});

function render(issues, opts = {}) {
  return renderSnapshot(buildSnapshot(issues), {
    project: "harness",
    lastUpdated: "2026-08-04T09:12:00Z",
    ...opts,
  });
}

function lines(text) {
  return text.split("\n");
}

const EVERY_STATUS = ["done", "in_progress", "in_review", "blocked", "backlog"];

test("the header names the project and the tracker size", () => {
  const first = lines(render([issue("aaaaaaaa")]))[0];
  assert.match(first, /^ harness · 1 issue · aggiornato /);
});

test("the header counts done issues too: it is the tracker, not the open work", () => {
  const first = lines(render([issue("aaaaaaaa", { status: "done" }), issue("bbbbbbbb")]))[0];
  assert.match(first, /^ harness · 2 issue/);
});

test("a tracker with no last_updated stops the header at the count", () => {
  const first = lines(render([issue("aaaaaaaa")], { lastUpdated: null }))[0];
  assert.equal(first, " harness · 1 issue");
});

test("an unparseable last_updated is dropped rather than printed raw", () => {
  const first = lines(render([issue("aaaaaaaa")], { lastUpdated: "not a date" }))[0];
  assert.equal(first, " harness · 1 issue");
});

test("the bar segments always add up to the exact bar width", () => {
  const cases = [
    [issue("aaaaaaaa")],
    [issue("aaaaaaaa", { status: "done" }), issue("bbbbbbbb")],
    Array.from({ length: 97 }, (_, n) =>
      issue(`${n}`.padStart(8, "0"), { status: n === 0 ? "blocked" : "done" })
    ),
  ];
  for (const issues of cases) {
    const bar = lines(render(issues)).find((l) => l.trim().startsWith("["));
    const inner = bar.trim().slice(1, -1);
    assert.equal(inner.length, BAR_INNER, `bar was ${inner.length} wide for ${issues.length} issues`);
  }
});

test("a status with at least one issue never vanishes from the bar", () => {
  const issues = Array.from({ length: 200 }, (_, n) =>
    issue(`${n}`.padStart(8, "0"), { status: n === 0 ? "blocked" : "done" })
  );
  const bar = lines(render(issues)).find((l) => l.trim().startsWith("["));
  assert.ok(bar.includes(STATUS_ICON.blocked), "one blocked issue in two hundred still gets a column");
});

test("the legend lists only the statuses that are actually there", () => {
  const legend = lines(render([issue("aaaaaaaa", { status: "done" }), issue("bbbbbbbb")])).find(
    (l) => l.includes("done")
  );
  assert.match(legend, /# done 1/);
  assert.match(legend, /o backlog 1/);
  assert.ok(!legend.includes("blocked"), "an empty status in the legend explains an absent icon");
});

test("no line is wider than eighty columns, even with three-digit counts", () => {
  const issues = Array.from({ length: 999 }, (_, n) =>
    issue(`${n}`.padStart(8, "0"), { status: EVERY_STATUS[n % 5] })
  );
  for (const line of lines(render(issues))) {
    assert.ok(line.length <= WIDTH, `line is ${line.length} columns: ${JSON.stringify(line)}`);
  }
});

test("an in-flight row carries icon, short id, status word, tier, task count and title", () => {
  const out = render([
    issue("aaaaaaaa-1111-2222-3333-444444444444", {
      status: "in_progress",
      tier: "standard",
      title: "vista albero delle catene",
      tasks: [
        { id: 1, short_title: "one", full_description: "d", checked: true },
        { id: 2, short_title: "two", full_description: "d", checked: false },
      ],
    }),
  ]);
  const row = lines(out).find((l) => l.includes("vista albero"));
  assert.equal(row, "  + aaaaaaaa  in_progress  $$   1/2    vista albero delle catene");
});

test("the same row with no tasks keeps its shape and shows a dash", () => {
  const out = render([
    issue("aaaaaaaa-1111-2222-3333-444444444444", {
      status: "in_progress",
      tier: "standard",
      title: "vista albero delle catene",
    }),
  ]);
  const row = lines(out).find((l) => l.includes("vista albero"));
  assert.equal(row, "  + aaaaaaaa  in_progress  $$   -      vista albero delle catene");
});

test("a workable row drops the status word: every one of them is backlog", () => {
  const out = render([issue("bbbbbbbb", { tier: "economy", title: "drawer con focus trap" })]);
  const row = lines(out).find((l) => l.includes("drawer con"));
  assert.equal(row, "  o bbbbbbbb  $    drawer con focus trap");
});

test("every tier gets its icon, and an undeclared tier gets a dash", () => {
  const out = render([
    issue("aaaaaaaa", { tier: "economy", title: "eco" }),
    issue("bbbbbbbb", { tier: "standard", title: "std" }),
    issue("cccccccc", { tier: "reasoning", title: "rsn" }),
  ]);
  assert.match(lines(out).find((l) => l.endsWith("eco")), /\$ {4}eco$/);
  assert.match(lines(out).find((l) => l.endsWith("std")), /\$\$ {3}std$/);
  assert.match(lines(out).find((l) => l.endsWith("rsn")), /\$\$\$ {2}rsn$/);

  const bare = render([issue("dddddddd", { tier: null, title: "senza tier" })]);
  assert.match(lines(bare).find((l) => l.includes("senza tier")), /- {4}senza tier$/);
});

test("a long title is cut to the limit with three ASCII dots", () => {
  const long = "filtri per tier nel board, con scorciatoie e tema a tre stati";
  const out = render([issue("aaaaaaaa", { status: "in_progress", title: long })]);
  const row = lines(out).find((l) => l.includes("filtri per tier"));
  const title = row.slice(row.indexOf("filtri"));
  assert.equal(title.length, TITLE_MAX);
  assert.ok(title.endsWith("..."), "the ellipsis must be three ASCII dots, never a single glyph");
  assert.ok(!title.includes("…"));
});

test("a title exactly at the limit is left alone", () => {
  const exact = "x".repeat(TITLE_MAX);
  const out = render([issue("aaaaaaaa", { status: "in_progress", title: exact })]);
  assert.ok(out.includes(exact));
  assert.ok(!out.includes("..."));
});

test("newlines inside a title cannot break the table", () => {
  const out = render([issue("aaaaaaaa", { status: "in_progress", title: "prima\nseconda" })]);
  assert.ok(out.includes("prima seconda"));
  for (const line of lines(out)) {
    assert.ok(line.length <= WIDTH);
  }
});

test("the workable heading always declares the real total", () => {
  const many = Array.from({ length: 7 }, (_, n) =>
    issue(`${n}`.padStart(8, "0"), { created_at: `2026-01-0${n + 1}T00:00:00Z` })
  );
  assert.ok(render(many).includes("LAVORABILI · 3 di 7"));
});

test("the tier legend closes the output", () => {
  const out = render([issue("aaaaaaaa")]);
  assert.match(
    lines(out).at(-1),
    /^ tier {2}\$ economy {3}\$\$ standard {3}\$\$\$ reasoning {3}- non dichiarato$/
  );
});

test("the section headings are the agreed words", () => {
  const out = render([issue("aaaaaaaa", { status: "in_progress" }), issue("bbbbbbbb")]);
  assert.ok(out.includes(" IN CORSO"), "the heading is IN CORSO, not IN VOLO");
  assert.ok(!out.includes("IN VOLO"));
  assert.ok(out.includes(" LAVORABILI · 1 di 1"));
});

test("no line is wider than eighty columns with the longest legal title", () => {
  const out = render([
    issue("aaaaaaaa", { status: "in_progress", tier: "reasoning", title: "x".repeat(80) }),
    issue("bbbbbbbb", { tier: "reasoning", title: "y".repeat(80) }),
  ]);
  for (const line of lines(out)) {
    assert.ok(line.length <= WIDTH, `line is ${line.length} columns: ${JSON.stringify(line)}`);
  }
});

test("alerts sit above the bar, each behind an exclamation mark", () => {
  const out = render([
    issue("aaaaaaaa", { depends_on: ["bbbbbbbb"] }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
  ]);
  const rows = lines(out);
  const alertAt = rows.findIndex((l) => l.startsWith(" ! "));
  const barAt = rows.findIndex((l) => l.trim().startsWith("["));
  assert.ok(alertAt >= 0, "the cycle must reach the output");
  assert.ok(alertAt < barAt, "an alert below the bar is an alert nobody reads first");
  assert.match(rows[alertAt], /^ ! ciclo nei depends_on: /);
});

test("a healthy tracker prints no exclamation line", () => {
  const out = render([issue("aaaaaaaa", { status: "done" })]);
  assert.ok(!lines(out).some((l) => l.startsWith(" ! ")));
});

test("an alert line is wrapped, never allowed past eighty columns", () => {
  const many = Array.from({ length: 40 }, (_, n) => `${n}`.padStart(8, "0"));
  const issues = many.map((id, n) => issue(id, { depends_on: [many[(n + 1) % many.length]] }));
  for (const line of lines(render(issues))) {
    assert.ok(line.length <= WIDTH, `line is ${line.length} columns: ${JSON.stringify(line)}`);
  }
});

test("an empty tracker says so and prints nothing else", () => {
  const out = renderSnapshot(buildSnapshot([]), { project: "harness", lastUpdated: null });
  assert.equal(out, " harness · tracker vuoto");
});

test("nothing in flight is itself the answer, so the section stays", () => {
  const out = render([issue("aaaaaaaa")]);
  const rows = lines(out);
  const at = rows.indexOf(" IN CORSO");
  assert.ok(at >= 0);
  assert.equal(rows[at + 2], "  nessuna issue aperta");
});

test("an empty backlog says there is nothing to take", () => {
  const out = render([issue("aaaaaaaa", { status: "in_progress" })]);
  const rows = lines(out);
  const at = rows.indexOf(" LAVORABILI · 0 di 0");
  assert.ok(at >= 0);
  assert.equal(rows[at + 2], "  niente in backlog");
});

test("a full backlog with nothing workable shows the standstill alert and the empty section", () => {
  const out = render([
    issue("aaaaaaaa", { status: "in_progress" }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
  ]);
  assert.ok(out.includes(" ! backlog fermo: 1 issue, nessuna lavorabile — tutte attendono qualcosa"));
  assert.ok(out.includes(" LAVORABILI · 0 di 0"));
});

test("a valid tracker prints the snapshot and exits zero", () => {
  const dir = tempProject(
    JSON.stringify({
      last_updated: "2026-08-04T09:12:00Z",
      issues: [issue("aaaaaaaa", { status: "in_progress", title: "prima issue" })],
    })
  );
  try {
    const run = runIn(dir);
    assert.equal(run.status, 0);
    assert.equal(run.stderr, "", "nothing goes to stderr, ever");
    assert.match(run.stdout, /IN CORSO/);
    assert.match(run.stdout, /prima issue/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the project name falls back to the directory when the tracker does not carry one", () => {
  const dir = tempProject(JSON.stringify({ last_updated: null, issues: [issue("aaaaaaaa")] }));
  try {
    assert.ok(runIn(dir).stdout.startsWith(` ${path.basename(dir)} · 1 issue`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a project with no issues.json is an empty tracker, not an error", () => {
  const dir = tempProject(undefined);
  try {
    const run = runIn(dir);
    assert.equal(run.status, 0);
    assert.match(run.stdout, /tracker vuoto/);
    assert.equal(run.stderr, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt issues.json fails loudly instead of printing a plausible screen", () => {
  const dir = tempProject("{ not json");
  try {
    const run = runIn(dir);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /non è un JSON valido/);
    assert.equal(run.stderr, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a project directory that does not exist fails", () => {
  const run = runIn(path.join(tmpdir(), "harness-status-does-not-exist"));
  assert.equal(run.status, 1);
  assert.match(run.stdout, /non esiste/);
  assert.equal(run.stderr, "");
});

test("an invented flag fails instead of printing a summary that looks right", () => {
  const dir = tempProject(JSON.stringify({ last_updated: null, issues: [] }));
  try {
    const run = runIn(dir, ["--watch"]);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /--project-dir/);
    assert.equal(run.stderr, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--help explains the usage and exits zero", () => {
  const run = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /status-cli\.mjs/);
  assert.equal(run.stderr, "");
});

test("stdout is text, not the one-line JSON the other scripts print", () => {
  const dir = tempProject(JSON.stringify({ last_updated: null, issues: [issue("aaaaaaaa")] }));
  try {
    assert.throws(() => JSON.parse(runIn(dir).stdout.split("\n")[0]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The count of execution tasks: the one datum whoever resumes the work was missing. It shows up
// where the summary actually runs — at a session boundary, which is where every resumption starts.
// ---------------------------------------------------------------------------

function withTasks(count, checked) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    short_title: `task ${i + 1}`,
    full_description: "d",
    checked: i < checked,
  }));
}

test("taskProgress counts checked over total, and says nothing rather than zero when there are none", () => {
  assert.equal(taskProgress({ tasks: [] }), "-");
  assert.equal(taskProgress({}), "-");
  assert.equal(taskProgress({ tasks: withTasks(2, 1) }), "1/2");
  assert.equal(taskProgress({ tasks: withTasks(1, 1) }), "1/1");
  assert.equal(taskProgress({ tasks: withTasks(3, 0) }), "0/3");
});

test("an in-flight row carries the count of its execution tasks", () => {
  const rendered = renderSnapshot(
    buildSnapshot([
      issue("aaaaaaaa-0000-0000-0000-000000000000", {
        status: "in_progress",
        title: "Hop Angular 18 -> 19",
        tier: "reasoning",
        tasks: withTasks(7, 4),
      }),
    ]),
    { project: "P", lastUpdated: null }
  );
  const row = rendered.split("\n").find((line) => line.includes("Hop Angular"));
  assert.match(row, /4\/7/);
});

test("an issue with no tasks shows a dash, exactly like an undeclared tier", () => {
  const rendered = renderSnapshot(
    buildSnapshot([issue("bbbbbbbb-0000-0000-0000-000000000000", { status: "blocked", tasks: [] })]),
    { project: "P", lastUpdated: null }
  );
  const row = rendered.split("\n").find((line) => line.includes("bbbbbbbb"));
  assert.match(row, / - /, `a task-less row must show a dash: ${JSON.stringify(row)}`);
});

test("the count column does not push any row off the screen", () => {
  const rendered = renderSnapshot(
    buildSnapshot([
      issue("cccccccc-0000-0000-0000-000000000000", {
        status: "in_progress",
        title: "x".repeat(200),
        tier: "reasoning",
        tasks: withTasks(12, 9),
      }),
    ]),
    { project: "P", lastUpdated: null }
  );
  for (const line of rendered.split("\n")) {
    assert.ok(line.length <= WIDTH, `row wider than ${WIDTH}: ${JSON.stringify(line)}`);
  }
});

test("the workable rows carry no count: a backlog issue has no tasks yet, by design", () => {
  const rendered = renderSnapshot(
    buildSnapshot([issue("dddddddd-0000-0000-0000-000000000000", { status: "backlog", tasks: [] })]),
    { project: "P", lastUpdated: null }
  );
  const row = rendered.split("\n").find((line) => line.includes("dddddddd"));
  assert.ok(!/\d\/\d/.test(row), `a workable row must not carry a count: ${JSON.stringify(row)}`);
});

// --oneline is the other surface: one line for a host status bar. Its output contract is the
// INVERSE of everything above — it never fails, never writes to stderr, and prints nothing rather
// than an error. These tests are what stops someone from "fixing" it back to the general contract.

const counts = (over = {}) => ({
  backlog: 0,
  in_progress: 0,
  in_review: 0,
  blocked: 0,
  done: 0,
  ...over,
});

test("renderOneline lists the non-empty statuses in reading order", () => {
  const line = renderOneline({
    counts: counts({ backlog: 4, in_progress: 1, in_review: 2, done: 12 }),
    alerts: [],
  });
  assert.equal(line, "1 in corso | 2 in verifica | 4 backlog | 12 chiuse");
});

test("renderOneline drops the statuses nothing is in", () => {
  const line = renderOneline({
    counts: counts({ backlog: 3, in_progress: 1, done: 9 }),
    alerts: [],
  });
  assert.equal(line, "1 in corso | 3 backlog | 9 chiuse");
});

test("renderOneline marks alerts and only alerts", () => {
  const only = counts({ backlog: 1 });
  assert.equal(renderOneline({ counts: only, alerts: [] }), "1 backlog");
  assert.equal(renderOneline({ counts: only, alerts: ["ciclo nei depends_on: a b"] }), "1 backlog !");
});

test("renderOneline on an empty tracker is the empty line", () => {
  // A status bar saying "zero" spends the row it was given on the absence of news.
  assert.equal(renderOneline({ counts: counts(), alerts: [] }), "");
});

test("renderOneline stays inside ASCII: it lands in tmux, not in a code block", () => {
  const line = renderOneline({
    counts: counts({ backlog: 1, in_progress: 1, in_review: 1, blocked: 1, done: 1 }),
    alerts: ["x"],
  });
  assert.match(line, /^[\x20-\x7e]*$/, `non-ASCII in the status line: ${JSON.stringify(line)}`);
});

// The task count is the answer to "how far is the thing being worked on", and that question only
// has one answer when only one thing is being worked on.

const inFlightSnapshot = (issues, over = {}) => ({
  counts: counts(over),
  alerts: [],
  inFlight: issues,
});

test("the task count shows when exactly one issue is in flight", () => {
  const line = renderOneline(
    inFlightSnapshot(
      [issue("aaaaaaaa-0000-0000-0000-000000000000", { status: "in_progress", tasks: withTasks(9, 2) })],
      { in_progress: 1, backlog: 3, done: 9 }
    )
  );
  assert.equal(line, "1 in corso [2/9] | 3 backlog | 9 chiuse");
});

test("the task count shows for an issue waiting on the verifier too", () => {
  const line = renderOneline(
    inFlightSnapshot(
      [issue("bbbbbbbb-0000-0000-0000-000000000000", { status: "in_review", tasks: withTasks(4, 4) })],
      { in_review: 1, done: 9 }
    )
  );
  assert.equal(line, "1 in verifica [4/4] | 9 chiuse");
});

test("with two issues in flight the count disappears: it would answer for which one?", () => {
  const line = renderOneline(
    inFlightSnapshot(
      [
        issue("aaaaaaaa-0000-0000-0000-000000000000", { status: "in_progress", tasks: withTasks(9, 2) }),
        issue("bbbbbbbb-0000-0000-0000-000000000000", { status: "in_review", tasks: withTasks(4, 4) }),
      ],
      { in_progress: 1, in_review: 1, done: 9 }
    )
  );
  assert.equal(line, "1 in corso | 1 in verifica | 9 chiuse");
});

test("an issue with no tasks yet shows no brackets, not an empty pair", () => {
  const line = renderOneline(
    inFlightSnapshot(
      [issue("aaaaaaaa-0000-0000-0000-000000000000", { status: "in_progress", tasks: [] })],
      { in_progress: 1, done: 9 }
    )
  );
  assert.equal(line, "1 in corso | 9 chiuse");
});

test("a blocked issue alone does not carry the count: it is not what is being worked on", () => {
  const line = renderOneline(
    inFlightSnapshot(
      [issue("cccccccc-0000-0000-0000-000000000000", { status: "blocked", tasks: withTasks(5, 1) })],
      { blocked: 1, done: 9 }
    )
  );
  assert.equal(line, "1 bloccate | 9 chiuse");
});

test("--color wraps every part, and without it there is not one escape byte", () => {
  const snapshot = inFlightSnapshot([], { in_progress: 1, done: 2 });
  snapshot.alerts = ["ciclo"];

  const plain = renderOneline(snapshot);
  assert.equal(plain.includes("\x1b"), false, "the default must never emit ANSI");

  const painted = renderOneline(snapshot, { color: true });
  assert.match(painted, /\x1b\[36m1 in corso\x1b\[0m/);
  assert.match(painted, /\x1b\[32m2 chiuse\x1b\[0m/);
  assert.match(painted, /\x1b\[31m!\x1b\[0m/);
  // Stripping the escapes must give back exactly the plain line: colour adds paint, not content.
  assert.equal(painted.replace(/\x1b\[[0-9;]*m/g, ""), plain);
});

test("--color on the process emits ANSI, and its absence does not", () => {
  const tracker = JSON.stringify({
    schema_version: 3,
    issues: [issue("aaaaaaaa-0000-0000-0000-000000000000", { status: "in_progress", tasks: withTasks(3, 1) })],
  });

  const plain = runIn(tempProject(tracker), ["--oneline"]);
  assert.equal(plain.status, 0);
  assert.equal(plain.stdout.includes("\x1b"), false);
  assert.equal(plain.stdout.trim(), "1 in corso [1/3]");

  const painted = runIn(tempProject(tracker), ["--oneline", "--color"]);
  assert.equal(painted.status, 0);
  assert.equal(painted.stderr, "");
  assert.equal(painted.stdout.includes("\x1b"), true);
});

test("--oneline exits 0 and stays silent when there is no tracker", () => {
  const run = runIn(tempProject(), ["--oneline"]);
  assert.equal(run.status, 0, "a status bar command must never fail");
  assert.equal(run.stderr, "");
  assert.equal(run.stdout.trim(), "");
});

test("--oneline exits 0 and stays silent on a malformed tracker", () => {
  const run = runIn(tempProject("{ not json at all"), ["--oneline"]);
  assert.equal(run.status, 0, "an error repeated on every refresh is worse than silence");
  assert.equal(run.stderr, "");
  assert.equal(run.stdout.trim(), "");
});

test("--oneline prints the counts of a real tracker", () => {
  const run = runIn(
    tempProject(
      JSON.stringify({
        schema_version: 3,
        issues: [
          issue("aaaaaaaa-0000-0000-0000-000000000000", { status: "in_progress" }),
          issue("bbbbbbbb-0000-0000-0000-000000000000", { status: "done" }),
        ],
      })
    ),
    ["--oneline"]
  );
  assert.equal(run.status, 0);
  assert.equal(run.stderr, "");
  assert.equal(run.stdout.trim(), "1 in corso | 1 chiuse");
});

test("--oneline exits 0 even when the project directory does not exist", () => {
  // resolveProjectDir() calls fail(), which exits 1. The flag must be handled before it.
  const run = runIn(path.join(tmpdir(), "harness-does-not-exist-at-all"), ["--oneline"]);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, "");
  assert.equal(run.stdout.trim(), "");
});

// ---------------------------------------------------------------------------
// The age of the tracker: the line's heartbeat. This command has no cache and rereads issues.json
// on every run, so a line that RUNS is aligned by construction — the only possible mismatch is not
// running at all. A frozen line and a fresh one showing the same counts are indistinguishable
// without this, which is how someone watches a dead line for minutes believing it live.
// ---------------------------------------------------------------------------

const AT = Date.parse("2026-08-13T12:00:00.000Z");
const ago = (seconds) => new Date(AT - seconds * 1000).toISOString();

test("formatAge is seconds under the minute", () => {
  assert.equal(formatAge(ago(0), AT), "0s");
  assert.equal(formatAge(ago(12), AT), "12s");
  assert.equal(formatAge(ago(59), AT), "59s");
});

test("formatAge is minutes and seconds under the hour", () => {
  assert.equal(formatAge(ago(60), AT), "1m 0s");
  assert.equal(formatAge(ago(192), AT), "3m 12s");
  assert.equal(formatAge(ago(3599), AT), "59m 59s");
});

test("formatAge is hours, minutes and seconds beyond that", () => {
  assert.equal(formatAge(ago(3600), AT), "1h 0m 0s");
  assert.equal(formatAge(ago(3732), AT), "1h 2m 12s");
  assert.equal(formatAge(ago(90000), AT), "25h 0m 0s");
});

test("the seconds never disappear, in any of the three brackets", () => {
  // Without them the heartbeat stops for a whole minute above the minute mark, and a live line
  // becomes indistinguishable from a dead one exactly when it matters.
  for (const seconds of [5, 192, 3732, 90000]) {
    assert.match(formatAge(ago(seconds), AT), /\d+s$/);
  }
});

test("formatAge says nothing at all when there is nothing to say", () => {
  // No placeholder, no question mark: the same rule as the task brackets.
  assert.equal(formatAge(null, AT), null);
  assert.equal(formatAge(undefined, AT), null);
  assert.equal(formatAge("", AT), null);
  assert.equal(formatAge("not a date", AT), null);
});

test("a tracker written in the future reads as fresh, never as a negative age", () => {
  // Clock skew between the writer and the reader is not an error worth a row in a status bar.
  assert.equal(formatAge(ago(-30), AT), "0s");
});

test("renderOneline closes the line with the age of last_updated", () => {
  const line = renderOneline(
    { counts: counts({ in_progress: 1, done: 9 }), alerts: [] },
    { lastUpdated: ago(192), now: AT }
  );
  assert.equal(line, "1 in corso | 9 chiuse | 3m 12s");
});

test("the age sits after the alert marker: it closes the line, and the marker is a count's", () => {
  const line = renderOneline(
    { counts: counts({ backlog: 1 }), alerts: ["ciclo nei depends_on: a b"] },
    { lastUpdated: ago(12), now: AT }
  );
  assert.equal(line, "1 backlog ! | 12s");
});

test("no last_updated means no age, and no space spent saying so", () => {
  const snapshot = { counts: counts({ in_progress: 1, done: 9 }), alerts: [] };
  assert.equal(renderOneline(snapshot), "1 in corso | 9 chiuse");
  assert.equal(renderOneline(snapshot, { lastUpdated: null, now: AT }), "1 in corso | 9 chiuse");
  assert.equal(
    renderOneline(snapshot, { lastUpdated: "not a date", now: AT }),
    "1 in corso | 9 chiuse"
  );
});

test("an empty tracker stays the empty line, age or no age", () => {
  assert.equal(renderOneline({ counts: counts(), alerts: [] }, { lastUpdated: ago(12), now: AT }), "");
});

test("the line stays inside ASCII with the age on it", () => {
  const line = renderOneline(
    {
      counts: counts({ backlog: 1, in_progress: 1, in_review: 1, blocked: 1, done: 1 }),
      alerts: ["x"],
    },
    { lastUpdated: ago(3732), now: AT }
  );
  assert.match(line, /^[\x20-\x7e]*$/, `non-ASCII in the status line: ${JSON.stringify(line)}`);
});

test("the age is paint under --color and content without it", () => {
  const snapshot = { counts: counts({ in_progress: 1, done: 2 }), alerts: [] };
  const opts = { lastUpdated: ago(12), now: AT };

  const plain = renderOneline(snapshot, opts);
  assert.equal(plain.includes("\x1b"), false, "the default must never emit ANSI");
  assert.ok(plain.endsWith(" | 12s"));

  const painted = renderOneline(snapshot, { ...opts, color: true });
  assert.match(painted, /\x1b\[90m12s\x1b\[0m$/);
  assert.equal(painted.replace(/\x1b\[[0-9;]*m/g, ""), plain);
});

test("--oneline on the process carries the age of the tracker it just read", () => {
  const run = runIn(
    tempProject(
      JSON.stringify({
        schema_version: 3,
        last_updated: new Date().toISOString(),
        issues: [issue("aaaaaaaa-0000-0000-0000-000000000000", { status: "in_progress" })],
      })
    ),
    ["--oneline"]
  );
  assert.equal(run.status, 0);
  assert.equal(run.stderr, "");
  assert.match(run.stdout.trim(), /^1 in corso \| \d+s$/);
});

// Read as seconds, so the three brackets compare as one number.
function ageSeconds(line) {
  const match = line.trim().match(/(?:(\d+)h )?(?:(\d+)m )?(\d+)s$/);
  assert.ok(match, `no age at the end of ${JSON.stringify(line)}`);
  const [, h = 0, m = 0, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

test("the age grows between two readings: this is the heartbeat, not just the format", async () => {
  // The whole point of the field. A format test would pass on a line that never moves, and a line
  // that never moves is exactly the failure this issue exists for.
  const dir = tempProject(
    JSON.stringify({
      schema_version: 3,
      last_updated: new Date().toISOString(),
      issues: [issue("aaaaaaaa-0000-0000-0000-000000000000", { status: "in_progress" })],
    })
  );
  try {
    const first = ageSeconds(runIn(dir, ["--oneline"]).stdout);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = ageSeconds(runIn(dir, ["--oneline"]).stdout);
    assert.ok(second > first, `the line did not move: ${first}s then ${second}s`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
