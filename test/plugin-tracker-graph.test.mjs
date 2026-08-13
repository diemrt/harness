// tracker-graph.mjs holds the computation that used to live inside status-cli.mjs, extracted when
// a second consumer appeared. Everything here is pure: issues in, data out, no file and no
// rendering — which is what makes the 1-WIP rule provable with objects in memory instead of by
// reading a screen.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAlerts,
  chains,
  countByStatus,
  danglingDeps,
  dependsOn,
  emptyCounts,
  findCycle,
  indexById,
  isWorkable,
  shortId,
} from "../scripts/tracker-graph.mjs";

function issue(id, status = "backlog", deps = []) {
  return { id, title: `Issue ${id}`, status, depends_on: deps };
}

test("dependsOn reads a missing key as an empty list", () => {
  assert.deepEqual(dependsOn({ id: "a" }), []);
  assert.deepEqual(dependsOn({ id: "a", depends_on: ["b"] }), ["b"]);
});

test("emptyCounts covers every status, including the ones nothing is in", () => {
  assert.deepEqual(emptyCounts(), {
    backlog: 0,
    in_progress: 0,
    in_review: 0,
    blocked: 0,
    done: 0,
  });
});

test("countByStatus ignores a status it does not know", () => {
  const counts = countByStatus([
    issue("a", "backlog"),
    issue("b", "done"),
    issue("c", "invented"),
  ]);
  assert.equal(counts.backlog, 1);
  assert.equal(counts.done, 1);
  assert.equal(Object.hasOwn(counts, "invented"), false);
});

test("shortId cuts at eight characters and survives a missing id", () => {
  assert.equal(shortId("663a70ae-48ba-4e41-b48d-27af3dc7843b"), "663a70ae");
  assert.equal(shortId(null), "");
});

test("isWorkable wants backlog and every dependency closed", () => {
  const issues = [issue("a", "done"), issue("b", "backlog", ["a"]), issue("c", "backlog", ["b"])];
  const byId = indexById(issues);
  assert.equal(isWorkable(issues[1], byId), true, "its only dependency is done");
  assert.equal(isWorkable(issues[2], byId), false, "it waits on an open issue");
  assert.equal(isWorkable(issues[0], byId), false, "it is not in backlog");
});

test("a dependency that matches no issue blocks the work and gets reported", () => {
  const issues = [issue("b", "backlog", ["ghost"])];
  const byId = indexById(issues);
  assert.deepEqual(danglingDeps(issues[0], byId), ["ghost"]);
  assert.equal(isWorkable(issues[0], byId), false);
});

test("findCycle sees a cycle among open issues and ignores one among closed ones", () => {
  const open = [issue("a", "backlog", ["b"]), issue("b", "backlog", ["a"])];
  assert.notEqual(findCycle(open, indexById(open)), null);

  const closed = [issue("a", "done", ["b"]), issue("b", "done", ["a"])];
  assert.equal(findCycle(closed, indexById(closed)), null, "history is not an alert");
});

test("buildAlerts reports a stalled backlog", () => {
  const issues = [issue("a", "in_progress"), issue("b", "backlog", ["a"])];
  const byId = indexById(issues);
  const alerts = buildAlerts(issues, byId, countByStatus(issues), 0);
  assert.equal(
    alerts.some((alert) => alert.includes("backlog fermo")),
    true
  );
});

test("buildAlerts names the missing ids, not just their number", () => {
  const issues = [issue("b", "backlog", ["ghost123-aaaa"])];
  const byId = indexById(issues);
  const alerts = buildAlerts(issues, byId, countByStatus(issues), 0);
  assert.equal(
    alerts.some((alert) => alert.includes("ghost123")),
    true
  );
});

// A chain is what the 1-WIP rule is written around, and the rule says two issues joined by a path
// are the same chain no matter which of them declared the edge. That is the whole reason these
// tests assert on direction: a directed walk would split a chain in half and let two issues of the
// same chain look independent.
test("chains groups the connected issues, whichever way the edge points", () => {
  const issues = [
    issue("a"),
    issue("b", "backlog", ["a"]),
    issue("c"),
    issue("d", "backlog", ["c"]),
    issue("e"),
  ];
  assert.deepEqual(chains(issues), [["a", "b"], ["c", "d"], ["e"]]);
});

test("chains walks a path of three, not just the direct neighbours", () => {
  const issues = [issue("a"), issue("b", "backlog", ["a"]), issue("c", "backlog", ["b"])];
  assert.deepEqual(chains(issues), [["a", "b", "c"]]);
});

test("chains ignores edges that leave the given set", () => {
  const issues = [issue("b", "backlog", ["fuori"]), issue("c")];
  assert.deepEqual(chains(issues), [["b"], ["c"]]);
});

test("chains is deterministic: the export gets diffed", () => {
  const issues = [issue("a"), issue("b", "backlog", ["a"])];
  assert.deepEqual(chains(issues), chains(issues));
});

test("chains on an empty list is an empty list", () => {
  assert.deepEqual(chains([]), []);
});
