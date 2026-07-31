# Board a terminale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire la pagina web del board con un comando che stampa: albero delle catene dentro la sessione, albero più card in un terminale a fianco.

**Architecture:** Tre file. `board-graph.mjs` resta invariato e continua a calcolare livelli, ordinamento, catene e cicli. `board-render.mjs` è nuovo e puro: riceve il grafo e restituisce una stringa, senza conoscere il terminale. `board-cli.mjs` è l'unico con effetti collaterali: argomenti, lettura del file, decisione sul colore, stampa, watcher.

**Tech Stack:** Node.js, solo built-in (`node:fs`, `node:path`, `node:process`). `node --test` per i test. Nessuna dipendenza, nessun bundler.

## Global Constraints

- Nessuna dipendenza esterna e nessun build step: solo moduli built-in di Node.
- `scripts/board-graph.mjs` **non si modifica**, eccetto un commento obsoleto rimosso nel Task 7.
- `board-render.mjs` è puro: niente `process`, niente `fs`, niente `console`. Riceve dati e opzioni, restituisce stringhe.
- `issues.json` non si risolve mai accanto agli script: `--project-dir`, in sua assenza la cwd.
- Errori: una riga JSON `{"ok":false,"error":"<msg>","code":"<CODE>"}` su stdout ed exit 1. Successo: testo. Codici ammessi: `FILE_NOT_FOUND`, `INVALID_ARGUMENT`, `UNKNOWN_ARGUMENT`.
- Il colore si spegne con `--no-color`, con `NO_COLOR` valorizzato, e quando `process.stdout.isTTY` è falso.
- Il colore non porta mai informazione da solo: ogni stato è scritto anche in lettere.
- Il progetto è il primo consumer di sé stesso: dopo ogni task `npm run test` deve passare.
- Commit solo dopo il `pass` di un verificatore indipendente (regola harness, vale per le issue che tracciano questi task).

---

## File Structure

| file | responsabilità |
|---|---|
| `scripts/board-graph.mjs` | invariato: livelli, ordinamento, `chainOf`, guardia sui cicli |
| `scripts/board-render.mjs` | **nuovo** — `wrapText`, `paint`, `renderChains`, `renderCards`, `renderWatch`. Puro |
| `scripts/board-cli.mjs` | **nuovo** — `parseArgs`, lettura del tracker, filtri, stampa, `--watch`, `--write-launcher` |
| `test/plugin-board-render.test.mjs` | **nuovo** — snapshot del renderer |
| `test/plugin-board-cli.test.mjs` | **nuovo** — CLI su directory temporanee |
| `scripts/board-server.mjs`, `board.js`, `board.css`, `board.html` | **cancellati** (Task 7) |
| `test/plugin-board.test.mjs` | **cancellato** (Task 7) |
| `commands/board.md`, `skills/harness/references/board.md`, `skills/harness/SKILL.md` | riscritti (Task 8) |

---

### Task 1: Renderer, vista catene

**Files:**
- Create: `scripts/board-render.mjs`
- Test: `test/plugin-board-render.test.mjs`

**Interfaces:**
- Consumes: `buildGraph(issues)` e `chainOf(graph, id)` da `./board-graph.mjs`.
- Produces:
  - `components(graph) -> {root: node, nodes: node[]}[]` — componenti connesse, ordinate per indice della radice
  - `renderChains({graph, project, branch, counts, width}) -> string`
  - `SEP(width) -> string` — riga di separazione riusata dal Task 2

- [ ] **Step 1: Scrivere il test che fallisce**

In `test/plugin-board-render.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../scripts/board-graph.mjs";
import { components, renderChains } from "../scripts/board-render.mjs";

const A = "aaaaaaaa-1111-1111-1111-111111111111";
const B = "bbbbbbbb-2222-2222-2222-222222222222";
const C = "cccccccc-3333-3333-3333-333333333333";
const D = "dddddddd-4444-4444-4444-444444444444";

function issue(id, extra = {}) {
  return {
    id,
    title: `titolo ${id.slice(0, 4)}`,
    description: "",
    status: "backlog",
    tier: "standard",
    depends_on: [],
    validation: null,
    created_at: "2026-07-30T10:00:00Z",
    updated_at: "2026-07-30T10:00:00Z",
    ...extra,
  };
}

const opts = { project: "harness", branch: "main", width: 78 };

test("una issue senza dipendenze finisce sotto 'senza catena', non in una catena", () => {
  const graph = buildGraph([issue(A)]);
  assert.equal(components(graph).length, 0, "niente archi, niente componenti");
  const out = renderChains({ graph, ...opts, counts: { open: 1, done: 0 } });
  assert.match(out, /senza catena/);
  assert.match(out, /aaaaaaaa {2}titolo aaaa/);
  assert.match(out, /► lavorabile/);
});

test("una catena si identifica con l'id corto della sua radice", () => {
  const graph = buildGraph([issue(A), issue(B, { depends_on: [A] })]);
  const out = renderChains({ graph, ...opts, counts: { open: 2, done: 0 } });
  assert.match(out, /catena · aaaaaaaa/, "il titolo della sezione è la radice");
  assert.equal(out.includes("senza catena"), false, "entrambe sono in catena");
});

test("una issue con dipendenze aperte non è lavorabile, una con dipendenze chiuse sì", () => {
  const graph = buildGraph([
    issue(A, { status: "done" }),
    issue(B, { depends_on: [A] }),
    issue(C, { depends_on: [B] }),
  ]);
  const out = renderChains({ graph, ...opts, counts: { open: 2, done: 1 } });
  const lineB = out.split("\n").find((l) => l.includes("bbbbbbbb"));
  const lineC = out.split("\n").find((l) => l.includes("cccccccc"));
  assert.match(lineB, /► lavorabile/, "A è done, quindi B si può lavorare");
  assert.equal(lineC.includes("► lavorabile"), false, "B è aperta, C attende");
  assert.match(out, /✓ aaaaaaaa/, "la dipendenza chiusa resta visibile come fantasma");
});

test("un nodo con più genitori compare una volta sola, con le attese in riga", () => {
  const graph = buildGraph([
    issue(A),
    issue(B, { depends_on: [A] }),
    issue(C, { depends_on: [A] }),
    issue(D, { depends_on: [B, C] }),
  ]);
  const out = renderChains({ graph, ...opts, counts: { open: 4, done: 0 } });
  const occurrences = out.split("\n").filter((l) => l.includes("dddddddd  titolo")).length;
  assert.equal(occurrences, 1, "una riga sola per issue, non una per arco");
  assert.match(out, /attende bbbbbbbb cccccccc/);
});

test("un ciclo non si disegna: si stampano gli id e si ripiega sull'elenco piatto", () => {
  const graph = buildGraph([
    issue(A, { depends_on: [B] }),
    issue(B, { depends_on: [A] }),
  ]);
  const out = renderChains({ graph, ...opts, counts: { open: 2, done: 0 } });
  assert.match(out, /ciclo/i);
  assert.match(out, /aaaaaaaa/);
  assert.match(out, /bbbbbbbb/);
});

test("l'intestazione porta progetto, conteggi e branch", () => {
  const graph = buildGraph([issue(A)]);
  const out = renderChains({ graph, ...opts, counts: { open: 6, done: 84 } });
  assert.match(out, /harness · 6 aperte · 84 chiuse/);
  assert.match(out, /main/);
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `node --test test/plugin-board-render.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/board-render.mjs'`

- [ ] **Step 3: Implementare `board-render.mjs`**

```js
// Turns the graph board-graph.mjs computes into text. Pure on purpose: no process, no fs, no
// console. It takes data and options and returns a string, which is what makes a change to the
// way the board looks a matter of one assert.equal instead of a browser.

import { GHOST_UNKNOWN } from "./board-graph.mjs";

export const IN_FLIGHT = ["in_progress", "in_review", "blocked"];

export function SEP(width) {
  return "─".repeat(Math.max(10, width));
}

export function shortId(id) {
  return String(id || "").slice(0, 8);
}

// CORRETTO DOPO LA VERIFICA — la prima stesura di questo piano usava `chainOf(graph, id).ids`, che
// NON è una componente connessa: risale per dependsOn e scende per dependents, quindi due fratelli
// della stessa dipendenza finiscono in insiemi disgiunti. Una componente usciva a pezzi e un nodo
// presente in più pezzi veniva disegnato una volta per pezzo. Serve un attraversamento che segua
// gli archi in entrambi i versi insieme.
function reach(graph, startId) {
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const node = graph.byId.get(queue.shift());
    if (!node) continue;
    for (const id of [...node.dependsOn, ...node.dependents]) {
      if (seen.has(id)) continue;
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
    if (node.unchained || seen.has(node.id)) continue;
    const ids = reach(graph, node.id);
    for (const id of ids) seen.add(id);
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
// index. level(parent) is always strictly lower than level(child), so this can never loop, and
// every issue occupies one line — the line count is the issue count, not the edge count.
function parentOf(node, graph) {
  let best = null;
  for (const depId of node.dependsOn) {
    const dep = graph.byId.get(depId);
    if (!dep) continue;
    if (!best || (dep.level ?? 0) > (best.level ?? 0) || ((dep.level ?? 0) === (best.level ?? 0) && dep.index < best.index)) {
      best = dep;
    }
  }
  return best;
}

function isWorkable(node, graph) {
  if (node.ghost) return false;
  return node.dependsOn.every((id) => {
    const dep = graph.byId.get(id);
    return !dep || dep.ghost !== null;
  });
}

function nodeLine(node, graph, prefix, width) {
  if (node.ghost) {
    const label = node.ghost === "unknown" ? "id sconosciuto" : node.issue.title;
    return `${prefix}✓ ${shortId(node.id)}  ${label}`;
  }
  const tier = node.issue.tier || "standard";
  const flag = isWorkable(node, graph) ? "► lavorabile" : "";
  const left = `${prefix}○ ${shortId(node.id)}  ${node.issue.title}`;
  const right = `[${tier}]${flag ? "  " + flag : ""}`;
  const gap = Math.max(2, width - left.length - right.length);
  return `${left}${" ".repeat(gap)}${right}`;
}

function renderComponent(component, graph, width) {
  const lines = [`catena · ${shortId(component.root.id)} ${SEP(Math.max(10, width - 12 - shortId(component.root.id).length))}`];
  const children = new Map();
  const roots = [];
  for (const node of component.nodes) {
    const parent = parentOf(node, graph);
    if (!parent) {
      roots.push(node);
      continue;
    }
    if (!children.has(parent.id)) children.set(parent.id, []);
    children.get(parent.id).push(node);
  }

  const walk = (node, depth) => {
    const prefix = depth === 0 ? "  " : "  " + "   ".repeat(depth - 1) + "└─ ";
    lines.push(nodeLine(node, graph, prefix, width));
    if (node.dependsOn.length > 1) {
      lines.push(`${"  ".repeat(depth + 2)}attende ${node.dependsOn.map(shortId).join(" ")}`);
    }
    for (const child of (children.get(node.id) ?? []).sort((a, b) => a.order - b.order)) {
      walk(child, depth + 1);
    }
  };
  for (const root of roots.sort((a, b) => a.order - b.order)) walk(root, 0);
  return lines.join("\n");
}

/**
 * The chain view: one block per connected component, plus the issues that declare no dependency
 * and none declares them.
 */
export function renderChains({ graph, project, branch, counts, width = 100 }) {
  const head = `${project} · ${counts.open} aperte · ${counts.done} chiuse`;
  const gap = Math.max(2, width - head.length - String(branch || "").length);
  const blocks = [`${head}${" ".repeat(gap)}${branch || ""}`, ""];

  if (graph.cycle && graph.cycle.detected) {
    blocks.push("⚠ ciclo nelle dipendenze: l'albero non si disegna.");
    blocks.push(`  issue coinvolte: ${graph.cycle.ids.map(shortId).join(" ")}`);
    blocks.push("");
    for (const node of graph.nodes) {
      if (!node.ghost) blocks.push(nodeLine(node, graph, "  ", width));
    }
    return blocks.join("\n");
  }

  for (const component of components(graph)) {
    blocks.push(renderComponent(component, graph, width), "");
  }

  if (graph.unchained.length > 0) {
    blocks.push(`senza catena ${SEP(Math.max(10, width - 13))}`);
    for (const node of graph.unchained) blocks.push(nodeLine(node, graph, "  ", width));
    blocks.push("");
  }

  if (components(graph).length === 0 && graph.unchained.length === 0) {
    blocks.push("Nessuna issue aperta: il tracker non ha niente da mostrare.");
  }

  return blocks.join("\n");
}
```

- [ ] **Step 4: Lanciare i test e verificare che passino**

Run: `node --test test/plugin-board-render.test.mjs`
Expected: PASS, 6 test

- [ ] **Step 5: Commit**

```bash
git add scripts/board-render.mjs test/plugin-board-render.test.mjs
git commit -m "feat: renderer testuale delle catene di dipendenza"
```

---

### Task 2: Renderer, vista card

**Files:**
- Modify: `scripts/board-render.mjs`
- Test: `test/plugin-board-render.test.mjs`

**Interfaces:**
- Consumes: `SEP`, `shortId`, `IN_FLIGHT` dal Task 1.
- Produces:
  - `wrapText(text, width) -> string[]` — le newline originali restano interruzioni
  - `renderCriteria(criteria, width) -> string[]`
  - `renderCard(issue, {width}) -> string`
  - `renderCards(issues, {width}) -> string`

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere a `test/plugin-board-render.test.mjs`:

```js
import { wrapText, renderCard, renderCards } from "../scripts/board-render.mjs";

test("wrapText va a capo sulle parole e conserva le newline originali", () => {
  assert.deepEqual(wrapText("uno due tre quattro", 9), ["uno due", "tre", "quattro"]);
  assert.deepEqual(wrapText("prima\n\nseconda", 20), ["prima", "", "seconda"]);
  assert.deepEqual(wrapText("", 20), [""]);
  // Una parola più lunga della larghezza non si spezza: si sfora, perché un id tagliato a metà
  // non è più un id.
  assert.deepEqual(wrapText("parolalunghissima", 5), ["parolalunghissima"]);
});

test("la card porta tutti e sette i campi", () => {
  const it = issue(A, {
    status: "in_progress",
    tier: "reasoning",
    title: "titolo della issue",
    description: "prima riga\nseconda riga",
    validation: { state: "unknown", criteria: ["primo criterio", "secondo criterio"] },
    created_at: "2026-07-30T21:09:41Z",
    updated_at: "2026-07-31T07:14:34Z",
  });
  const card = renderCard(it, { width: 70 });
  assert.match(card, /in_progress/);
  assert.match(card, /reasoning/);
  assert.match(card, /titolo della issue/);
  assert.match(card, /prima riga/);
  assert.match(card, /seconda riga/);
  assert.match(card, /Validazione · unknown/);
  assert.match(card, /primo criterio/);
  assert.match(card, /secondo criterio/);
  assert.match(card, new RegExp(A), "l'id è completo, non abbreviato");
  assert.match(card, /creata/);
  assert.match(card, /aggiornata/);
});

test("criteria come stringa è reso quanto criteria come array", () => {
  const asText = renderCard(
    issue(A, { validation: { state: "pass", criteria: "evidenza della verifica" } }),
    { width: 70 }
  );
  assert.match(asText, /Validazione · pass/);
  assert.match(asText, /evidenza della verifica/);
});

test("una issue senza validation non stampa il blocco di validazione", () => {
  const card = renderCard(issue(A, { validation: null }), { width: 70 });
  assert.equal(card.includes("Validazione"), false);
});

test("renderCards separa le card e dice quando non ce ne sono", () => {
  const out = renderCards([issue(A), issue(B)], { width: 70 });
  assert.equal((out.match(/aaaaaaaa|bbbbbbbb/g) || []).length, 2);
  assert.match(renderCards([], { width: 70 }), /nessuna issue/i);
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `node --test test/plugin-board-render.test.mjs`
Expected: FAIL — `wrapText is not a function`

- [ ] **Step 3: Implementare**

Aggiungere a `scripts/board-render.mjs`:

```js
// Word wrap that keeps the author's newlines: a description written on three paragraphs stays on
// three paragraphs. A word longer than the width is not broken — a chopped id is not an id.
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
    if (line !== "") out.push(line);
  }
  return out.length === 0 ? [""] : out;
}

// criteria reaches here in two shapes and neither is normalized in issues.json: an array at
// creation, a string at closure and on every issue that predates the array. Rendering one only
// would blank out half the tracker.
export function renderCriteria(criteria, width) {
  if (Array.isArray(criteria)) {
    const lines = [];
    for (const entry of criteria) {
      if (typeof entry !== "string" || entry.trim() === "") continue;
      const wrapped = wrapText(entry, width - 4);
      lines.push(`  ○ ${wrapped[0]}`);
      for (const rest of wrapped.slice(1)) lines.push(`    ${rest}`);
    }
    return lines;
  }
  if (typeof criteria === "string" && criteria.trim() !== "") {
    return wrapText(criteria, width - 2).map((line) => `  ${line}`);
  }
  return [];
}

// CORRETTO DOPO L'ESECUZIONE — la prima stesura faceva `new Date(iso)` e scartava solo NaN. Ma
// `new Date(null)` non è una data invalida: è l'epoch, e una issue senza `created_at` veniva
// datata 1 gennaio 1970 con l'aria di un dato vero.
function formatDate(iso) {
  if (typeof iso !== "string" || iso.trim() === "") return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** One issue, whole: nothing truncated, because in the side terminal the room is the reader's. */
export function renderCard(issue, { width = 100 } = {}) {
  const lines = [SEP(width)];
  const tier = issue.tier || "standard";
  const head = `● ${issue.status}`;
  const gap = Math.max(2, width - head.length - tier.length);
  lines.push(`${head}${" ".repeat(gap)}${tier}`);
  lines.push(...wrapText(issue.title, width));

  // CORRETTO DOPO L'ESECUZIONE — una description di soli spazi è truthy, e apriva un blocco vuoto
  // che si legge come un campo andato perso.
  if (typeof issue.description === "string" && issue.description.trim() !== "") {
    lines.push("", ...wrapText(issue.description, width));
  }

  const validation = issue.validation;
  if (validation && (validation.state || validation.criteria)) {
    lines.push("", `Validazione · ${validation.state || "unknown"}`);
    lines.push(...renderCriteria(validation.criteria, width));
  }

  lines.push("", issue.id, `creata ${formatDate(issue.created_at)} · aggiornata ${formatDate(issue.updated_at)}`);
  lines.push(SEP(width));
  return lines.join("\n");
}

// CORRETTO DOPO L'ESECUZIONE — ogni card apre e chiude con SEP, quindi unirle con "\n" stampava
// due righelli attaccati fra una card e l'altra. Il confine è uno: tre righelli per due card.
export function renderCards(issues, { width = 100 } = {}) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return "Nessuna issue da mostrare con questi filtri.";
  }
  return issues
    .map((issue, index) => {
      const card = renderCard(issue, { width });
      return index === 0 ? card : card.slice(card.indexOf("\n") + 1);
    })
    .join("\n");
}
```

- [ ] **Step 4: Lanciare i test e verificare che passino**

Run: `node --test test/plugin-board-render.test.mjs`
Expected: PASS, 11 test

- [ ] **Step 5: Commit**

```bash
git add scripts/board-render.mjs test/plugin-board-render.test.mjs
git commit -m "feat: card testuale con tutti i campi della issue"
```

---

### Task 3: Colore

**Files:**
- Modify: `scripts/board-render.mjs`
- Test: `test/plugin-board-render.test.mjs`

**Interfaces:**
- Produces: `paint(text, key, colors) -> string`, `STATUS_COLOR` (mappa stato → codice 256).
- I renderer dei Task 1 e 2 accettano `colors: boolean` nelle opzioni, default `false`.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
import { paint, STATUS_COLOR } from "../scripts/board-render.mjs";

test("paint avvolge solo quando il colore è acceso", () => {
  assert.equal(paint("x", "in_progress", false), "x", "spento non lascia byte di escape");
  const painted = paint("x", "in_progress", true);
  assert.match(painted, /\[38;5;\d+m x?/, "acceso usa ANSI 256");
  assert.match(painted, /\[0m$/, "e richiude");
  assert.equal(paint("x", "chiave-che-non-esiste", true), "x", "una chiave ignota non colora");
});

test("ogni stato ha un colore e nessuno dipende solo da quello", () => {
  for (const status of ["backlog", "in_progress", "in_review", "blocked", "done"]) {
    assert.equal(typeof STATUS_COLOR[status], "number", `manca il colore di ${status}`);
  }
  const graph = buildGraph([issue(A, { status: "blocked" })]);
  const coloured = renderChains({ graph, ...opts, counts: { open: 1, done: 0 }, colors: true });
  const plain = renderChains({ graph, ...opts, counts: { open: 1, done: 0 }, colors: false });
  assert.match(plain, /aaaaaaaa/, "senza colore l'informazione resta");
  assert.notEqual(coloured, plain);
  // eslint-disable-next-line no-control-regex
  assert.equal(/\[/.test(plain), false, "spento non emette escape");
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `node --test test/plugin-board-render.test.mjs`
Expected: FAIL — `paint is not a function`

- [ ] **Step 3: Implementare**

Aggiungere a `scripts/board-render.mjs`, e passare `colors` da `renderChains`/`renderCard` a `paint` sulle righe di stato e sugli id:

```js
// The palette of the visual spec, translated to ANSI 256 — supported by Windows Terminal and by
// every modern terminal without negotiation. Colour never carries information on its own: every
// status is written out in letters too, so NO_COLOR, a pipe or a dumb terminal lose nothing.
export const STATUS_COLOR = {
  backlog: 245,
  in_progress: 209,
  in_review: 104,
  blocked: 167,
  done: 107,
};

const EXTRA_COLOR = { id: 245, label: 245, flag: 209 };

export function paint(text, key, colors) {
  if (!colors) return text;
  const code = STATUS_COLOR[key] ?? EXTRA_COLOR[key];
  if (typeof code !== "number") return text;
  return `[38;5;${code}m${text}[0m`;
}
```

- [ ] **Step 4: Lanciare i test e verificare che passino**

Run: `node --test test/plugin-board-render.test.mjs`
Expected: PASS, 13 test

- [ ] **Step 5: Commit**

```bash
git add scripts/board-render.mjs test/plugin-board-render.test.mjs
git commit -m "feat: colore ANSI 256 opzionale nel renderer"
```

---

### Task 4: CLI one-shot

**Files:**
- Create: `scripts/board-cli.mjs`
- Test: `test/plugin-board-cli.test.mjs`

**Interfaces:**
- Consumes: `buildGraph` da `board-graph.mjs`; `renderChains`, `renderCards` da `board-render.mjs`.
- Produces: eseguibile `node scripts/board-cli.mjs [flag]`. Esporta `parseArgs(argv) -> {ok, value|error, code}` e `selectIssues(issues, filters) -> issue[]` per i test.

- [ ] **Step 1: Scrivere il test che fallisce**

In `test/plugin-board-cli.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../scripts/board-cli.mjs", import.meta.url));

function run(args, options = {}) {
  try {
    return {
      code: 0,
      out: execFileSync("node", [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...options.env } }),
    };
  } catch (error) {
    return { code: error.status, out: error.stdout };
  }
}

function tempProject(issues) {
  const dir = mkdtempSync(path.join(tmpdir(), "board-cli-"));
  writeFileSync(path.join(dir, "issues.json"), JSON.stringify({ issues }), "utf8");
  return dir;
}

const A = "aaaaaaaa-1111-1111-1111-111111111111";
const B = "bbbbbbbb-2222-2222-2222-222222222222";

function issue(id, extra = {}) {
  return {
    id, title: `titolo ${id.slice(0, 4)}`, description: "descrizione", status: "backlog",
    tier: "standard", depends_on: [], validation: null,
    created_at: "2026-07-30T10:00:00Z", updated_at: "2026-07-30T10:00:00Z", ...extra,
  };
}

test("stampa l'albero delle catene del progetto indicato", () => {
  const dir = tempProject([issue(A), issue(B, { depends_on: [A] })]);
  try {
    const { code, out } = run(["--project-dir", dir]);
    assert.equal(code, 0);
    assert.match(out, /catena · aaaaaaaa/);
    assert.equal(/\[/.test(out), false, "senza TTY il colore è spento");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("un progetto senza issues.json legge come tracker vuoto, non come errore", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "board-cli-"));
  try {
    const { code, out } = run(["--project-dir", dir]);
    assert.equal(code, 0);
    assert.match(out, /Nessuna issue aperta/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--project-dir inesistente esce con FILE_NOT_FOUND", () => {
  const { code, out } = run(["--project-dir", path.join(tmpdir(), "non-esiste-affatto")]);
  assert.equal(code, 1);
  const payload = JSON.parse(out);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "FILE_NOT_FOUND");
});

test("un flag sconosciuto esce con UNKNOWN_ARGUMENT, un flag noto senza valore con INVALID_ARGUMENT", () => {
  assert.equal(JSON.parse(run(["--sconosciuto"]).out).code, "UNKNOWN_ARGUMENT");
  assert.equal(JSON.parse(run(["--project-dir"]).out).code, "INVALID_ARGUMENT");
});

test("--view cards stampa le card, i filtri le riducono", () => {
  const dir = tempProject([
    issue(A, { status: "in_progress" }),
    issue(B, { status: "backlog", tier: "economy" }),
  ]);
  try {
    const all = run(["--project-dir", dir, "--view", "cards"]).out;
    assert.match(all, new RegExp(A));
    assert.match(all, new RegExp(B));

    const filtered = run(["--project-dir", dir, "--view", "cards", "--status", "in_progress"]).out;
    assert.match(filtered, new RegExp(A));
    assert.equal(filtered.includes(B), false);

    const byTier = run(["--project-dir", dir, "--view", "cards", "--tier", "economy"]).out;
    assert.match(byTier, new RegExp(B));

    const bySearch = run(["--project-dir", dir, "--view", "cards", "--search", "bbbb"]).out;
    assert.match(bySearch, new RegExp(B));
    assert.equal(bySearch.includes(A), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("le issue chiuse restano fuori finché non si passa --all", () => {
  const dir = tempProject([issue(A, { status: "done" }), issue(B)]);
  try {
    const standard = run(["--project-dir", dir, "--view", "cards"]).out;
    assert.equal(standard.includes(A), false);
    assert.match(run(["--project-dir", dir, "--view", "cards", "--all"]).out, new RegExp(A));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NO_COLOR valorizzato spegne il colore anche se lo si chiede", () => {
  const dir = tempProject([issue(A)]);
  try {
    const { out } = run(["--project-dir", dir], { env: { NO_COLOR: "1", FORCE_TTY: "1" } });
    assert.equal(/\[/.test(out), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `node --test test/plugin-board-cli.test.mjs`
Expected: FAIL — `Cannot find module .../board-cli.mjs`

- [ ] **Step 3: Implementare `scripts/board-cli.mjs`**

```js
#!/usr/bin/env node
// The board, as a command that prints and ends. This is the only file here with side effects:
// argument parsing, reading the tracker, deciding about colour, writing to stdout, watching.
// Everything about how it looks lives in board-render.mjs, which is pure and therefore testable
// without a browser, a server or a port.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildGraph } from "./board-graph.mjs";
import { renderChains, renderCards, IN_FLIGHT } from "./board-render.mjs";

const VALUE_FLAGS = ["--project-dir", "--view", "--status", "--tier", "--search", "--width"];
const BOOL_FLAGS = ["--watch", "--all", "--no-color", "--write-launcher"];

function fail(error, code) {
  process.stdout.write(`${JSON.stringify({ ok: false, error, code })}\n`);
  process.exit(1);
}

export function parseArgs(argv) {
  const value = { projectDir: process.cwd(), view: "chains", status: [], tier: [], search: null,
    width: null, watch: false, all: false, noColor: false, writeLauncher: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (BOOL_FLAGS.includes(flag)) {
      if (flag === "--watch") value.watch = true;
      if (flag === "--all") value.all = true;
      if (flag === "--no-color") value.noColor = true;
      if (flag === "--write-launcher") value.writeLauncher = true;
      continue;
    }
    if (!VALUE_FLAGS.includes(flag)) {
      return { ok: false, error: `Unknown argument: ${flag}`, code: "UNKNOWN_ARGUMENT" };
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      return { ok: false, error: `${flag} requires a value.`, code: "INVALID_ARGUMENT" };
    }
    i += 1;
    if (flag === "--project-dir") value.projectDir = path.resolve(next);
    if (flag === "--view") {
      if (next !== "chains" && next !== "cards") {
        return { ok: false, error: "--view accepts chains or cards.", code: "INVALID_ARGUMENT" };
      }
      value.view = next;
    }
    if (flag === "--status") value.status.push(next);
    if (flag === "--tier") value.tier.push(next);
    if (flag === "--search") value.search = next.toLowerCase();
    if (flag === "--width") {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isInteger(parsed) || parsed < 20) {
        return { ok: false, error: "--width must be an integer of at least 20.", code: "INVALID_ARGUMENT" };
      }
      value.width = parsed;
    }
  }
  return { ok: true, value };
}

// The tracker is read, never resolved next to this script: one installed copy serves every
// project. A project without issues.json is an empty tracker, not an error — the same reading
// issue-manager.mjs already gives it.
export function readIssues(projectDir) {
  const file = path.join(projectDir, "issues.json");
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? parsed : Array.isArray(parsed.issues) ? parsed.issues : [];
}

export function selectIssues(issues, { status, tier, search, all }) {
  return issues.filter((issue) => {
    if (!all && issue.status === "done") return false;
    if (status.length > 0 && !status.includes(issue.status)) return false;
    if (tier.length > 0 && !tier.includes(issue.tier || "standard")) return false;
    if (search) {
      const haystack = `${issue.id} ${issue.title} ${issue.description}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function draw(options) {
  const issues = readIssues(options.projectDir);
  const selected = selectIssues(issues, options);
  const colors = !options.noColor && !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
  const width = options.width ?? process.stdout.columns ?? 100;
  const shared = { width, colors };

  if (options.view === "cards" && !options.watch) {
    return renderCards(selected, shared);
  }

  const graph = buildGraph(issues);
  const chains = renderChains({
    graph,
    project: path.basename(options.projectDir),
    branch: "",
    counts: { open: issues.filter((i) => i.status !== "done").length,
              done: issues.filter((i) => i.status === "done").length },
    ...shared,
  });
  if (!options.watch) return chains;

  const inFlight = selected.filter((issue) => IN_FLIGHT.includes(issue.status));
  return inFlight.length === 0 ? chains : `${chains}\n${renderCards(inFlight, shared)}`;
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) fail(parsed.error, parsed.code);
  const options = parsed.value;

  if (!existsSync(options.projectDir) || !statSync(options.projectDir).isDirectory()) {
    fail(`Project directory not found: ${options.projectDir}`, "FILE_NOT_FOUND");
  }

  process.stdout.write(`${draw(options)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}

export { draw, main };
```

- [ ] **Step 4: Lanciare i test e verificare che passino**

Run: `node --test test/plugin-board-cli.test.mjs`
Expected: PASS, 7 test

- [ ] **Step 5: Commit**

```bash
git add scripts/board-cli.mjs test/plugin-board-cli.test.mjs
git commit -m "feat: board-cli one-shot con filtri e contratto di errore"
```

---

### Task 5: Watch

**Files:**
- Modify: `scripts/board-cli.mjs`
- Test: `test/plugin-board-cli.test.mjs`

**Interfaces:**
- Consumes: `draw(options)` dal Task 4.
- Produces: `--watch` che ridisegna a ogni scrittura su `issues.json` e non muore su un file transitorio.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
import { spawn } from "node:child_process";

test("--watch ridisegna quando il tracker cambia e sopravvive a un file illeggibile", async () => {
  const dir = tempProject([issue(A)]);
  const child = spawn("node", [CLI, "--project-dir", dir, "--watch", "--width", "80"], { encoding: "utf8" });
  let seen = "";
  child.stdout.on("data", (chunk) => { seen += chunk.toString(); });
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.match(seen, new RegExp("aaaaaaaa"), "il primo disegno arriva subito");

    writeFileSync(path.join(dir, "issues.json"), "{ questo non e' json", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(child.exitCode, null, "un file illeggibile non uccide il watch");

    writeFileSync(path.join(dir, "issues.json"), JSON.stringify({ issues: [issue(A), issue(B)] }), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.match(seen, new RegExp("bbbbbbbb"), "la issue nuova compare senza rilanciare");
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `node --test test/plugin-board-cli.test.mjs`
Expected: FAIL — il processo esce subito dopo il primo disegno, `bbbbbbbb` non arriva mai

- [ ] **Step 3: Implementare**

In `scripts/board-cli.mjs`, importare `watch` da `node:fs` e sostituire la coda di `main()`:

```js
// The watcher is the one board-server.mjs used, moved over as it was. It watches the DIRECTORY
// and not the file: issue-manager.mjs writes a temp file and renames it over the tracker, so a
// watcher bound to the file itself would keep pointing at the replaced inode. A single update
// raises several events, hence the debounce.
function watchProject(options) {
  const render = () => {
    let frame;
    try {
      frame = draw(options);
    } catch (error) {
      // A tracker caught mid-write is a transient, not a reason to die: a watcher that exits on
      // the first unreadable read is worse than no watcher.
      frame = `Tracker illeggibile: ${error.message}\nIn attesa della prossima scrittura…`;
    }
    process.stdout.write(`[2J[H${frame}\n`);
  };

  render();
  let pending = null;
  const watcher = watch(options.projectDir, (_event, filename) => {
    if (filename && !String(filename).includes("issues.json")) return;
    clearTimeout(pending);
    pending = setTimeout(render, 60);
  });
  process.on("SIGINT", () => {
    watcher.close();
    process.exit(0);
  });
}
```

e in `main()`:

```js
  if (options.watch) {
    watchProject(options);
    return;
  }
  process.stdout.write(`${draw(options)}\n`);
```

- [ ] **Step 4: Lanciare i test e verificare che passino**

Run: `node --test test/plugin-board-cli.test.mjs`
Expected: PASS, 8 test

- [ ] **Step 5: Commit**

```bash
git add scripts/board-cli.mjs test/plugin-board-cli.test.mjs
git commit -m "feat: board-cli --watch con ridisegno e resistenza al file transitorio"
```

---

### Task 6: Lanciatore in `.harness/`

**Files:**
- Modify: `scripts/board-cli.mjs`
- Test: `test/plugin-board-cli.test.mjs`

**Interfaces:**
- Produces: `--write-launcher` scrive `.harness/board.cmd` e `.harness/board.sh` nel progetto e stampa i percorsi.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
test("--write-launcher scrive i due lanciatori con il percorso corrente del plugin", () => {
  const dir = tempProject([issue(A)]);
  try {
    const { code } = run(["--project-dir", dir, "--write-launcher"]);
    assert.equal(code, 0);
    const cmd = readFileSync(path.join(dir, ".harness", "board.cmd"), "utf8");
    const sh = readFileSync(path.join(dir, ".harness", "board.sh"), "utf8");
    assert.match(cmd, /board-cli\.mjs/);
    assert.match(cmd, /--watch/);
    assert.match(sh, /board-cli\.mjs/);
    assert.match(sh, /^#!/, "lo script sh dichiara l'interprete");
    // Riscritto ogni volta: un aggiornamento di versione del plugin lo ripara da solo.
    const again = run(["--project-dir", dir, "--write-launcher"]);
    assert.equal(again.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `node --test test/plugin-board-cli.test.mjs`
Expected: FAIL — `ENOENT .harness/board.cmd`

- [ ] **Step 3: Implementare**

In `scripts/board-cli.mjs`, importare `mkdirSync`, `writeFileSync` da `node:fs` e aggiungere:

```js
// In a global install the plugin path is long and pinned to the version
// (…/.claude/plugins/cache/diemrt/harness/0.6.0/scripts/…). Fine for the agent, which receives it
// substituted at every invocation; useless for a person, and after a plugin update the command
// they saved points at a directory that no longer exists. The launcher is rewritten at every
// clock-in, so the update repairs it without anyone noticing.
function writeLauncher(projectDir) {
  const self = fileURLToPath(import.meta.url);
  const dir = path.join(projectDir, ".harness");
  mkdirSync(dir, { recursive: true });
  const cmd = `@echo off\r\nnode "${self}" --project-dir "%CD%" --watch %*\r\n`;
  const sh = `#!/bin/sh\nexec node "${self}" --project-dir "$PWD" --watch "$@"\n`;
  writeFileSync(path.join(dir, "board.cmd"), cmd, "utf8");
  writeFileSync(path.join(dir, "board.sh"), sh, "utf8");
  return [path.join(dir, "board.cmd"), path.join(dir, "board.sh")];
}
```

e in `main()`, prima del disegno:

```js
  if (options.writeLauncher) {
    const written = writeLauncher(options.projectDir);
    process.stdout.write(`${written.join("\n")}\n`);
    return;
  }
```

Aggiungere `import { fileURLToPath } from "node:url";` in testa al file.

- [ ] **Step 4: Lanciare i test e verificare che passino**

Run: `npm run test`
Expected: PASS, suite intera

- [ ] **Step 5: Commit**

```bash
git add scripts/board-cli.mjs test/plugin-board-cli.test.mjs
git commit -m "feat: lanciatore .harness/board per il watch da terminale esterno"
```

---

### Task 7: Demolizione

**Files:**
- Delete: `scripts/board-server.mjs`, `scripts/board.js`, `scripts/board.css`, `scripts/board.html`, `test/plugin-board.test.mjs`, `proposals/board-minimal.html`
- Modify: `test/smoke.test.mjs:77`, `scripts/board-graph.mjs:5`, `proposals/README.md`, `.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: la CLI completa dei Task 4-6, che deve funzionare **prima** che la pagina venga rimossa.
- Produces: un repository in cui nessun file, manifest o test nomina più la pagina.

- [ ] **Step 1: Aggiornare il test che elenca i componenti del plugin**

In `test/smoke.test.mjs:77`, sostituire `"scripts/board-server.mjs"` con `"scripts/board-cli.mjs"` e `"scripts/board-render.mjs"`.

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `node --test test/smoke.test.mjs`
Expected: FAIL — `scripts/board-cli.mjs` esiste ma il test elenca ancora il server, oppure il contrario a seconda dell'ordine

- [ ] **Step 3: Cancellare e ripulire**

```bash
git rm scripts/board-server.mjs scripts/board.js scripts/board.css scripts/board.html
git rm test/plugin-board.test.mjs proposals/board-minimal.html
```

In `scripts/board-graph.mjs:5` il commento cita `board.js` come «the app (fetch, SSE, render, events)»: sostituire con `board-cli.mjs` (lettura, filtri, watch) e `board-render.mjs` (testo). È l'unica modifica ammessa a quel file.

In `proposals/README.md`: rimuovere la sezione `board-minimal.html`. La decisione che la teneva in sospeso — vendorizzare le dipendenze della pagina o cambiare interfaccia — è chiusa: la pagina non c'è più.

In `.claude-plugin/plugin.json`: la `description` dice «live issue board». Sostituire con «issue board in the terminal».

- [ ] **Step 4: Lanciare la suite e verificare che passi**

Run: `npm run test`
Expected: PASS. Nessun test deve più avviare un server o aprire una porta.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rimuovere la pagina del board e il suo server"
```

---

### Task 8: Documentazione

**Files:**
- Modify: `commands/board.md`, `skills/harness/references/board.md`, `skills/harness/SKILL.md`, `README.md`

**Interfaces:**
- Consumes: il comportamento reale della CLI dei Task 4-6. La documentazione descrive ciò che lo script fa, non ciò che lo spec sperava.

- [ ] **Step 1: Riscrivere `commands/board.md`**

Sparisce tutto il ciclo di vita: avvio in background, lettura della riga JSON, controllo di `projectDir`, `pid`, `port`, `stop`, `PORT_IN_USE`. Resta: come si invoca, i flag, i tre codici di errore, e la regola che dentro la sessione si usa solo la vista catene mentre le card sono per il terminale esterno.

- [ ] **Step 2: Riscrivere `skills/harness/references/board.md`**

La sezione «Dipendenze della pagina» descrive le CDN come trade-off scelto: va sostituita, non corretta ai margini. Al suo posto: i tre file, il contratto del renderer puro, l'interfaccia da riga di comando, il lanciatore, il comportamento del watch.

- [ ] **Step 3: Aggiornare `skills/harness/SKILL.md` in tre punti**

1. Clock-in, passo 4: «avvia il board e stampa l'URL» → esegui `board-cli.mjs --write-launcher`, poi stampa l'albero delle catene una volta.
2. Clock-out: sparisce «ferma il board server avviato al clock-in».
3. Regola nuova, che sostituisce il live: dopo ogni transizione di stato — `in_progress`, `in_review`, `pass`/`fail`, commit — ristampa l'albero compatto. È l'informazione che l'agente possiede prima di chiunque altro.

- [ ] **Step 4: Aggiornare `README.md`**

Righe 5, 33, 55 e 84 parlano di «live issue board» e di un comando che «starts the live issue board and prints its URL once; `stop` shuts it down». Riscrivere su ciò che il comando fa adesso.

- [ ] **Step 5: Verificare e committare**

Run: `npm run test`
Expected: PASS — `test/plugin-skill.test.mjs` verifica che ogni link fra le reference risolva e che ogni reference sia raggiungibile da `SKILL.md`.

```bash
git add commands/board.md skills/harness/references/board.md skills/harness/SKILL.md README.md
git commit -m "docs: allineare comando, skill e README al board a terminale"
```

---

## Self-Review

**Copertura dello spec:** §1 architettura → Task 1-6. §2 due superfici → Task 4 (`view`) e Task 8 punto 3 (regola di ristampa). §3 vista catene → Task 1. §4 vista card → Task 2. §5 CLI → Task 4. §6 watch → Task 5. §7 lanciatore → Task 6. §8 colore → Task 3. §9 test → dentro ogni task. §10 documentazione → Task 8; riconciliazione del tracker → fuori dal piano, è un'operazione sul tracker e non sul codice, eseguita prima del Task 1.

**Coerenza dei nomi:** `renderChains`, `renderCards`, `renderCard`, `wrapText`, `renderCriteria`, `paint`, `STATUS_COLOR`, `IN_FLIGHT`, `SEP`, `shortId`, `components` sono definiti nei Task 1-3 e usati con la stessa firma nei Task 4-5. `draw(options)` è definita nel Task 4 e riusata nel Task 5. `parseArgs` restituisce sempre `{ok, value|error, code}`.

**Rischio noto, dichiarato qui e non nascosto:** il Task 5 verifica il watch con attese temporali (`setTimeout`). Su una macchina carica può diventare instabile. Se succede, l'alternativa è verificare il watcher a livello di funzione invece che di processo — non allungare le attese finché il test smette di lampeggiare.
