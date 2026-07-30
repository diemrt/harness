// The graph view's promise is that it never loses a dependency: every edge either lands on a node
// or on a ghost that says why the node is missing, and a file someone edited by hand into a cycle
// still produces a layout instead of hanging the page. That is what this file checks — the layout
// itself, imported for real, not carved out of an HTML string.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildGraph, chainOf, GHOST_DONE, GHOST_UNKNOWN } from "../scripts/board-graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const GRAPH_PATH = path.join(rootDir, "scripts", "board-graph.mjs");

// Ids are letters instead of GUIDs: nothing here validates the format, and a test about who
// depends on whom is unreadable with thirty-six characters per node.
function issue(id, overrides = {}) {
  return {
    id,
    title: `Issue ${id}`,
    description: "description",
    status: "backlog",
    tier: null,
    depends_on: [],
    validation: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const ids = (nodes) => nodes.map((node) => node.id);
const levelOf = (graph, id) => graph.byId.get(id).level;

// --- The module is a module: importable, pure, and blind to the browser ------------------------

test("board-graph.mjs is importable from node and never reaches for the browser", () => {
  // The import at the top of this file is the proof it loads under node --test; these are the
  // exports the page is allowed to rely on.
  assert.equal(typeof buildGraph, "function");
  assert.equal(typeof chainOf, "function");

  const source = readFileSync(GRAPH_PATH, "utf8");
  assert.doesNotMatch(source, /\bdocument\b/);
  assert.doesNotMatch(source, /\bwindow\b/);
});

test("buildGraph does not touch the array it was given and answers the same twice", () => {
  const issues = [
    issue("a"),
    issue("b", { depends_on: ["a"] }),
    issue("c", { status: "done" }),
  ];
  const snapshot = structuredClone(issues);

  const first = buildGraph(issues);
  const second = buildGraph(issues);

  assert.deepEqual(issues, snapshot);
  assert.deepEqual(ids(first.levels[0]), ids(second.levels[0]));
  assert.deepEqual(first.edges, second.edges);
});

test("buildGraph survives a tracker that was written by something other than the CLI", () => {
  const graph = buildGraph({ not: "an array" });
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.levels, []);
  assert.deepEqual(graph.unchained, []);
  assert.equal(graph.cycle.detected, false);

  const junk = buildGraph([
    null,
    "string",
    { id: 42 },
    issue("a", { depends_on: "b" }),
    issue("a", { title: "duplicate id" }),
    issue("b", { depends_on: [null, "", "a", "a"] }),
  ]);
  assert.deepEqual(ids(junk.nodes).sort(), ["a", "b"]);
  assert.deepEqual(junk.edges, [{ from: "a", to: "b" }]);
});

// --- Levels ------------------------------------------------------------------------------------

test("a node with no visible dependency sits at level 0, the others at max(dep) + 1", () => {
  const graph = buildGraph([
    issue("root"),
    issue("mid", { depends_on: ["root"] }),
    issue("leaf", { depends_on: ["mid"] }),
    issue("other"),
    issue("late", { depends_on: ["other"] }),
  ]);

  assert.equal(levelOf(graph, "root"), 0);
  assert.equal(levelOf(graph, "mid"), 1);
  assert.equal(levelOf(graph, "leaf"), 2);
  assert.equal(levelOf(graph, "other"), 0);
  assert.equal(levelOf(graph, "late"), 1);
  assert.equal(graph.levels.length, 3);
  assert.deepEqual(ids(graph.levels[2]), ["leaf"]);
});

test("levels are the longest path, so a shortcut edge does not pull a node back up", () => {
  // leaf depends on root directly and through mid: the long way wins, or the edge from mid would
  // have to travel backwards.
  const graph = buildGraph([
    issue("root"),
    issue("mid", { depends_on: ["root"] }),
    issue("leaf", { depends_on: ["root", "mid"] }),
  ]);

  assert.equal(levelOf(graph, "leaf"), 2);
});

test("an edge runs from the dependency to the issue that declares it", () => {
  const graph = buildGraph([issue("a"), issue("b", { depends_on: ["a"] })]);
  assert.deepEqual(graph.edges, [{ from: "a", to: "b" }]);
  assert.deepEqual(graph.byId.get("a").dependents, ["b"]);
  assert.deepEqual(graph.byId.get("b").dependsOn, ["a"]);
});

// --- Ghosts ------------------------------------------------------------------------------------

test("a done issue is not a node, but a done dependency comes back as a ghost", () => {
  const graph = buildGraph([
    issue("closed", { status: "done" }),
    issue("elsewhere", { status: "done" }),
    issue("open", { depends_on: ["closed"] }),
  ]);

  // `elsewhere` is closed and nobody points at it: it stays out of the graph entirely.
  assert.deepEqual(ids(graph.nodes).sort(), ["closed", "open"]);
  assert.equal(graph.byId.has("elsewhere"), false);

  const ghost = graph.byId.get("closed");
  assert.equal(ghost.ghost, GHOST_DONE);
  assert.equal(ghost.issue.status, "done");
  assert.equal(ghost.level, 0);

  // The ghost is what keeps the arrow from starting nowhere: the open issue is one level down.
  assert.equal(levelOf(graph, "open"), 1);
  assert.deepEqual(graph.edges, [{ from: "closed", to: "open" }]);

  // A node still open is never a ghost.
  assert.equal(graph.byId.get("open").ghost, null);
});

test("a depends_on pointing at an id nobody knows comes back as an unknown ghost", () => {
  const graph = buildGraph([issue("open", { depends_on: ["vanished"] })]);

  const ghost = graph.byId.get("vanished");
  assert.ok(ghost, "the dependency must not be dropped in silence");
  assert.equal(ghost.ghost, GHOST_UNKNOWN);
  assert.equal(ghost.issue, null);
  assert.equal(ghost.level, 0);
  assert.deepEqual(graph.edges, [{ from: "vanished", to: "open" }]);
  assert.equal(levelOf(graph, "open"), 1);
});

test("the two kinds of ghost stay told apart, and a ghost is never counted as unchained", () => {
  const graph = buildGraph([
    issue("closed", { status: "done" }),
    issue("open", { depends_on: ["closed", "vanished"] }),
  ]);

  assert.equal(graph.byId.get("closed").ghost, GHOST_DONE);
  assert.equal(graph.byId.get("vanished").ghost, GHOST_UNKNOWN);
  assert.deepEqual(graph.unchained, []);
  assert.deepEqual(ids(graph.levels[0]).sort(), ["closed", "vanished"]);
});

// --- Unchained ---------------------------------------------------------------------------------

test("issues with neither dependencies nor dependents are a group of their own, not level 0", () => {
  const graph = buildGraph([
    issue("alone"),
    issue("root"),
    issue("child", { depends_on: ["root"] }),
    issue("also-alone"),
  ]);

  assert.deepEqual(ids(graph.unchained), ["alone", "also-alone"]);
  assert.deepEqual(ids(graph.levels[0]), ["root"]);
  assert.equal(graph.byId.get("alone").unchained, true);
  assert.equal(graph.byId.get("alone").level, null, "an unchained node has no level to draw");
  assert.equal(graph.byId.get("root").unchained, false);

  // On a tracker where nothing declares a dependency the whole board is unchained, and levels
  // stay empty instead of becoming one endless column.
  const flat = buildGraph([issue("a"), issue("b"), issue("c")]);
  assert.deepEqual(ids(flat.unchained), ["a", "b", "c"]);
  assert.deepEqual(flat.levels, []);
});

test("a dependency that only closed issues point at leaves the target unchained", () => {
  // The edge exists in the file, but neither end of it is drawn: the done issue is not a node, so
  // `open` has nothing attached to it.
  const graph = buildGraph([
    issue("open"),
    issue("closed", { status: "done", depends_on: ["open"] }),
  ]);

  assert.deepEqual(ids(graph.unchained), ["open"]);
  assert.deepEqual(graph.edges, []);
});

// --- Ordering ----------------------------------------------------------------------------------

test("two barycenter passes untangle the crossings, with the array index breaking ties", () => {
  // By array order level 1 would be [x, y, z] while their dependencies sit at [a, b, c]: x lands
  // over c and y over a, so the edges cross. The downward pass pulls each node over its own
  // dependency.
  const graph = buildGraph([
    issue("a"),
    issue("b"),
    issue("c"),
    issue("x", { depends_on: ["c"] }),
    issue("y", { depends_on: ["a"] }),
    issue("z", { depends_on: ["b"] }),
  ]);

  assert.deepEqual(ids(graph.levels[0]), ["a", "b", "c"]);
  assert.deepEqual(ids(graph.levels[1]), ["y", "z", "x"]);
  assert.deepEqual(graph.levels[1].map((node) => node.order), [0, 1, 2]);
});

test("nodes with nothing to follow keep the order of the array", () => {
  const graph = buildGraph([
    issue("second"),
    issue("first"),
    issue("child", { depends_on: ["second", "first"] }),
  ]);

  assert.deepEqual(ids(graph.levels[0]), ["second", "first"]);
  assert.deepEqual(ids(graph.unchained), []);
});

// --- Cycles ------------------------------------------------------------------------------------

test("a cycle hand-edited into the file is reported, not followed", { timeout: 5000 }, () => {
  const graph = buildGraph([
    issue("a", { depends_on: ["c"] }),
    issue("b", { depends_on: ["a"] }),
    issue("c", { depends_on: ["b"] }),
    issue("outside", { depends_on: ["a"] }),
  ]);

  assert.equal(graph.cycle.detected, true);
  assert.deepEqual([...graph.cycle.ids].sort(), ["a", "b", "c"]);
  assert.ok(graph.cycle.paths.length > 0, "the loop it walked into must be reported too");
  assert.equal(graph.cycle.ids.includes("outside"), false, "only the loop is reported, not its neighbours");

  // Everything still gets a level: the view degrades, it does not disappear.
  for (const id of ["a", "b", "c", "outside"]) {
    assert.equal(typeof levelOf(graph, id), "number");
  }
});

test("a self-dependency is a cycle of one and terminates", { timeout: 5000 }, () => {
  const graph = buildGraph([issue("self", { depends_on: ["self"] })]);

  assert.equal(graph.cycle.detected, true);
  assert.deepEqual(graph.cycle.ids, ["self"]);
  assert.equal(levelOf(graph, "self"), 0);
});

test("a clean graph reports no cycle, and a long chain does not blow the stack", { timeout: 5000 }, () => {
  const clean = buildGraph([issue("a"), issue("b", { depends_on: ["a"] })]);
  assert.equal(clean.cycle.detected, false);
  assert.deepEqual(clean.cycle.ids, []);

  const long = [issue("n0")];
  for (let i = 1; i < 5000; i += 1) {
    long.push(issue(`n${i}`, { depends_on: [`n${i - 1}`] }));
  }
  const deep = buildGraph(long);
  assert.equal(deep.cycle.detected, false);
  assert.equal(levelOf(deep, "n4999"), 4999);
});

// --- Chain (what the chain lens keeps lit) -----------------------------------------------------

test("the chain of a node is its ancestors plus its descendants", () => {
  const graph = buildGraph([
    issue("root"),
    issue("mid", { depends_on: ["root"] }),
    issue("leaf", { depends_on: ["mid"] }),
    issue("sibling", { depends_on: ["root"] }),
    issue("stranger"),
  ]);

  const chain = chainOf(graph, "mid");
  assert.deepEqual(chain.ancestors, ["root"]);
  assert.deepEqual(chain.descendants, ["leaf"]);
  assert.deepEqual([...chain.ids].sort(), ["leaf", "mid", "root"]);

  // From the root the whole fan is in the chain; the stranger never is.
  const fromRoot = chainOf(graph, "root");
  assert.deepEqual([...fromRoot.ids].sort(), ["leaf", "mid", "root", "sibling"]);
  assert.equal(fromRoot.ids.includes("stranger"), false);
});

test("the chain reaches ghosts, survives a cycle, and answers empty for an unknown id", { timeout: 5000 }, () => {
  const graph = buildGraph([
    issue("closed", { status: "done" }),
    issue("open", { depends_on: ["closed", "vanished"] }),
  ]);
  assert.deepEqual(chainOf(graph, "open").ancestors.sort(), ["closed", "vanished"]);
  assert.deepEqual(chainOf(graph, "nowhere"), { ancestors: [], descendants: [], ids: [] });

  const looped = buildGraph([
    issue("a", { depends_on: ["b"] }),
    issue("b", { depends_on: ["a"] }),
  ]);
  const chain = chainOf(looped, "a");
  assert.deepEqual(chain.ancestors, ["b"]);
  assert.deepEqual(chain.descendants, ["b"]);
  assert.deepEqual([...chain.ids].sort(), ["a", "b"]);
});
