// Turns the graph board-graph.mjs computes into text. Pure on purpose: it never reads the
// environment, never touches a file and never writes anywhere — it takes data and options and
// returns a string. That is what makes a change to the way the board looks a matter of one
// assert.match instead of a browser, a server and a port.
//
// The chain view is an indented tree: one branch per connected component of the depends_on graph,
// plus a group for the issues that neither depend on anything nor are depended upon. The card view
// is the opposite trade: few issues, all of every field, nothing truncated.

import { GHOST_UNKNOWN } from "./board-graph.mjs";

// The statuses of an issue somebody is holding. The chain view does not use them; the watch does,
// to decide which cards deserve the room next to the tree.
export const IN_FLIGHT = ["in_progress", "in_review", "blocked"];

export function SEP(width) {
  return "─".repeat(Math.max(10, width));
}

export function shortId(id) {
  return String(id || "").slice(0, 8);
}

// The palette of the visual spec (§8) translated to ANSI 256, which Windows Terminal and every
// modern terminal support without negotiation: backlog grey, in_progress coral, in_review violet,
// blocked red, done green.
export const STATUS_COLOR = {
  backlog: 245,
  in_progress: 209,
  in_review: 104,
  blocked: 167,
  done: 107,
};

// Not statuses: the shades the layout uses. Ids and section labels step back so the titles stand
// out, and the workable flag borrows the coral of the issue somebody is holding.
const EXTRA_COLOR = { id: 245, label: 245, flag: 209 };

/**
 * Wraps a piece of text in an ANSI 256 sequence, or hands it back untouched.
 *
 * Colour is decoration and never a carrier: every status this paints is spelled out in letters
 * under the escape, so a pipe, a `NO_COLOR` or a terminal from 1985 lose nothing. Which is also
 * why the decision is not taken here — the caller passes it, and this module stays pure.
 *
 * `colors` has to be exactly `true`. Emitting escapes by mistake is the direction that does the
 * damage — control bytes in a file nobody asked to colour — so anything else counts as off.
 *
 * @param {string} text
 * @param {string} key a status of the tracker, or one of the layout shades
 * @param {boolean} colors
 * @returns {string}
 */
export function paint(text, key, colors) {
  if (colors !== true || text === "") {
    return text;
  }
  const code = STATUS_COLOR[key] ?? EXTRA_COLOR[key];
  if (typeof code !== "number") {
    return text;
  }
  return `\u001b[38;5;${code}m${text}\u001b[0m`;
}

// Everything reachable from a node when the edges are walked in both directions at once. This is
// NOT what chainOf() returns: that one climbs dependsOn and descends dependents, so two siblings
// of one dependency — or anything reachable only by alternating up and down — land in disjoint
// sets. Using it here split one component into pieces, and a node sitting in more than one piece
// was drawn once per piece: on the real tracker the issue that added this view appeared twice.
function reach(graph, startId) {
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const node = graph.byId.get(queue.shift());
    if (!node) {
      continue;
    }
    for (const id of [...node.dependsOn, ...node.dependents]) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      queue.push(id);
    }
  }
  return [...seen];
}

// The connected components of the depends_on graph: the chains the 1-WIP rule talks about, and
// SKILL.md defines them exactly this way — two issues are in the same chain when a path of
// dependencies joins them, in one direction or the other.
export function components(graph) {
  const seen = new Set();
  const found = [];
  for (const node of graph.nodes) {
    if (node.unchained || seen.has(node.id)) {
      continue;
    }
    const ids = reach(graph, node.id);
    for (const id of ids) {
      seen.add(id);
    }
    const nodes = ids.map((id) => graph.byId.get(id)).filter(Boolean);
    // A chain has no name: it is a fact of the graph and no field of the tracker baptises it.
    // Its root is the lowest level, ties broken by the order board-graph already produced.
    const root = [...nodes].sort(
      (a, b) => (a.level ?? 0) - (b.level ?? 0) || a.index - b.index
    )[0];
    found.push({ root, nodes });
  }
  return found.sort((a, b) => a.root.index - b.root.index);
}

// Every node hangs off exactly one parent: the dependency with the highest level, ties broken by
// index. level(parent) is always strictly lower than level(child) — the cycle case never reaches
// here — so this can never loop, and every issue occupies one line: the line count is the issue
// count, not the edge count.
function parentOf(node, graph) {
  let best = null;
  for (const depId of node.dependsOn) {
    const dep = graph.byId.get(depId);
    if (!dep) {
      continue;
    }
    const depLevel = dep.level ?? 0;
    const bestLevel = best ? best.level ?? 0 : -1;
    if (!best || depLevel > bestLevel || (depLevel === bestLevel && dep.index < best.index)) {
      best = dep;
    }
  }
  return best;
}

// Workable means every dependency is already closed. A ghost is a dependency the graph kept
// visible precisely because it is no longer a node of its own: closed, or an id nothing in the
// tracker answers for.
function isWorkable(node, graph) {
  if (node.ghost) {
    return false;
  }
  return node.dependsOn.every((id) => {
    const dep = graph.byId.get(id);
    return !dep || dep.ghost !== null;
  });
}

// One issue, one line: marker, short id, title, and on the right what the reader decides with —
// the tier and whether the issue can be picked up. The gap is padding, never information: with a
// narrow terminal it collapses to two spaces and the line simply runs long.
//
// The status does not appear here, so no colour of the palette does either: painting the marker by
// status would make the tree say something it does not write down, and a reader without colour
// would be reading a different board. Here colour only steps the ids and the labels back.
function nodeLine(node, graph, prefix, width, colors) {
  const id = shortId(node.id);
  if (node.ghost) {
    const label = node.ghost === GHOST_UNKNOWN ? "id sconosciuto" : node.issue.title;
    return `${prefix}✓ ${paint(id, "id", colors)}  ${paint(label, "label", colors)}`;
  }
  const tier = node.issue.tier || "standard";
  const flag = isWorkable(node, graph) ? "► lavorabile" : "";
  // Measured plain, painted afterwards. An escape sequence is zero columns wide on screen and a
  // dozen characters to `.length`: colouring before this subtraction would eat the padding and
  // move the right-hand column, and only when the colour is on.
  const left = `${prefix}○ ${id}  ${node.issue.title}`;
  const right = `[${tier}]${flag ? `  ${flag}` : ""}`;
  const gap = Math.max(2, width - left.length - right.length);
  const leftOut = `${prefix}○ ${paint(id, "id", colors)}  ${node.issue.title}`;
  const rightOut = `${paint(`[${tier}]`, "label", colors)}${
    flag ? `  ${paint(flag, "flag", colors)}` : ""
  }`;
  return `${leftOut}${" ".repeat(gap)}${rightOut}`;
}

function renderComponent(component, graph, width, colors) {
  const title = `catena · ${shortId(component.root.id)} `;
  // The rule is measured on the plain title, then title and rule are dimmed as one label.
  const lines = [paint(`${title}${SEP(width - title.length)}`, "label", colors)];

  const children = new Map();
  const roots = [];
  for (const node of component.nodes) {
    const parent = parentOf(node, graph);
    if (!parent) {
      roots.push(node);
      continue;
    }
    if (!children.has(parent.id)) {
      children.set(parent.id, []);
    }
    children.get(parent.id).push(node);
  }

  const walk = (node, depth) => {
    const prefix = depth === 0 ? "  " : `  ${"   ".repeat(depth - 1)}└─ `;
    lines.push(nodeLine(node, graph, prefix, width, colors));
    // A DAG is not a tree: a node that waits for more than one issue hangs off the deepest of
    // them and says out loud what else it is waiting for, instead of being drawn once per edge.
    // The line is indented past its own marker, never merely past its parent: at any depth below
    // the first the two differ, and an `attende` sitting to the left of the issue it belongs to
    // reads as if an ancestor had said it.
    if (node.dependsOn.length > 1) {
      const under = " ".repeat(prefix.length + 2);
      const waits = `attende ${node.dependsOn.map(shortId).join(" ")}`;
      lines.push(`${under}${paint(waits, "label", colors)}`);
    }
    for (const child of (children.get(node.id) ?? []).sort((a, b) => a.order - b.order)) {
      walk(child, depth + 1);
    }
  };
  for (const root of roots.sort((a, b) => a.order - b.order)) {
    walk(root, 0);
  }
  return lines.join("\n");
}

/**
 * The chain view: one block per connected component, plus the issues that declare no dependency
 * and that none declares.
 *
 * @param {object} options
 * @param {object} options.graph the value returned by `buildGraph`
 * @param {string} options.project the name shown in the header
 * @param {string} options.branch the branch shown on the right of the header
 * @param {{open: number, done: number}} options.counts the whole tracker, closed issues included
 * @param {number} [options.width] the columns to lay the text out on
 * @param {boolean} [options.colors] whether to emit ANSI 256 escapes — the caller decides
 * @returns {string}
 */
export function renderChains({ graph, project, branch, counts, width = 100, colors = false }) {
  const head = `${project} · ${counts.open} aperte · ${counts.done} chiuse`;
  const branchLabel = branch || "";
  const gap = Math.max(2, width - head.length - branchLabel.length);
  const blocks = [`${head}${" ".repeat(gap)}${paint(branchLabel, "label", colors)}`, ""];

  // A cycle is only reachable by hand-editing issues.json past the CLI's refusal, and with one
  // there is no tree to draw: naming the issues involved and falling back to the flat list says
  // more than an arbitrary tree cut somewhere along the loop.
  if (graph.cycle && graph.cycle.detected) {
    blocks.push("⚠ ciclo nelle dipendenze: l'albero non si disegna.");
    blocks.push(`  issue coinvolte: ${graph.cycle.ids.map(shortId).join(" ")}`);
    blocks.push("");
    for (const node of graph.nodes) {
      if (!node.ghost) {
        blocks.push(nodeLine(node, graph, "  ", width, colors));
      }
    }
    return blocks.join("\n");
  }

  const chains = components(graph);
  for (const component of chains) {
    blocks.push(renderComponent(component, graph, width, colors), "");
  }

  if (graph.unchained.length > 0) {
    const title = "senza catena ";
    blocks.push(paint(`${title}${SEP(width - title.length)}`, "label", colors));
    for (const node of graph.unchained) {
      blocks.push(nodeLine(node, graph, "  ", width, colors));
    }
    blocks.push("");
  }

  if (chains.length === 0 && graph.unchained.length === 0) {
    blocks.push("Nessuna issue aperta: il tracker non ha niente da mostrare.");
  }

  return blocks.join("\n");
}

// Word wrap that keeps the author's newlines: a description written on three paragraphs stays on
// three paragraphs, because in issues.json the break is the author's and not the layout's. A word
// longer than the width is not broken — a chopped id is not an id, and the ids are exactly the
// words that overflow. A line of blanks is a blank line: keeping its spaces would leave trailing
// whitespace nobody can see and every diff can.
export function wrapText(text, width) {
  const source = typeof text === "string" ? text : "";
  const out = [];
  for (const paragraph of source.split("\n")) {
    if (paragraph.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line === "") {
        line = word;
      } else if (line.length + 1 + word.length <= width) {
        line += ` ${word}`;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line !== "") {
      out.push(line);
    }
  }
  return out.length === 0 ? [""] : out;
}

// Indent that leaves an empty line empty instead of turning it into two spaces.
function indent(lines, pad) {
  return lines.map((line) => (line === "" ? "" : `${pad}${line}`));
}

// criteria reaches here in two shapes and neither is normalized in issues.json: an array at
// creation, a string at closure and on every issue that predates the array. Rendering one only
// would blank out half the tracker. Anything that is not text — a null slipped into the array, an
// empty entry — is not a criterion and gets no bullet of its own.
export function renderCriteria(criteria, width) {
  if (Array.isArray(criteria)) {
    const lines = [];
    for (const entry of criteria) {
      if (typeof entry !== "string" || entry.trim() === "") {
        continue;
      }
      const wrapped = wrapText(entry, width - 4);
      lines.push(`  ○ ${wrapped[0]}`);
      lines.push(...indent(wrapped.slice(1), "    "));
    }
    return lines;
  }
  if (typeof criteria === "string" && criteria.trim() !== "") {
    return indent(wrapText(criteria, width - 2), "  ");
  }
  return [];
}

// Only a string is a date here. `new Date(null)` is not an invalid date, it is the epoch: without
// this guard an issue missing a timestamp would be dated 1 January 1970 with a straight face.
function formatDate(iso) {
  if (typeof iso !== "string" || iso.trim() === "") {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * One issue, whole: nothing truncated, because in the terminal beside the editor the room is the
 * reader's to give. A block is printed only when it has something in it — an empty line opening a
 * description that is not there reads as a field that was lost, not as a field that is empty.
 *
 * @param {object} issue the issue as issues.json stores it
 * @param {object} [options]
 * @param {number} [options.width] the columns to lay the text out on
 * @param {boolean} [options.colors] whether to emit ANSI 256 escapes — the caller decides
 * @returns {string}
 */
export function renderCard(issue, { width = 100, colors = false } = {}) {
  const lines = [paint(SEP(width), "label", colors)];

  const tier = issue.tier || "standard";
  // This is the one place the status is written out, so it is the one place it is coloured: the
  // word stays there whatever the terminal, and a status the palette does not know keeps the word
  // and loses only the colour.
  const head = `● ${issue.status}`;
  const gap = Math.max(2, width - head.length - tier.length);
  lines.push(`${paint(head, issue.status, colors)}${" ".repeat(gap)}${paint(tier, "label", colors)}`);
  lines.push(...wrapText(issue.title, width));

  const description = typeof issue.description === "string" ? issue.description.trim() : "";
  if (description !== "") {
    lines.push("", ...wrapText(description, width));
  }

  const validation = issue.validation;
  if (validation && (validation.state || validation.criteria)) {
    const label = `Validazione · ${validation.state || "unknown"}`;
    lines.push("", paint(label, "label", colors));
    lines.push(...renderCriteria(validation.criteria, width));
  }

  lines.push(
    "",
    paint(issue.id, "id", colors),
    paint(
      `creata ${formatDate(issue.created_at)} · aggiornata ${formatDate(issue.updated_at)}`,
      "label",
      colors
    )
  );
  lines.push(paint(SEP(width), "label", colors));
  return lines.join("\n");
}

/**
 * The cards of a list of issues, stacked. The rule that closes a card is the same rule that opens
 * the next: printing both would draw a double line at every seam.
 *
 * @param {object[]} issues
 * @param {object} [options]
 * @param {number} [options.width] the columns to lay the text out on
 * @param {boolean} [options.colors] whether to emit ANSI 256 escapes — the caller decides
 * @returns {string}
 */
export function renderCards(issues, { width = 100, colors = false } = {}) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return "Nessuna issue da mostrare con questi filtri.";
  }
  return issues
    .map((issue, index) => {
      const card = renderCard(issue, { width, colors });
      return index === 0 ? card : card.slice(card.indexOf("\n") + 1);
    })
    .join("\n");
}
