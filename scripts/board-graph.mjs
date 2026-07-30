// Layering of the issue DAG for the board's graph view: pure math, no rendering.
//
// This module never touches the page — no DOM, no browser globals, no fetch — so the same code
// the browser runs is importable from `node --test` and verified for what it computes instead of
// for how it looks. `board.js` is the app (fetch, SSE, render, events); this is the geometry it
// asks for.
//
// What it computes, from the array of issues exactly as `api/issues` hands it over:
//   - nodes:     the issues with status !== "done". The graph answers "what do I work on now",
//                and on a live tracker the closed issues are the majority: including them would
//                turn the view into an endless column.
//   - ghosts:    a dependency of a visible node that is already done, or an id that is not in the
//                tracker at all. It enters as a compact node marked GHOST_DONE / GHOST_UNKNOWN
//                rather than being dropped, because an edge that silently disappears is worse
//                than an ugly edge.
//   - level:     longest-path. 0 with no visible dependencies, otherwise max(level(dep)) + 1.
//   - order:     position inside the level, from two barycenter passes (down, then up) with the
//                original array index as tie-break — the same order the WIP list already uses.
//   - unchained: the issues with neither dependencies nor dependents. They are not a column:
//                they are a separate group, kept distinct from level 0, which on a tracker where
//                nothing declares a dependency is the difference between a grid and one endless
//                column.
//   - cycle:     issues.json is a file, and it can be hand-edited past the CLI's refusal. Every
//                walk here keeps a visited set, terminates, and reports the ids it found looping
//                instead of recursing forever.
//
// Nothing in the input is trusted: a missing array, a non-object entry, an id that is not a
// string, a duplicated id, a `depends_on` that is not an array or holds junk — all of it is
// normalized away rather than thrown at the caller, because the board's job is to show the
// tracker it was given, not to refuse it.
//
// The input is never mutated: nodes are new objects that only keep a reference to their issue.

const DONE_STATUS = "done";

// A ghost is a node the graph draws but cannot let you work on. The two kinds are told apart
// because the page says different things about them: a dependency already closed, or an id that
// nothing in the tracker answers for.
export const GHOST_DONE = "done";
export const GHOST_UNKNOWN = "unknown";

function isFilledString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// The declared dependencies of an issue, reduced to usable ids: junk entries and repetitions are
// dropped, order is preserved. A self-reference is deliberately kept — the CLI rejects it, so its
// presence means the file was edited by hand, and the cycle guard is the one that must say so.
function readDependsOn(issue) {
  if (!Array.isArray(issue.depends_on)) {
    return [];
  }
  const seen = new Set();
  const ids = [];
  for (const entry of issue.depends_on) {
    if (!isFilledString(entry) || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    ids.push(entry);
  }
  return ids;
}

// The issues that can be talked about at all, in array order: an entry without a usable id cannot
// be a node and cannot be pointed at, and a repeated id would give two nodes the same name, so
// the first occurrence wins.
function readIssues(issues) {
  const list = Array.isArray(issues) ? issues : [];
  const byId = new Map();
  const records = [];
  list.forEach((issue, index) => {
    if (issue === null || typeof issue !== "object" || Array.isArray(issue)) {
      return;
    }
    if (!isFilledString(issue.id) || byId.has(issue.id)) {
      return;
    }
    const record = {
      id: issue.id,
      issue,
      index,
      done: issue.status === DONE_STATUS,
      dependsOn: readDependsOn(issue),
    };
    byId.set(issue.id, record);
    records.push(record);
  });
  return { records, byId, size: list.length };
}

function makeNode(id, issue, ghost, index) {
  return {
    id,
    issue,
    ghost,
    index,
    unchained: false,
    level: null,
    order: 0,
    dependsOn: [],
    dependents: [],
  };
}

// Longest-path levels, iterative on purpose: an explicit stack cannot blow the call stack on a
// long chain, and the three-colour marking makes a back edge visible instead of endless. A back
// edge is recorded and then ignored, so the walk always terminates and the rest of the graph
// still gets the levels it deserves.
function assignLevels(nodes, byId) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const colour = new Map(nodes.map((node) => [node.id, WHITE]));
  const cycleIds = new Set();
  const cyclePaths = [];

  for (const root of nodes) {
    if (colour.get(root.id) !== WHITE) {
      continue;
    }
    colour.set(root.id, GRAY);
    const stack = [{ node: root, next: 0, best: 0, pending: null }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];

      // A dependency just finished: its level is final and this node must clear it.
      if (frame.pending !== null) {
        const child = byId.get(frame.pending);
        frame.pending = null;
        if (child && typeof child.level === "number") {
          frame.best = Math.max(frame.best, child.level + 1);
        }
      }

      if (frame.next < frame.node.dependsOn.length) {
        const depId = frame.node.dependsOn[frame.next];
        frame.next += 1;
        const dep = byId.get(depId);
        if (!dep) {
          continue;
        }
        const state = colour.get(depId);
        if (state === GRAY) {
          // Back edge: the dependency is still open on this stack, so following it would loop.
          const start = stack.findIndex((entry) => entry.node.id === depId);
          const path = start === -1 ? [depId] : stack.slice(start).map((entry) => entry.node.id);
          cyclePaths.push(path);
          for (const id of path) {
            cycleIds.add(id);
          }
          continue;
        }
        if (state === BLACK) {
          frame.best = Math.max(frame.best, dep.level + 1);
          continue;
        }
        colour.set(depId, GRAY);
        frame.pending = depId;
        stack.push({ node: dep, next: 0, best: 0, pending: null });
        continue;
      }

      frame.node.level = frame.best;
      colour.set(frame.node.id, BLACK);
      stack.pop();
    }
  }

  return { detected: cycleIds.size > 0, ids: [...cycleIds], paths: cyclePaths };
}

function writeOrder(level) {
  level.forEach((node, position) => {
    node.order = position;
  });
}

// One barycenter pass over a level: each node moves to the average position of its neighbours in
// the level already placed, and a node without neighbours stays where it is. The original array
// index breaks every tie, so the result is stable and reproducible run after run.
function barycenterPass(level, neighbourKey, byId) {
  const barycentre = new Map();
  for (const node of level) {
    let total = 0;
    let count = 0;
    for (const neighbourId of node[neighbourKey]) {
      const neighbour = byId.get(neighbourId);
      if (!neighbour || neighbour.level === null) {
        continue;
      }
      total += neighbour.order;
      count += 1;
    }
    barycentre.set(node.id, count === 0 ? node.order : total / count);
  }
  level.sort((a, b) => {
    const delta = barycentre.get(a.id) - barycentre.get(b.id);
    return delta !== 0 ? delta : a.index - b.index;
  });
  writeOrder(level);
}

// Two passes, as designed: downward a node follows its dependencies, upward a dependency follows
// its dependents. More passes would keep shaving off crossings for a layout nobody reads that
// closely; two is where the graph stops looking tangled.
function orderLevels(levels, byId) {
  for (const level of levels) {
    level.sort((a, b) => a.index - b.index);
    writeOrder(level);
  }
  for (let depth = 1; depth < levels.length; depth += 1) {
    barycenterPass(levels[depth], "dependsOn", byId);
  }
  for (let depth = levels.length - 2; depth >= 0; depth -= 1) {
    barycenterPass(levels[depth], "dependents", byId);
  }
}

/**
 * Builds the graph the board draws from the issues of the tracker.
 *
 * @param {unknown} issues the `issues` array of the payload, whatever shape it arrived in
 * @returns {{
 *   nodes: object[],            every node, real and ghost
 *   byId: Map<string, object>,  the same nodes, by id
 *   levels: object[][],         chained nodes, levels[depth] ordered left to right
 *   unchained: object[],        nodes with neither dependencies nor dependents
 *   edges: {from: string, to: string}[],  from the dependency to the issue that declares it
 *   cycle: {detected: boolean, ids: string[], paths: string[][]}
 * }}
 */
export function buildGraph(issues) {
  const { records, byId: recordById, size } = readIssues(issues);

  const byId = new Map();
  const nodes = [];
  const addNode = (node) => {
    byId.set(node.id, node);
    nodes.push(node);
    return node;
  };

  // Real nodes first: everything still open, in tracker order.
  for (const record of records) {
    if (record.done) {
      continue;
    }
    addNode(makeNode(record.id, record.issue, null, record.index));
  }

  // Then the ghosts, which exist only because a visible node points at them. An unknown id has no
  // place in the array, so it is indexed after everything real: it sorts last on ties instead of
  // jumping the queue.
  let unknownSeen = 0;
  for (const record of records) {
    if (record.done) {
      continue;
    }
    for (const depId of record.dependsOn) {
      if (byId.has(depId)) {
        continue;
      }
      const dependency = recordById.get(depId);
      if (dependency) {
        addNode(makeNode(depId, dependency.issue, GHOST_DONE, dependency.index));
      } else {
        addNode(makeNode(depId, null, GHOST_UNKNOWN, size + unknownSeen));
        unknownSeen += 1;
      }
    }
  }

  // Edges, and with them the adjacency each node carries around.
  const edges = [];
  for (const record of records) {
    if (record.done) {
      continue;
    }
    const node = byId.get(record.id);
    for (const depId of record.dependsOn) {
      const dependency = byId.get(depId);
      if (!dependency) {
        continue;
      }
      node.dependsOn.push(depId);
      dependency.dependents.push(record.id);
      edges.push({ from: depId, to: record.id });
    }
  }

  // Neither dependencies nor dependents: nothing to draw an edge to, so no column. A ghost is
  // never here — it was born from an edge.
  const chained = [];
  const unchained = [];
  for (const node of nodes) {
    if (node.ghost === null && node.dependsOn.length === 0 && node.dependents.length === 0) {
      node.unchained = true;
      unchained.push(node);
    } else {
      chained.push(node);
    }
  }
  unchained.sort((a, b) => a.index - b.index);
  writeOrder(unchained);

  const cycle = assignLevels(chained, byId);

  const depth = chained.reduce((max, node) => Math.max(max, node.level), -1);
  const levels = Array.from({ length: depth + 1 }, () => []);
  for (const node of chained) {
    levels[node.level].push(node);
  }
  orderLevels(levels, byId);

  return { nodes, byId, levels, unchained, edges, cycle };
}

// Walks one direction of the graph from a node. The visited set is what makes this safe on a
// hand-edited file: a cycle is walked once and then closed, never followed twice.
function walk(graph, startId, key) {
  const seen = new Set([startId]);
  const reached = [];
  const queue = [startId];
  while (queue.length > 0) {
    const node = graph.byId.get(queue.shift());
    if (!node) {
      continue;
    }
    for (const nextId of node[key]) {
      if (seen.has(nextId)) {
        continue;
      }
      seen.add(nextId);
      reached.push(nextId);
      queue.push(nextId);
    }
  }
  return reached;
}

/**
 * The chain of a node: everything it waits for and everything that waits for it. This is what the
 * chain lens keeps lit while the rest of the board fades — the 1-WIP rule made visible.
 *
 * @param {object} graph the value returned by `buildGraph`
 * @param {string} id the node the chain starts from
 * @returns {{ancestors: string[], descendants: string[], ids: string[]}} empty for an unknown id
 */
export function chainOf(graph, id) {
  if (!graph || !(graph.byId instanceof Map) || !graph.byId.has(id)) {
    return { ancestors: [], descendants: [], ids: [] };
  }
  const ancestors = walk(graph, id, "dependsOn");
  const descendants = walk(graph, id, "dependents");
  return { ancestors, descendants, ids: [...new Set([id, ...ancestors, ...descendants])] };
}
