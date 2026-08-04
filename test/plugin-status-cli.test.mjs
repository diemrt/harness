// buildSnapshot and renderSnapshot are pure: they take issues in and give a snapshot or a string
// back. Everything worth getting wrong — what counts as workable, what a cycle is, how wide a row
// may be — is provable here with objects in memory. main() gets its own process-level tests.

import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, STATUS_ICON, TIER_ICON } from "../scripts/status-cli.mjs";

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
