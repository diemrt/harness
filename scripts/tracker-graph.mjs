// Pure graph computation over the tracker. Extracted from status-cli.mjs so that the readiness,
// cycle and chain answers the 1-WIP rule is written on live in one place: two copies of that rule
// would drift apart without anything saying so.
//
// Nothing here reads a file, writes a file, or renders anything. Every function takes issues and
// returns data — which is what lets the rule be proved with objects in memory instead of by
// reading a screen.

export function dependsOn(issue) {
  return Array.isArray(issue.depends_on) ? issue.depends_on : [];
}

export function indexById(issues) {
  return new Map(issues.map((issue) => [issue.id, issue]));
}

export function emptyCounts() {
  return { backlog: 0, in_progress: 0, in_review: 0, blocked: 0, done: 0 };
}

export function countByStatus(issues) {
  const counts = emptyCounts();
  for (const issue of issues) {
    if (Object.hasOwn(counts, issue.status)) {
      counts[issue.status] += 1;
    }
  }
  return counts;
}

export function shortId(id) {
  return String(id ?? "").slice(0, 8);
}

// A dangling id — one that matches no issue in the tracker — leaves the issue unworkable. It
// happens after a hand edit of issues.json, and after an archive that took away something still
// referenced. Either way we do not know what is missing, so we do not clear the issue for work.
export function danglingDeps(issue, byId) {
  return dependsOn(issue).filter((id) => !byId.has(id));
}

export function isWorkable(issue, byId) {
  if (issue.status !== "backlog") return false;
  const deps = dependsOn(issue);
  if (danglingDeps(issue, byId).length > 0) return false;
  return deps.every((id) => byId.get(id).status === "done");
}

// Depth-first search restricted to open issues. A cycle among closed ones is a fact of history:
// nothing is waiting on it any more, and reporting it every time would train the reader to skip
// the alert line.
export function findCycle(issues, byId) {
  const openIds = new Set(issues.filter((i) => i.status !== "done").map((i) => i.id));
  const state = new Map(); // id -> "visiting" | "settled"
  const stack = [];
  let cycle = null;

  function visit(id) {
    if (cycle || state.get(id) === "settled") return;
    if (state.get(id) === "visiting") {
      cycle = stack.slice(stack.indexOf(id));
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of dependsOn(byId.get(id))) {
      if (openIds.has(dep)) visit(dep);
    }
    stack.pop();
    state.set(id, "settled");
  }

  for (const id of openIds) visit(id);
  return cycle;
}

export function buildAlerts(issues, byId, counts, workableTotal) {
  const alerts = [];

  const cycle = findCycle(issues, byId);
  if (cycle) {
    alerts.push(`ciclo nei depends_on: ${cycle.map(shortId).join(" ")}`);
  }

  const broken = issues.filter((issue) => danglingDeps(issue, byId).length > 0);
  if (broken.length > 0) {
    const missing = [...new Set(broken.flatMap((issue) => danglingDeps(issue, byId)))]
      .map(shortId)
      .join(" ");
    const verb =
      broken.length === 1 ? "issue dipende da id inesistente" : "issue dipendono da id inesistenti";
    alerts.push(`${broken.length} ${verb}: ${missing}`);
  }

  // Deliberately NOT "lavorabili 0 di <n>". That reads two lines above "LAVORABILI · 0 di 0",
  // and the two "N di M" count different things — backlog here, workable there. Same shape, two
  // denominators, no way to tell them apart on screen. The alert gives up the shape instead.
  if (counts.backlog > 0 && workableTotal === 0) {
    alerts.push(`backlog fermo: ${counts.backlog} issue, nessuna lavorabile — tutte attendono qualcosa`);
  }

  return alerts;
}

// A chain is the connected component of the depends_on graph, walked in BOTH directions: SKILL.md
// defines it that way, because two issues joined by a path are the same chain no matter which of
// them declared the edge. A directed walk would split a chain in half and let two issues of the
// same chain look independent — which is exactly the mistake the 1-WIP rule exists to prevent.
//
// Only edges with both ends inside the given list are followed, so a caller can pass a filtered set
// — the open issues, say — and get the components of that set rather than of the whole tracker.
//
// Iteration follows the order of `issues`, not of a Map or a Set: the export built on top of this
// gets committed and diffed, and a group order that shifted between runs would produce a diff that
// means nothing.
export function chains(issues) {
  const ids = new Set(issues.map((issue) => issue.id));
  const neighbours = new Map(issues.map((issue) => [issue.id, new Set()]));

  for (const issue of issues) {
    for (const dep of dependsOn(issue)) {
      if (!ids.has(dep)) continue;
      neighbours.get(issue.id).add(dep);
      neighbours.get(dep).add(issue.id);
    }
  }

  const seen = new Set();
  const groups = [];

  for (const issue of issues) {
    if (seen.has(issue.id)) continue;
    const group = [];
    const queue = [issue.id];
    seen.add(issue.id);
    while (queue.length > 0) {
      const id = queue.shift();
      group.push(id);
      for (const next of neighbours.get(id)) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    groups.push(group);
  }

  return groups;
}
