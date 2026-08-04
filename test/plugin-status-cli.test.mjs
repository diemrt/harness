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
