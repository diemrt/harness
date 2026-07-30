"use strict";

// Board app: fetch, SSE, render, events. Split out of board.html verbatim (mechanical move, no
// behaviour change) so it can be served as its own file and imported for real by `node --test`
// instead of being carved out of the HTML string by counting braces.
//
// The functions here are plain exports so tests can import them directly; init() — the only part
// that touches the DOM at module load — runs only when `document` exists, which it does not under
// `node --test`.

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
  el.statusFilters = document.getElementById("statusFilters");
  el.searchInput = document.getElementById("searchInput");
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

  renderCounters();
  renderFilters();
  renderIssues();
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
