// buildSnapshot and renderSnapshot are pure: they take issues in and give a snapshot or a string
// back. Everything worth getting wrong — what counts as workable, what a cycle is, how wide a row
// may be — is provable here with objects in memory. main() gets its own process-level tests.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSnapshot,
  renderSnapshot,
  STATUS_ICON,
  TIER_ICON,
  WIDTH,
  BAR_INNER,
  TITLE_MAX,
} from "../scripts/status-cli.mjs";

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
  const alert = snapshot.alerts.find((a) => a.startsWith("lavorabili 0"));
  assert.equal(alert, "lavorabili 0 di 2 — ogni issue in backlog attende qualcosa");
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

test("an in-flight row carries icon, short id, status word, tier and title", () => {
  const out = render([
    issue("aaaaaaaa-1111-2222-3333-444444444444", {
      status: "in_progress",
      tier: "standard",
      title: "vista albero delle catene",
    }),
  ]);
  const row = lines(out).find((l) => l.includes("vista albero"));
  assert.equal(row, "  + aaaaaaaa  in_progress  $$   vista albero delle catene");
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
  // The two "N di M" read differently on purpose, and the alert's trailing clause is what keeps
  // them apart: the alert counts workable issues out of the BACKLOG, the heading counts shown
  // rows out of the WORKABLE ones — which is zero here, hence "0 di 0".
  assert.ok(out.includes(" ! lavorabili 0 di 1 — ogni issue in backlog attende qualcosa"));
  assert.ok(out.includes(" LAVORABILI · 0 di 0"));
});
