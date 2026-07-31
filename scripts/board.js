"use strict";

// Board app: fetch, SSE, render, events. Split out of board.html verbatim (mechanical move, no
// behaviour change) so it can be served as its own file and imported for real by `node --test`
// instead of being carved out of the HTML string by counting braces.
//
// The functions here are plain exports so tests can import them directly; init() — the only part
// that touches the DOM at module load — runs only when `document` exists, which it does not under
// `node --test`.
//
// The graph's arithmetic is not here: levels, ordering, ghosts and the cycle guard live in
// board-graph.mjs, imported below and served from /board-graph.mjs. This file turns what that
// module computed into coordinates and markup, and nothing in it recomputes a level.

import { buildGraph, GHOST_DONE, GHOST_UNKNOWN } from "./board-graph.mjs";

// --- Icons ------------------------------------------------------------------------
// Inline SVG, hand-drawn to match the icon names the board already used. No icon font, no CDN,
// no runtime "refresh" pass: each render call embeds the markup directly, so it exists the moment
// innerHTML is set.
export const ICONS = {
  "layout-list": '<rect x="3" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><path d="M14 4h7M14 9h7M14 15h7M14 20h7"></path>',
  radio: '<circle cx="12" cy="12" r="2"></circle><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13"></path>',
  "file-json": '<path d="M6 2h8l6 6v14H6z"></path><path d="M14 2v6h6"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path>',
  "alert-triangle": '<path d="M12 3 2 20h20z"></path><path d="M12 9v5"></path><path d="M12 16.5v.01"></path>',
  inbox: '<path d="M3 8l2-5h14l2 5"></path><path d="M3 8v11h18V8"></path><path d="M3 8h5a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2h5"></path>',
  "circle-dashed": '<circle cx="12" cy="12" r="9" stroke-dasharray="4 3"></circle>',
  loader: '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"></path>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle>',
  ban: '<circle cx="12" cy="12" r="9"></circle><path d="M5.5 5.5l13 13"></path>',
  "check-circle": '<circle cx="12" cy="12" r="9"></circle><path d="M8 12l3 3 5-6"></path>',
  gauge: '<path d="M4 14a8 8 0 1 1 16 0"></path><path d="M12 14l3-4"></path><circle cx="12" cy="14" r="1"></circle>',
  "clipboard-check": '<rect x="6" y="4" width="12" height="17" rx="2"></rect><path d="M9 4V2h6v2"></path><path d="M9 12l2 2 4-4"></path>',
  check: '<path d="M20 6 9 17l-5-5"></path>',
  x: '<path d="M18 6 6 18M6 6l12 12"></path>',
  "help-circle": '<circle cx="12" cy="12" r="9"></circle><path d="M9.1 9a3 3 0 1 1 4.6 2.6c-1 .6-1.7 1.2-1.7 2.4"></path><path d="M12 17.5v.01"></path>',
  hash: '<path d="M5 9h14M5 15h14M9 4l-2 16M17 4l-2 16"></path>',
  "calendar-plus": '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path><path d="M12 14v6M9 17h6"></path>',
  "calendar-clock": '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path><circle cx="16" cy="16.5" r="3.5"></circle><path d="M16 15v1.5l1 1"></path>',
  layers: '<path d="M12 3 2 8l10 5 10-5z"></path><path d="M2 13l10 5 10-5"></path>',
};

export function svgIcon(name, cls) {
  const inner = ICONS[name] || "";
  const extra = cls ? ` ${cls}` : "";
  return `<svg class="icon${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

// --- Status presentation config -------------------------------------------------
export const STATUS_META = {
  backlog:     { label: "Backlog",     icon: "circle-dashed" },
  in_progress: { label: "In Progress", icon: "loader" },
  in_review:   { label: "In review",   icon: "eye" },
  blocked:     { label: "Blocked",     icon: "ban" },
  done:        { label: "Done",        icon: "check-circle" },
};
export const STATUS_ORDER = ["backlog", "in_progress", "in_review", "blocked", "done"];
// WIP view: priorità di raggruppamento (prima "cosa non va", poi "in corso", poi "in review", poi "da fare").
export const WIP_PRIORITY = { blocked: 0, in_progress: 1, in_review: 2, backlog: 3 };

export const VALIDATION_META = {
  pass:    { modifier: "pass",    icon: "check",       label: "pass" },
  fail:    { modifier: "fail",    icon: "x",           label: "fail" },
  unknown: { modifier: "unknown", icon: "help-circle",  label: "unknown" },
};

// --- App state ------------------------------------------------------------------
export const state = {
  data: null,
  issues: [],
  activeStatus: "wip", // "wip" | "all" | one of STATUS_ORDER
  query: "",
  // "graph" | "list". The graph is what the board opens on; the list is the reference view and
  // keeps the whole tracker, `done` included, which the graph deliberately drops.
  view: "graph",
  graph: null,
};

// --- DOM refs -------------------------------------------------------------------
// Declared empty and filled in only when `document` exists: a bare object literal calling
// document.getElementById at module scope would throw the moment this file is imported outside a
// browser, which is exactly what the tests now do.
const el = {};
function cacheEl() {
  el.projectTitle = document.getElementById("projectTitle");
  el.lastUpdated = document.getElementById("lastUpdated");
  el.counters = document.getElementById("counters");
  el.toolbar = document.getElementById("toolbar");
  el.viewToggle = document.getElementById("viewToggle");
  el.statusFilters = document.getElementById("statusFilters");
  el.searchInput = document.getElementById("searchInput");
  el.cycleBanner = document.getElementById("cycleBanner");
  el.graphView = document.getElementById("graphView");
  el.graphUnchained = document.getElementById("graphUnchained");
  el.graphCanvas = document.getElementById("graphCanvas");
  el.loadingState = document.getElementById("loadingState");
  el.errorState = document.getElementById("errorState");
  el.errorDetail = document.getElementById("errorDetail");
  el.emptyState = document.getElementById("emptyState");
  el.issuesList = document.getElementById("issuesList");
  el.liveIndicator = document.getElementById("liveIndicator");
  el.liveLabel = document.getElementById("liveLabel");
}

// --- Helpers --------------------------------------------------------------------
export function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return escapeHtml(iso);
  return d.toLocaleString("it-IT", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export function statusMeta(status) {
  return STATUS_META[status] || { label: status || "—", icon: "circle-dashed" };
}

// The historical UI showed issues.json's `project` field. The minimal seed the plugin writes
// today (`{last_updated, issues}`) has no such field, so this falls back to the basename of
// the directory the server is reading — never the empty string.
export function projectNameFrom(project, projectDir) {
  if (typeof project === "string" && project) return project;
  if (!projectDir) return "Issue Board";
  const parts = String(projectDir).split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "Issue Board";
}

// --- Rendering: counters --------------------------------------------------------
export function renderCounters() {
  const counts = { all: state.issues.length };
  for (const s of STATUS_ORDER) counts[s] = 0;
  for (const it of state.issues) {
    if (counts[it.status] != null) counts[it.status]++;
  }

  const cards = [];
  cards.push(counterCard("all", "Totale", counts.all, "layers"));
  for (const s of STATUS_ORDER) {
    const meta = statusMeta(s);
    cards.push(counterCard(s, meta.label, counts[s] || 0, meta.icon));
  }
  el.counters.innerHTML = cards.join("");
}

export function counterCard(key, label, value, icon) {
  return `
    <div class="counter-card" data-counter="${key}">
      <span class="counter-card__icon">${svgIcon(icon)}</span>
      <div>
        <div class="counter-card__value">${value}</div>
        <div class="counter-card__label">${escapeHtml(label)}</div>
      </div>
    </div>`;
}

// --- Rendering: status filter tabs ---------------------------------------------
export function renderFilters() {
  const tabs = [];
  tabs.push(filterTab("wip", "WIP"));
  for (const s of STATUS_ORDER) tabs.push(filterTab(s, statusMeta(s).label));
  tabs.push(filterTab("all", "Tutti"));
  el.statusFilters.innerHTML = tabs.join("");

  el.statusFilters.querySelectorAll("[data-status]").forEach((node) => {
    node.addEventListener("click", () => {
      state.activeStatus = node.getAttribute("data-status");
      renderFilters();
      renderIssues();
    });
  });
}

export function filterTab(status, label) {
  const active = state.activeStatus === status ? " is-active" : "";
  return `<button type="button" role="tab" data-status="${status}" class="status-filters__tab${active}">${escapeHtml(label)}</button>`;
}

// --- Rendering: view toggle -----------------------------------------------------
// Same tab strip as the status filters: graph and list are two ways of looking at one tracker,
// not two features. `disabled` is how the cycle fallback holds — a disabled button fires no
// click, so the page cannot be walked back into a graph whose levels are not to be trusted.
export function viewTab(view, label, disabled) {
  const active = state.view === view;
  return (
    `<button type="button" role="tab" data-view="${view}" aria-selected="${active}"` +
    `${disabled ? ' disabled title="Ciclo nelle dipendenze: il grafo non è disegnabile"' : ""}` +
    ` class="status-filters__tab${active ? " is-active" : ""}">${escapeHtml(label)}</button>`
  );
}

export function renderViewToggle() {
  const looped = hasCycle(state.graph);
  el.viewToggle.innerHTML = viewTab("graph", "Grafo", looped) + viewTab("list", "Lista", false);

  el.viewToggle.querySelectorAll("[data-view]").forEach((node) => {
    node.addEventListener("click", () => {
      state.view = node.getAttribute("data-view");
      renderViewToggle();
      renderView();
    });
  });
}

// --- Filtering ------------------------------------------------------------------
export function getFilteredIssues() {
  const q = state.query.trim().toLowerCase();

  const matchesQuery = (it) => {
    if (!q) return true;
    const haystack = `${it.title || ""}\n${it.description || ""}`.toLowerCase();
    return haystack.includes(q);
  };

  // Vista WIP: solo blocked/in_progress/in_review/backlog, ordinate per priorità e
  // a parità di stato per ordine di inserimento (indice originale nell'array).
  if (state.activeStatus === "wip") {
    return state.issues
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => WIP_PRIORITY[it.status] != null && matchesQuery(it))
      .sort((a, b) => {
        const pa = WIP_PRIORITY[a.it.status];
        const pb = WIP_PRIORITY[b.it.status];
        if (pa !== pb) return pa - pb;
        return a.index - b.index;
      })
      .map(({ it }) => it);
  }

  return state.issues.filter((it) => {
    if (state.activeStatus !== "all" && it.status !== state.activeStatus) return false;
    return matchesQuery(it);
  });
}

// --- Rendering: issue cards -----------------------------------------------------
export function renderIssues() {
  const items = getFilteredIssues();

  if (items.length === 0) {
    el.issuesList.innerHTML = "";
    el.emptyState.classList.remove("is-hidden");
    return;
  }
  el.emptyState.classList.add("is-hidden");

  el.issuesList.innerHTML = items.map(issueCard).join("");
}

// The tier says what the work of an issue is expected to cost, which is what someone looking at
// the board is deciding on. Absent on every issue written before the field, and clearable on
// purpose, so no badge at all is the normal case rather than an error to render.
export function renderTierBadge(tier) {
  if (typeof tier !== "string" || tier.trim() === "") return "";
  return `<span class="badge" title="Costo di sviluppo atteso">` +
    `${svgIcon("gauge", "icon--sm")}${escapeHtml(tier)}</span>`;
}

// validation.criteria reaches the page in two shapes, and neither is normalized in issues.json:
// an array — the bullet list written at creation, one item per criterion — or a plain string,
// which is both how the evidence is written at closure and how every issue predating the array
// stored its criteria. Rendering only one of them would blank out half the tracker.
// An array is always truthy, empty included, so the emptiness check lives here rather than in
// the caller's conditional.
export function renderCriteria(criteria) {
  if (Array.isArray(criteria)) {
    const items = criteria.filter((entry) => typeof entry === "string" && entry.trim() !== "");
    if (items.length === 0) return "";
    return `<ul class="validation-block__criteria">${items
      .map((entry) => `<li class="preserve-newlines">${escapeHtml(entry)}</li>`)
      .join("")}</ul>`;
  }
  if (typeof criteria === "string" && criteria.trim() !== "") {
    return `<p class="validation-block__criteria validation-block__criteria--text preserve-newlines">${escapeHtml(criteria)}</p>`;
  }
  return "";
}

export function issueCard(it) {
  const meta = statusMeta(it.status);
  const validation = it.validation || {};
  const vMeta = VALIDATION_META[validation.state] || VALIDATION_META.unknown;

  const criteriaMarkup = renderCriteria(validation.criteria);

  const validationBlock = (criteriaMarkup || validation.state) ? `
    <div class="validation-block">
      <div class="validation-block__head">
        ${svgIcon("clipboard-check", "icon--sm")}
        <span class="validation-block__label">Validazione</span>
        <span class="badge badge--validation-${vMeta.modifier}">
          ${svgIcon(vMeta.icon, "icon--sm")}${escapeHtml(vMeta.label)}
        </span>
      </div>
      ${criteriaMarkup}
    </div>` : "";

  return `
    <article class="issue-card">
      <div class="issue-card__head">
        <h2 class="issue-card__title">${escapeHtml(it.title)}</h2>
        <div class="issue-card__badges">
          ${renderTierBadge(it.tier)}
          <span class="badge badge--status badge--${escapeHtml(it.status)}">
            ${svgIcon(meta.icon, "icon--sm")}${escapeHtml(meta.label)}
          </span>
        </div>
      </div>

      ${it.description ? `<p class="issue-card__description preserve-newlines">${escapeHtml(it.description)}</p>` : ""}

      ${validationBlock}

      <div class="issue-card__meta">
        <span class="issue-card__meta-item" title="ID">
          ${svgIcon("hash", "icon--sm")}<code>${escapeHtml(it.id)}</code>
        </span>
        <span class="issue-card__meta-item" title="Creata">
          ${svgIcon("calendar-plus", "icon--sm")}${formatDate(it.created_at)}
        </span>
        <span class="issue-card__meta-item" title="Aggiornata">
          ${svgIcon("calendar-clock", "icon--sm")}${formatDate(it.updated_at)}
        </span>
      </div>
    </article>`;
}

// --- Graph view -----------------------------------------------------------------
// buildGraph() said which nodes exist, at which level, in which order. Everything below turns
// that into pixels and markup: no level is recomputed here, and no node is invented.

export function hasCycle(graph) {
  return Boolean(graph && graph.cycle && graph.cycle.detected);
}

// A loop can only get into issues.json by hand — the CLI refuses to write one. When it does, the
// levels are a guess and the page says so with the ids instead of drawing a plausible lie.
export function renderCycleBanner(cycle) {
  if (!cycle || !cycle.detected) return "";
  const ids = cycle.ids.map((id) => `<code>${escapeHtml(id)}</code>`).join(" ");
  return `
    <div role="alert" class="alert">
      ${svgIcon("alert-triangle")}
      <div>
        <h3 class="alert__title">Ciclo nelle dipendenze</h3>
        <div class="alert__detail">
          Il grafo non è disegnabile e la pagina ripiega sulla lista.
          Issue coinvolte: ${ids}
        </div>
      </div>
    </div>`;
}

// Fixed card sizes are what lets the layout be a pure function: a level's height is known before
// anything is in the document, so the edges can be computed here instead of measured after a
// paint. The cards clip what does not fit, which is the point — a graph node is a handle on an
// issue, not the issue.
export const GRAPH_METRICS = {
  nodeWidth: 248,
  // Tall enough for what the card holds — two clamped title lines, the badge row, the id — with
  // the ghost dropping the id and the second line. Cut short, the flex column shrinks the title
  // instead of clipping it, and a card shows half a row of letters.
  nodeHeight: 124,
  ghostHeight: 76,
  gapX: 88, // the corridor between two columns: where every edge turns
  // The gutter between two cards of one column. Not only breathing room: an edge that crosses a
  // column travels horizontally in here, so the gutter has to hold a line with clearance on both
  // sides. Back at the old 16 no gutter is wide enough and every long edge ends up in the
  // overflow band at the bottom, which is the fallback, not the normal path.
  gapY: 28,
  laneStep: 12, // multi-level edges are spread across the corridor so they stay countable
  channelClearance: 6, // how far a horizontal run keeps off the cards it passes between
  channelMin: 14, // a free band narrower than this cannot hold a lane, so it is not offered
  padTop: 32, // room for the level label
  padLeft: 8,
  padBottom: 24,
};

/**
 * Places the chained nodes in columns and routes the edges between them.
 *
 * @param {object} graph the value returned by buildGraph
 * @returns {{
 *   columns: {level: number, x: number, nodes: object[]}[],
 *   positions: Map<string, object>,
 *   edges: {from: string, to: string, span: number, points: number[][]}[],
 *   width: number, height: number
 * }}
 */
export function layoutGraph(graph) {
  const m = GRAPH_METRICS;
  const positions = new Map();
  const levels = graph && Array.isArray(graph.levels) ? graph.levels : [];

  const columns = levels.map((level, depth) => {
    const x = m.padLeft + depth * (m.nodeWidth + m.gapX);
    let y = m.padTop;
    const nodes = level.map((node) => {
      const height = node.ghost ? m.ghostHeight : m.nodeHeight;
      const placed = { node, x, y, width: m.nodeWidth, height };
      positions.set(node.id, placed);
      y += height + m.gapY;
      return placed;
    });
    return { level: depth, x, nodes };
  });

  // Where the cards end. The edges are routed against this line — above it they look for a band
  // no column occupies, below it lies the overflow band — so it has to be known before them.
  const contentBottom = columns.reduce((max, column) => {
    const last = column.nodes[column.nodes.length - 1];
    return last ? Math.max(max, last.y + last.height) : max;
  }, m.padTop);

  const { edges, bottom } = layoutEdges(graph, positions, columns, contentBottom);

  const width = columns.length === 0
    ? 0
    : m.padLeft * 2 + columns.length * (m.nodeWidth + m.gapX) - m.gapX;
  const height = Math.max(contentBottom, bottom) + m.padBottom;

  return { columns, positions, edges, width, height };
}

// The y bands a horizontal run may travel in while crossing the levels from `first` to `last`:
// every card of those columns, grown by the clearance, is off limits, and what is left over is a
// band. Columns are packed independently, so a band is rarely a whole row — most of the time it
// is the space under the shortest column, which is exactly where a long edge can slip through.
function freeBands(columns, first, last, bottom) {
  const m = GRAPH_METRICS;
  const blocked = [];
  for (let level = first; level <= last; level += 1) {
    for (const placed of columns[level] ? columns[level].nodes : []) {
      blocked.push([placed.y - m.channelClearance, placed.y + placed.height + m.channelClearance]);
    }
  }
  blocked.sort((a, b) => a[0] - b[0]);

  const bands = [];
  let cursor = m.padTop;
  for (const [top, end] of blocked) {
    if (top - cursor >= m.channelMin) {
      bands.push([cursor, top]);
    }
    cursor = Math.max(cursor, end);
  }
  if (bottom - cursor >= m.channelMin) {
    bands.push([cursor, bottom]);
  }
  return bands;
}

// The lane for one horizontal run: inside a free band, as close as the band allows to the
// straight line between the two ends, and never on top of another run that shares the same
// stretch of x — two arcs on one line are one arc to whoever is reading. `null` when nothing
// fits: the caller then sends the edge below the plane, where by construction there is no card.
function pickLane(bands, wanted, used, x0, x1) {
  const m = GRAPH_METRICS;
  const nearest = [...bands].sort(
    (a, b) => Math.abs((a[0] + a[1]) / 2 - wanted) - Math.abs((b[0] + b[1]) / 2 - wanted)
  );

  for (const [top, end] of nearest) {
    const start = Math.min(end, Math.max(top, wanted));
    const steps = Math.floor((end - top) / m.laneStep);
    for (let step = 0; step <= steps; step += 1) {
      const candidates = step === 0
        ? [start]
        : [start + step * m.laneStep, start - step * m.laneStep];
      for (const candidate of candidates) {
        const lane = Math.round(candidate);
        if (lane < top || lane > end) {
          continue;
        }
        const clash = used.some(
          (run) => Math.abs(run.y - lane) < m.laneStep && run.x0 < x1 && x0 < run.x1
        );
        if (!clash) {
          return lane;
        }
      }
    }
  }
  return null;
}

// Each long edge gets its own vertical inside the corridor it leaves and the one it arrives in,
// so a fan of three arcs reads as three lines rather than one.
function corridorOffset(lanes, level) {
  const m = GRAPH_METRICS;
  const lane = lanes.get(level) ?? 0;
  lanes.set(level, lane + 1);
  return Math.min(m.gapX - 12, 14 + lane * m.laneStep);
}

// A polyline whose consecutive points repeat draws the same segment twice: when the lane lands
// exactly on the height of one of the two ends, the turn is not a turn and the point goes.
function trimPoints(points) {
  return points.filter(
    (point, i) => i === 0 || point[0] !== points[i - 1][0] || point[1] !== points[i - 1][1]
  );
}

// One elbow per edge: out of the dependency's right side, a turn inside the corridor, then
// straight into the left side of the issue that declares it — so the arrow always arrives
// pointing at the target.
//
// An edge that skips levels cannot do the same. Its horizontal stretch crosses the columns in
// between, and since the edges are drawn under the cards, at the height of a card that stretch
// is simply not there: start and arrowhead visible, the path between them gone — and it is the
// long edges that carry the dependencies the adjacent columns do not already tell you. So it is
// routed in five segments instead of three: up or down inside the corridor after the source,
// across at a height no card of the crossed columns occupies, then into the corridor before the
// target. When no such height exists — every column packed edge to edge — the run goes into the
// band below the plane, which no card can ever reach.
function layoutEdges(graph, positions, columns, contentBottom) {
  const m = GRAPH_METRICS;
  const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];
  const leaving = new Map();
  const arriving = new Map();
  const runs = [];
  const routed = [];
  let bottom = contentBottom;
  let overflow = 0;

  for (const edge of edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) {
      continue;
    }
    const source = graph.byId.get(edge.from);
    const target = graph.byId.get(edge.to);
    const span = (target.level ?? 0) - (source.level ?? 0);

    const x1 = from.x + from.width;
    const y1 = Math.round(from.y + from.height / 2);
    const x2 = to.x;
    const y2 = Math.round(to.y + to.height / 2);

    if (span <= 1) {
      const turn = x1 + m.gapX / 2;
      routed.push({
        from: edge.from,
        to: edge.to,
        span,
        points: trimPoints([[x1, y1], [turn, y1], [turn, y2], [x2, y2]]),
      });
      continue;
    }

    const exit = x1 + corridorOffset(leaving, source.level);
    const entry = x2 - corridorOffset(arriving, target.level);
    const bands = freeBands(columns, source.level + 1, target.level - 1, contentBottom);

    let lane = pickLane(bands, Math.round((y1 + y2) / 2), runs, exit, entry);
    if (lane === null) {
      overflow += 1;
      lane = Math.round(contentBottom + m.gapY + overflow * m.laneStep);
      bottom = Math.max(bottom, lane);
    }
    runs.push({ y: lane, x0: exit, x1: entry });

    routed.push({
      from: edge.from,
      to: edge.to,
      span,
      points: trimPoints([[x1, y1], [exit, y1], [exit, lane], [entry, lane], [entry, y2], [x2, y2]]),
    });
  }

  return { edges: routed, bottom };
}

// One <svg> for every edge, sized to the plane and sitting under the cards. The arrowhead is a
// marker on the polyline's end, so it is on the target by construction and turns with the last
// segment rather than being positioned by hand.
export function renderEdges(layout) {
  const lines = layout.edges
    .map((edge) => {
      const points = edge.points.map(([x, y]) => `${x},${y}`).join(" ");
      return `<polyline class="graph-edge" points="${points}" marker-end="url(#graph-arrow)"></polyline>`;
    })
    .join("");
  return (
    `<svg class="graph-edges" width="${layout.width}" height="${layout.height}" ` +
    `viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true">` +
    `<defs><marker id="graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">` +
    `<path class="graph-edge__tip" d="M0 0 L8 4 L0 8 Z"></path></marker></defs>${lines}</svg>`
  );
}

export function shortId(id) {
  return String(id || "").slice(0, 8);
}

export function graphNodeBody(node) {
  // Nothing in the tracker answers for this id: the card carries the id itself, because that is
  // the only thing that lets someone go and find what went wrong.
  if (node.ghost === GHOST_UNKNOWN) {
    return (
      `<p class="graph-node__title" title="${escapeHtml(node.id)}">id sconosciuto · ${escapeHtml(shortId(node.id))}</p>` +
      `<div class="graph-node__badges"><span class="badge badge--ghost">` +
      `${svgIcon("help-circle", "icon--sm")}sconosciuto</span></div>`
    );
  }

  const issue = node.issue || {};
  const status = node.ghost === GHOST_DONE ? "done" : issue.status;
  const meta = statusMeta(status);
  const badge =
    `<span class="badge badge--status badge--${escapeHtml(status)}">` +
    `${svgIcon(meta.icon, "icon--sm")}${escapeHtml(meta.label)}</span>`;
  const title = `<p class="graph-node__title" title="${escapeHtml(issue.title)}">${escapeHtml(issue.title)}</p>`;

  // A ghost is a closed dependency: title and status, nothing to act on.
  if (node.ghost) {
    return `${title}<div class="graph-node__badges">${badge}</div>`;
  }
  return (
    `${title}<div class="graph-node__badges">${renderTierBadge(issue.tier)}${badge}</div>` +
    `<div class="graph-node__id">${escapeHtml(shortId(node.id))}</div>`
  );
}

// With coordinates the card is absolutely placed on the plane; without them it flows inside the
// unchained grid. Same card either way, so the two groups read as the same kind of thing.
export function graphNode(node, style) {
  const classes = ["graph-node"];
  if (node.ghost) classes.push("graph-node--ghost");
  if (!style) classes.push("graph-node--flow");
  return (
    `<article class="${classes.join(" ")}" data-id="${escapeHtml(node.id)}"` +
    `${style ? ` style="${style}"` : ""}>${graphNodeBody(node)}</article>`
  );
}

export function graphNodeCard(placed) {
  return graphNode(
    placed.node,
    `left:${placed.x}px;top:${placed.y}px;width:${placed.width}px;height:${placed.height}px`
  );
}

// Issues with neither dependencies nor dependents are not a level: they are a labelled grid that
// wraps, kept out of the columns. On this tracker most issues declare nothing, and putting them
// at level 0 turns the whole graph into one vertical column.
export function renderUnchained(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return "";
  return (
    `<h2 class="graph-group__label">senza catena · ${nodes.length}</h2>` +
    `<div class="graph-group__grid">${nodes.map((node) => graphNode(node, "")).join("")}</div>`
  );
}

export function renderGraph() {
  const graph = state.graph;
  el.graphUnchained.innerHTML = renderUnchained(graph.unchained);

  const layout = layoutGraph(graph);
  if (layout.columns.length === 0) {
    el.graphCanvas.innerHTML = graph.unchained.length
      ? `<p class="graph-empty">Nessuna dipendenza dichiarata: non c'è nessuna catena da disegnare.</p>`
      : `<p class="graph-empty">Nessuna issue aperta: il grafo non ha niente da mostrare.</p>`;
    return;
  }

  const labels = layout.columns
    .map(
      (column) =>
        `<p class="graph-column-label" style="left:${column.x}px;width:${GRAPH_METRICS.nodeWidth}px">livello ${column.level}</p>`
    )
    .join("");
  const cards = layout.columns.map((column) => column.nodes.map(graphNodeCard).join("")).join("");

  el.graphCanvas.innerHTML =
    `<div class="graph-plane" style="width:${layout.width}px;height:${layout.height}px">` +
    `${renderEdges(layout)}${labels}${cards}</div>`;
}

// The toggle: one of the two views is in the document at a time. Search and status filters drive
// the list only, so they follow it instead of sitting there answering nothing.
export function renderView() {
  const graphActive = state.view === "graph";
  el.toolbar.classList.toggle("toolbar--graph", graphActive);
  el.graphView.classList.toggle("is-hidden", !graphActive);
  el.issuesList.classList.toggle("is-hidden", graphActive);

  if (graphActive) {
    el.emptyState.classList.add("is-hidden");
    renderGraph();
    return;
  }
  renderIssues();
}

// --- Boot -----------------------------------------------------------------------
export function showError(message) {
  el.loadingState.classList.add("is-hidden");
  el.errorState.classList.remove("is-hidden");
  el.errorDetail.textContent = message || "";
}

export function bindSearch() {
  el.searchInput.addEventListener("input", (e) => {
    state.query = e.target.value;
    renderIssues();
  });
}

// Reloads the data and repaints. Filter and search live in `state`, so a push from the
// server never resets what the user is looking at.
export async function load() {
  const res = await fetch("api/issues", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();

  state.data = data;
  state.issues = Array.isArray(data.issues) ? data.issues : [];
  // Built on every load, whichever view is open: the cycle guard has to speak even when the
  // graph is not the thing being looked at.
  state.graph = buildGraph(state.issues);

  el.projectTitle.textContent = `${projectNameFrom(data.project, data.projectDir)} — Issue Board`;
  el.lastUpdated.textContent = data.lastUpdated
    ? `Ultimo aggiornamento: ${formatDate(data.lastUpdated)} · ${state.issues.length} issue`
    : `${state.issues.length} issue`;

  el.loadingState.classList.add("is-hidden");

  // A partially written issues.json is reported by the server rather than crashing it.
  if (data.error) {
    showError(data.error);
  } else {
    el.errorState.classList.add("is-hidden");
  }

  // The cycle banner is not an error state: the tracker is readable, the graph is not drawable.
  // The list is a complete view of the same data, so the page falls back to it and keeps going.
  const banner = renderCycleBanner(state.graph.cycle);
  el.cycleBanner.innerHTML = banner;
  el.cycleBanner.classList.toggle("is-hidden", banner === "");
  if (hasCycle(state.graph)) {
    state.view = "list";
  }

  renderCounters();
  renderFilters();
  renderViewToggle();
  renderView();
}

export function setLive(connected) {
  el.liveIndicator.classList.toggle("is-warning", !connected);
  el.liveLabel.textContent = connected ? "live" : "riconnessione…";
}

// The server watches issues.json and pushes; the page never polls.
export function subscribe() {
  const events = new EventSource("events");
  events.addEventListener("issues", () => {
    load().catch((err) => showError(err && err.message ? err.message : String(err)));
  });
  events.onopen = () => setLive(true);
  events.onerror = () => setLive(false);
}

export async function init() {
  cacheEl();
  bindSearch();
  try {
    await load();
    subscribe();
  } catch (err) {
    showError(err && err.message ? err.message : String(err));
  }
}

// The only DOM access at module load: guarded so this file is importable from `node --test`,
// where `document` does not exist, instead of throwing the moment it is imported.
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    init();
  });
}
