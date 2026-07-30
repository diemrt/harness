"use strict";

// Board app: fetch, SSE, render, events. Split out of board.html verbatim (mechanical move, no
// behaviour change) so it can be served as its own file and imported for real by `node --test`
// instead of being carved out of the HTML string by counting braces.
//
// The functions here are plain exports so tests can import them directly; init() — the only part
// that touches the DOM at module load — runs only when `document` exists, which it does not under
// `node --test`.

// --- Status presentation config -------------------------------------------------
export const STATUS_META = {
  backlog:     { label: "Backlog",     badge: "badge-neutral", text: "text-neutral",  icon: "circle-dashed", dot: "bg-neutral" },
  in_progress: { label: "In Progress", badge: "badge-info",    text: "text-info",     icon: "loader",        dot: "bg-info" },
  in_review:   { label: "In review",   badge: "badge-warning", text: "text-warning",  icon: "eye",           dot: "bg-warning" },
  blocked:     { label: "Blocked",     badge: "badge-error",   text: "text-error",    icon: "ban",           dot: "bg-error" },
  done:        { label: "Done",        badge: "badge-success", text: "text-success",  icon: "check-circle",  dot: "bg-success" },
};
export const STATUS_ORDER = ["backlog", "in_progress", "in_review", "blocked", "done"];
// WIP view: priorità di raggruppamento (prima "cosa non va", poi "in corso", poi "in review", poi "da fare").
export const WIP_PRIORITY = { blocked: 0, in_progress: 1, in_review: 2, backlog: 3 };

export const VALIDATION_META = {
  pass:    { badge: "badge-success", icon: "check", label: "pass" },
  fail:    { badge: "badge-error",   icon: "x",     label: "fail" },
  unknown: { badge: "badge-ghost",   icon: "help-circle", label: "unknown" },
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
  return STATUS_META[status] || { label: status || "—", badge: "badge-ghost", text: "", icon: "circle", dot: "bg-base-300" };
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

export function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

// --- Rendering: counters --------------------------------------------------------
export function renderCounters() {
  const counts = { all: state.issues.length };
  for (const s of STATUS_ORDER) counts[s] = 0;
  for (const it of state.issues) {
    if (counts[it.status] != null) counts[it.status]++;
  }

  const cards = [];
  cards.push(counterCard("all", "Totale", counts.all, "layers", "text-primary"));
  for (const s of STATUS_ORDER) {
    const meta = statusMeta(s);
    cards.push(counterCard(s, meta.label, counts[s] || 0, meta.icon, meta.text));
  }
  el.counters.innerHTML = cards.join("");
  refreshIcons();
}

export function counterCard(key, label, value, icon, textClass) {
  return `
    <div class="rounded-xl bg-base-100 shadow-sm p-4 flex items-center gap-3">
      <span class="grid place-items-center w-10 h-10 rounded-lg bg-base-200 ${textClass}">
        <i data-lucide="${icon}" class="w-5 h-5"></i>
      </span>
      <div>
        <div class="text-2xl font-bold leading-none">${value}</div>
        <div class="text-xs text-base-content/60 mt-1">${escapeHtml(label)}</div>
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
  const active = state.activeStatus === status ? "tab-active" : "";
  return `<button type="button" role="tab" data-status="${status}" class="tab ${active} whitespace-nowrap">${escapeHtml(label)}</button>`;
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
    el.emptyState.classList.remove("hidden");
    el.emptyState.classList.add("flex");
    return;
  }
  el.emptyState.classList.add("hidden");
  el.emptyState.classList.remove("flex");

  el.issuesList.innerHTML = items.map(issueCard).join("");
  refreshIcons();
}

// The tier says what the work of an issue is expected to cost, which is what someone looking at
// the board is deciding on. Absent on every issue written before the field, and clearable on
// purpose, so no badge at all is the normal case rather than an error to render.
export function renderTierBadge(tier) {
  if (typeof tier !== "string" || tier.trim() === "") return "";
  return `<span class="badge badge-sm badge-outline gap-1 shrink-0" title="Costo di sviluppo atteso">` +
    `<i data-lucide="gauge" class="w-3 h-3"></i>${escapeHtml(tier)}</span>`;
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
    return `<ul class="text-sm opacity-80 list-disc pl-5 space-y-1">${items
      .map((entry) => `<li class="preserve-newlines">${escapeHtml(entry)}</li>`)
      .join("")}</ul>`;
  }
  if (typeof criteria === "string" && criteria.trim() !== "") {
    return `<p class="text-sm opacity-80 preserve-newlines">${escapeHtml(criteria)}</p>`;
  }
  return "";
}

export function issueCard(it) {
  const meta = statusMeta(it.status);
  const validation = it.validation || {};
  const vMeta = VALIDATION_META[validation.state] || VALIDATION_META.unknown;

  const criteriaMarkup = renderCriteria(validation.criteria);

  const validationBlock = (criteriaMarkup || validation.state) ? `
    <div class="mt-3 rounded-lg bg-base-200/60 p-3">
      <div class="flex items-center gap-2 mb-1">
        <i data-lucide="clipboard-check" class="w-4 h-4 opacity-70"></i>
        <span class="text-xs font-semibold uppercase tracking-wide opacity-70">Validazione</span>
        <span class="badge badge-sm ${vMeta.badge} gap-1">
          <i data-lucide="${vMeta.icon}" class="w-3 h-3"></i>${escapeHtml(vMeta.label)}
        </span>
      </div>
      ${criteriaMarkup}
    </div>` : "";

  return `
    <article class="issue-card card bg-base-100 shadow-sm border border-base-200 hover:shadow-md transition-shadow">
      <div class="card-body p-5">
        <div class="flex items-start justify-between gap-3">
          <h2 class="card-title text-base leading-snug">${escapeHtml(it.title)}</h2>
          <div class="flex items-center gap-2 shrink-0">
            ${renderTierBadge(it.tier)}
            <span class="badge ${meta.badge} gap-1 shrink-0">
              <i data-lucide="${meta.icon}" class="w-3 h-3"></i>${escapeHtml(meta.label)}
            </span>
          </div>
        </div>

        ${it.description ? `<p class="text-sm text-base-content/80 mt-2 preserve-newlines">${escapeHtml(it.description)}</p>` : ""}

        ${validationBlock}

        <div class="mt-4 pt-3 border-t border-base-200 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-base-content/50">
          <span class="inline-flex items-center gap-1" title="ID">
            <i data-lucide="hash" class="w-3 h-3"></i><code>${escapeHtml(it.id)}</code>
          </span>
          <span class="inline-flex items-center gap-1" title="Creata">
            <i data-lucide="calendar-plus" class="w-3 h-3"></i>${formatDate(it.created_at)}
          </span>
          <span class="inline-flex items-center gap-1" title="Aggiornata">
            <i data-lucide="calendar-clock" class="w-3 h-3"></i>${formatDate(it.updated_at)}
          </span>
        </div>
      </div>
    </article>`;
}

// --- Boot -----------------------------------------------------------------------
export function showError(message) {
  el.loadingState.classList.add("hidden");
  el.errorState.classList.remove("hidden");
  el.errorDetail.textContent = message || "";
  refreshIcons();
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

  el.loadingState.classList.add("hidden");

  // A partially written issues.json is reported by the server rather than crashing it.
  if (data.error) {
    showError(data.error);
  } else {
    el.errorState.classList.add("hidden");
  }

  renderCounters();
  renderFilters();
  renderIssues();
}

export function setLive(connected) {
  el.liveIndicator.classList.toggle("badge-ghost", connected);
  el.liveIndicator.classList.toggle("badge-warning", !connected);
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
    refreshIcons();
    init();
  });
}
