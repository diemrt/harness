# L'ergonomia si emette, non si serve — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire il board servito da un processo con tre artefatti emessi — una riga di stato, un insieme di file markdown, un grafo Mermaid — estraendo prima il calcolo del grafo in un modulo con due consumatori.

**Architecture:** `scripts/tracker-graph.mjs` diventa l'unico posto in cui vive il calcolo sul grafo delle issue (prontezza, cicli, dipendenze rotte, allerte, catene). `status-cli.mjs` lo consuma per il riepilogo e per il nuovo `--oneline`; `scripts/export-md.mjs` lo consuma per emettere `.harness/export/`. `board-server.mjs` e `board.html` vengono rimossi. Nessun file di dati cambia: `issues.json` e il contratto di `issue-manager.mjs` restano identici.

**Tech Stack:** Node.js ≥ 18, ESM (`"type": "module"`), zero dipendenze runtime, test runner integrato (`node --test`).

Spec: [../specs/2026-08-13-ergonomia-emessa-design.md](../specs/2026-08-13-ergonomia-emessa-design.md)
Analisi che l'ha originata: [../analisi/2026-08-13-substrato-del-tracker.md](../analisi/2026-08-13-substrato-del-tracker.md)

## Global Constraints

- **Node ≥ 18**, ESM. `package.json` dichiara `"type": "module"`, e gli script si importano fra loro con path relativi ed estensione (`./tracker-graph.mjs`).
- **Zero dipendenze runtime.** `package.json` non ha e non deve acquisire un campo `dependencies`. Nessun parser YAML, nessuna libreria di templating: si scrive il poco che serve.
- **Test runner:** `npm test` esegue `node --test`. I test stanno in `test/<nome>.test.mjs` e usano `node:test` e `node:assert/strict`.
- **Lingua:** commenti nel codice in inglese, testo rivolto all'utente e documentazione in `skills/` e `commands/` in italiano. È la convenzione dei file esistenti: seguire quella del file che si sta toccando.
- **Impronta nel progetto:** harness scrive solo `issues.json` e `.harness/`. Non scrive mai un `.gitignore`, in nessun caso.
- **Contratti di output**, diversi per script e non negoziabili:
  - `export-md.mjs` → **una sola riga JSON** su stdout, `{"ok":true,"data":…}` con exit 0 oppure `{"ok":false,"error":…,"code":…}` con exit 1. Mai niente su stderr.
  - `status-cli.mjs` → testo, mai JSON, mai stderr.
  - `status-cli.mjs --oneline` → **esce sempre 0**, non stampa mai un errore, mai stderr, nessun carattere fuori da ASCII.
- **Ogni componente nuovo del plugin è invocabile solo dopo un riavvio della sessione di Claude Code** (`CLAUDE.md`). Vale per il comando aggiunto nel Task 9.
- **`issues.json` non si modifica mai a mano**, nemmeno nei test: i test che hanno bisogno di un tracker scrivono in una directory temporanea.

---

### Task 1: `tracker-graph.mjs` — estrazione del calcolo

Estrazione pura: il comportamento non cambia, e i test esistenti lo dimostrano restando verdi senza essere toccati.

**Files:**
- Create: `scripts/tracker-graph.mjs`
- Create: `test/plugin-tracker-graph.test.mjs`
- Modify: `scripts/status-cli.mjs:49-129` (rimozione delle funzioni estratte), `scripts/status-cli.mjs:16-19` (import)

**Interfaces:**
- Consumes: niente.
- Produces: `dependsOn(issue) -> string[]`, `indexById(issues) -> Map<string, object>`, `emptyCounts() -> {backlog,in_progress,in_review,blocked,done}`, `countByStatus(issues) -> counts`, `shortId(id) -> string`, `danglingDeps(issue, byId) -> string[]`, `isWorkable(issue, byId) -> boolean`, `findCycle(issues, byId) -> string[]|null`, `buildAlerts(issues, byId, counts, workableTotal) -> string[]`.

- [ ] **Step 1: Write the failing test**

Crea `test/plugin-tracker-graph.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAlerts,
  countByStatus,
  danglingDeps,
  dependsOn,
  findCycle,
  indexById,
  isWorkable,
  shortId,
} from "../scripts/tracker-graph.mjs";

const issue = (id, status, deps = []) => ({
  id,
  title: `issue ${id}`,
  status,
  depends_on: deps,
});

test("dependsOn tratta la chiave assente come lista vuota", () => {
  assert.deepEqual(dependsOn({ id: "a" }), []);
  assert.deepEqual(dependsOn({ id: "a", depends_on: ["b"] }), ["b"]);
});

test("countByStatus ignora uno stato che non conosce", () => {
  const counts = countByStatus([issue("a", "backlog"), issue("b", "done"), issue("c", "invented")]);
  assert.equal(counts.backlog, 1);
  assert.equal(counts.done, 1);
  assert.equal(Object.hasOwn(counts, "invented"), false);
});

test("shortId taglia a otto caratteri", () => {
  assert.equal(shortId("663a70ae-48ba-4e41-b48d-27af3dc7843b"), "663a70ae");
  assert.equal(shortId(null), "");
});

test("isWorkable vuole backlog e tutte le dipendenze chiuse", () => {
  const issues = [issue("a", "done"), issue("b", "backlog", ["a"]), issue("c", "backlog", ["b"])];
  const byId = indexById(issues);
  assert.equal(isWorkable(issues[1], byId), true);
  assert.equal(isWorkable(issues[2], byId), false);
  assert.equal(isWorkable(issues[0], byId), false);
});

test("una dipendenza inesistente rende la issue non lavorabile e viene segnalata", () => {
  const issues = [issue("b", "backlog", ["ghost"])];
  const byId = indexById(issues);
  assert.deepEqual(danglingDeps(issues[0], byId), ["ghost"]);
  assert.equal(isWorkable(issues[0], byId), false);
});

test("findCycle vede un ciclo fra issue aperte e ignora quelli fra chiuse", () => {
  const open = [issue("a", "backlog", ["b"]), issue("b", "backlog", ["a"])];
  assert.notEqual(findCycle(open, indexById(open)), null);

  const closed = [issue("a", "done", ["b"]), issue("b", "done", ["a"])];
  assert.equal(findCycle(closed, indexById(closed)), null);
});

test("buildAlerts segnala il backlog fermo", () => {
  const issues = [issue("a", "in_progress"), issue("b", "backlog", ["a"])];
  const byId = indexById(issues);
  const alerts = buildAlerts(issues, byId, countByStatus(issues), 0);
  assert.equal(alerts.some((a) => a.includes("backlog fermo")), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/plugin-tracker-graph.test.mjs
```

Atteso: FAIL — `Cannot find module '../scripts/tracker-graph.mjs'`.

- [ ] **Step 3: Create the module**

Crea `scripts/tracker-graph.mjs`. Le funzioni sono **spostate verbatim** da `status-cli.mjs` (righe 49-129), con i loro commenti: sono il motivo per cui la regola è scritta così, e vanno col codice.

```js
// Pure graph computation over the tracker. Extracted from status-cli.mjs when a second consumer
// appeared: the markdown export needs the same readiness, cycle and chain answers the summary
// needs, and two copies of the 1-WIP rule would drift apart without anything saying so.
//
// Nothing here reads a file, writes a file, or renders anything. Every function takes issues and
// returns data.

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
```

- [ ] **Step 4: Rewire `status-cli.mjs`**

In `scripts/status-cli.mjs`, aggiungi l'import dopo quello di `node:url` (riga 19):

```js
import {
  buildAlerts,
  countByStatus,
  dependsOn,
  indexById,
  isWorkable,
  shortId,
} from "./tracker-graph.mjs";
```

Cancella dal file le definizioni di `emptyCounts`, `dependsOn`, `danglingDeps`, `isWorkable`, `findCycle`, `buildAlerts` (righe 49-129) e la definizione di `shortId` (righe 71-73).

`shortId` era esportato da `status-cli.mjs` e altri test lo importano da lì: **mantieni la superficie pubblica invariata** aggiungendo, subito dopo l'import, la riga

```js
export { shortId };
```

Riscrivi `buildSnapshot` perché usi le funzioni importate (unica modifica: `emptyCounts` + ciclo diventano `countByStatus`, `new Map(...)` diventa `indexById`):

```js
export function buildSnapshot(issues) {
  const counts = countByStatus(issues);

  const inFlight = issues
    .filter((issue) => IN_FLIGHT_ORDER.includes(issue.status))
    .sort(
      (a, b) =>
        IN_FLIGHT_ORDER.indexOf(a.status) - IN_FLIGHT_ORDER.indexOf(b.status) ||
        String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))
    );

  const byId = indexById(issues);

  const workableAll = issues
    .filter((issue) => isWorkable(issue, byId))
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));

  return {
    counts,
    inFlight,
    workable: workableAll.slice(0, WORKABLE_SHOWN),
    workableTotal: workableAll.length,
    alerts: buildAlerts(issues, byId, counts, workableAll.length),
  };
}
```

- [ ] **Step 5: Run the whole suite**

```bash
npm test
```

Atteso: PASS su tutto, **inclusi i test di `status-cli` che non hai toccato**. Se `test/plugin-status-cli.test.mjs` fallisce, l'estrazione ha cambiato un comportamento e va corretta l'estrazione, non il test.

- [ ] **Step 6: Commit**

```bash
git add scripts/tracker-graph.mjs scripts/status-cli.mjs test/plugin-tracker-graph.test.mjs
git commit -m "refactor: il calcolo sul grafo diventa un modulo con due consumatori"
```

---

### Task 2: `chains()` — le catene, che nessuno calcolava

La catena è la componente connessa del grafo `depends_on`, ed è la definizione che `SKILL.md` dà della regola 1-WIP. Oggi non la calcola nessuno: il board mostra le dipendenze come lista.

**Files:**
- Modify: `scripts/tracker-graph.mjs` (aggiunta in coda)
- Modify: `test/plugin-tracker-graph.test.mjs` (aggiunta in coda)

**Interfaces:**
- Consumes: `dependsOn` dal Task 1.
- Produces: `chains(issues) -> string[][]` — array di gruppi di id. I gruppi seguono l'ordine in cui le issue compaiono in `issues`, e dentro un gruppo gli id seguono l'ordine di scoperta: **deterministico**, perché un export che cambia a ogni giro produce un diff falso.

- [ ] **Step 1: Write the failing test**

Aggiungi in coda a `test/plugin-tracker-graph.test.mjs`:

```js
import { chains } from "../scripts/tracker-graph.mjs";

test("chains raggruppa le issue collegate, in qualunque verso", () => {
  const issues = [
    issue("a", "backlog"),
    issue("b", "backlog", ["a"]),
    issue("c", "backlog"),
    issue("d", "backlog", ["c"]),
    issue("e", "backlog"),
  ];
  assert.deepEqual(chains(issues), [["a", "b"], ["c", "d"], ["e"]]);
});

test("chains ignora gli archi che escono dall'insieme ricevuto", () => {
  const issues = [issue("b", "backlog", ["fuori"]), issue("c", "backlog")];
  assert.deepEqual(chains(issues), [["b"], ["c"]]);
});

test("chains è deterministico", () => {
  const issues = [issue("a", "backlog"), issue("b", "backlog", ["a"])];
  assert.deepEqual(chains(issues), chains(issues));
});

test("chains su lista vuota torna lista vuota", () => {
  assert.deepEqual(chains([]), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/plugin-tracker-graph.test.mjs
```

Atteso: FAIL — `chains is not a function` (l'import di un nome inesistente da un modulo ESM è un errore di sintassi al caricamento: il file intero fallisce, ed è il segnale corretto).

- [ ] **Step 3: Implement**

Aggiungi in coda a `scripts/tracker-graph.mjs`:

```js
// A chain is the connected component of the depends_on graph, walked in BOTH directions: SKILL.md
// defines it that way, because two issues joined by a path are the same chain no matter which of
// them declared the edge. Only edges whose two ends are inside the given list are followed, so a
// caller can pass a filtered set (the open issues, say) and get the components of that set.
//
// Iteration follows the order of `issues`, not of a Map or a Set: the export is committed or
// diffed, and a group order that shifts between runs would produce a diff that means nothing.
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/tracker-graph.mjs test/plugin-tracker-graph.test.mjs
git commit -m "feat: le catene di dipendenza diventano un dato calcolato"
```

---

### Task 3: `status-cli.mjs --oneline`

La riga che copre il 20% dell'uso del board: i conteggi, sempre visibili, senza un processo da tenere vivo.

**Files:**
- Modify: `scripts/status-cli.mjs` (nuove costanti, `renderOneline`, `main`, `USAGE`)
- Modify: `test/plugin-status-cli.test.mjs` (aggiunta in coda)

**Interfaces:**
- Consumes: `countByStatus`, `buildAlerts`, `indexById`, `isWorkable` dal Task 1 (già importati).
- Produces: `renderOneline(snapshot) -> string` esportato per i test; il flag `--oneline` su `status-cli.mjs`.

- [ ] **Step 1: Write the failing test**

Aggiungi in coda a `test/plugin-status-cli.test.mjs` (l'import di `renderOneline` va aggiunto all'import esistente da `../scripts/status-cli.mjs`):

```js
test("renderOneline elenca gli stati non vuoti in ordine di lettura", () => {
  const line = renderOneline({
    counts: { backlog: 4, in_progress: 1, in_review: 2, blocked: 0, done: 12 },
    alerts: [],
  });
  assert.equal(line, "1 in corso | 2 in verifica | 4 backlog | 12 chiuse");
});

test("renderOneline omette gli stati a zero", () => {
  const line = renderOneline({
    counts: { backlog: 3, in_progress: 1, in_review: 0, blocked: 0, done: 9 },
    alerts: [],
  });
  assert.equal(line, "1 in corso | 3 backlog | 9 chiuse");
});

test("renderOneline aggiunge ! solo quando ci sono allerte", () => {
  const counts = { backlog: 1, in_progress: 0, in_review: 0, blocked: 0, done: 0 };
  assert.equal(renderOneline({ counts, alerts: [] }), "1 backlog");
  assert.equal(renderOneline({ counts, alerts: ["ciclo nei depends_on: a b"] }), "1 backlog !");
});

test("renderOneline su tracker vuoto è la riga vuota", () => {
  const line = renderOneline({
    counts: { backlog: 0, in_progress: 0, in_review: 0, blocked: 0, done: 0 },
    alerts: [],
  });
  assert.equal(line, "");
});

test("renderOneline non produce caratteri fuori da ASCII", () => {
  const line = renderOneline({
    counts: { backlog: 1, in_progress: 1, in_review: 1, blocked: 1, done: 1 },
    alerts: ["x"],
  });
  assert.match(line, /^[\x20-\x7e]*$/);
});
```

E i test sul comportamento del processo, che sono il cuore del contratto invertito. Usa lo stesso helper con cui il file esegue già lo script (se il file usa `execFileSync`/`spawnSync` con un `cwd` temporaneo, riusa quello; qui la forma esplicita):

```js
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/status-cli.mjs", import.meta.url));

function runOneline(projectDir) {
  return spawnSync(process.execPath, [SCRIPT, "--oneline", "--project-dir", projectDir], {
    encoding: "utf8",
  });
}

test("--oneline esce 0 e tace su tracker assente", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-oneline-"));
  const run = runOneline(dir);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, "");
  assert.equal(run.stdout.trim(), "");
});

test("--oneline esce 0 e tace su tracker malformato", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-oneline-"));
  writeFileSync(path.join(dir, "issues.json"), "{ non e' json");
  const run = runOneline(dir);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, "");
  assert.equal(run.stdout.trim(), "");
});

test("--oneline stampa i conteggi di un tracker vero", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-oneline-"));
  writeFileSync(
    path.join(dir, "issues.json"),
    JSON.stringify({
      schema_version: 3,
      issues: [
        { id: "a", title: "t", status: "in_progress", depends_on: [] },
        { id: "b", title: "t", status: "done", depends_on: [] },
      ],
    })
  );
  const run = runOneline(dir);
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), "1 in corso | 1 chiuse");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/plugin-status-cli.test.mjs
```

Atteso: FAIL — `renderOneline` non esiste, e il processo rifiuta `--oneline` perché `parseArgs` gira in modalità `strict`.

- [ ] **Step 3: Implement `renderOneline`**

In `scripts/status-cli.mjs`, aggiungi le costanti accanto a `BAR_ORDER` (riga 37):

```js
// Reading order of the one-line summary: what is moving first, what is waiting last. It is NOT
// BAR_ORDER — the bar fills left to right as the project advances, this line answers "where are we
// right now", and closed work is the least urgent thing on it.
export const ONELINE_ORDER = ["in_progress", "in_review", "blocked", "backlog", "done"];

export const ONELINE_LABEL = {
  in_progress: "in corso",
  in_review: "in verifica",
  blocked: "bloccate",
  backlog: "backlog",
  done: "chiuse",
};
```

E la funzione, accanto a `renderSnapshot`:

```js
// One line for a host status bar: tmux, starship, a shell prompt, the Claude Code statusLine.
// ASCII only and no ANSI — the full-screen summary can afford box drawing because it lands in a
// markdown code block, this lands in a prompt where the encoding is not guaranteed.
//
// An empty tracker prints nothing at all. A status bar saying "zero" spends the row it was given
// on the absence of news.
export function renderOneline(snapshot) {
  const parts = ONELINE_ORDER.filter((status) => snapshot.counts[status] > 0).map(
    (status) => `${snapshot.counts[status]} ${ONELINE_LABEL[status]}`
  );
  if (parts.length === 0) return "";
  return `${parts.join(" | ")}${snapshot.alerts.length > 0 ? " !" : ""}`;
}
```

- [ ] **Step 4: Wire the flag into `main()`**

In `main()`, aggiungi l'opzione a `parseArgs`:

```js
        "project-dir": { type: "string" },
        oneline: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
```

E, **subito dopo il ramo `values.help`**, il ramo che non può fallire. Va prima di `resolveProjectDir`, che chiama `fail()` e uscirebbe 1:

```js
  // Inverted output contract, on purpose. This command runs on every refresh of a host status bar,
  // and an error message repeated there is worse than silence: it occupies the row that existed to
  // show the work, and cannot be dismissed. So it never fails, never writes to stderr, and degrades
  // to an empty line. Do not "fix" this back to the contract of the rest of the CLI.
  if (values.oneline) {
    process.stdout.write(`${onelineFor(values["project-dir"])}\n`);
    return;
  }
```

E la funzione che raccoglie tutta la degradazione in un punto solo, accanto a `resolveProjectDir`:

```js
function onelineFor(projectDirArg) {
  try {
    const dir = path.resolve(projectDirArg ?? process.cwd());
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return "";
    const trackerPath = path.join(dir, "issues.json");
    // A missing tracker is not an error: issue-manager.mjs reads it as an empty tracker, and so
    // does this. The line comes out empty because every count is zero, not because we gave up.
    if (!existsSync(trackerPath)) return "";
    const data = JSON.parse(readFileSync(trackerPath, "utf8"));
    const issues = Array.isArray(data.issues) ? data.issues : [];
    return renderOneline(buildSnapshot(issues));
  } catch {
    return "";
  }
}
```

- [ ] **Step 5: Document the flag in `USAGE`**

Sostituisci le prime due righe di `USAGE` e aggiungi la spiegazione del flag:

```js
const USAGE = [
  "Usage:",
  "  node status-cli.mjs [--project-dir <path>] [--oneline] [--help]",
  "",
  "Prints one screen of tracker status: counts, what is in flight, what can be taken now.",
  "Output is text, not JSON, and nothing is ever written to stderr.",
  "",
  "--project-dir  directory holding issues.json (default: the current directory).",
  "               A project without issues.json reads as an empty tracker, not an error.",
  "--oneline      one ASCII line of counts for a host status bar (tmux, starship, a shell",
  "               prompt, the Claude Code statusLine). Always exits 0 and stays silent on",
  "               any problem: an error repeated on every refresh is worse than no line.",
  "",
  "Exit codes: 0 on success and on an empty tracker; 1 on a missing project directory, an",
  "unreadable issues.json, or an unknown flag. --oneline always exits 0.",
  "",
].join("\n");
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm test
```

Atteso: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/status-cli.mjs test/plugin-status-cli.test.mjs
git commit -m "feat: --oneline, una riga di conteggi per una barra di stato"
```

---

### Task 4: `frontmatter.mjs` — l'emettitore YAML

Il frontmatter deve portare `tasks` e `validation` come **struttura**, non come stringhe: è il criterio per cui gli altri tracker sono stati scartati, e non va perso nella proiezione. Servirebbe un serializzatore YAML, e harness non ha dipendenze: si scrive il poco che serve, con ogni scalare passato da `JSON.stringify`, che produce uno scalare YAML valido e chiude ogni buco di escaping.

**Files:**
- Create: `scripts/frontmatter.mjs`
- Create: `test/plugin-frontmatter.test.mjs`

**Interfaces:**
- Consumes: niente.
- Produces: `toFrontmatter(record) -> string` — il blocco completo, delimitatori `---` inclusi, senza newline finale.

- [ ] **Step 1: Write the failing test**

Crea `test/plugin-frontmatter.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { toFrontmatter } from "../scripts/frontmatter.mjs";

test("scalari, null e liste vuote", () => {
  const out = toFrontmatter({ id: "a", tier: null, checked: true, n: 3, covers: [] });
  assert.equal(
    out,
    ['---', 'id: "a"', "tier: null", "checked: true", "n: 3", "covers: []", "---"].join("\n")
  );
});

test("una lista di stringhe va a blocco", () => {
  const out = toFrontmatter({ depends_on: ["a", "b"] });
  assert.equal(out, ["---", "depends_on:", '  - "a"', '  - "b"', "---"].join("\n"));
});

test("una lista di oggetti mette la prima chiave sul trattino", () => {
  const out = toFrontmatter({
    tasks: [{ id: 1, short_title: "primo", checked: false }],
  });
  assert.equal(
    out,
    ["---", "tasks:", "  - id: 1", '    short_title: "primo"', "    checked: false", "---"].join("\n")
  );
});

test("un oggetto annidato che contiene una lista di oggetti", () => {
  const out = toFrontmatter({
    validation: { criteria: ["c1"], tasks: [{ id: 1, checked: true }], state: "pass" },
  });
  assert.equal(
    out,
    [
      "---",
      "validation:",
      "  criteria:",
      '    - "c1"',
      "  tasks:",
      "    - id: 1",
      "      checked: true",
      '  state: "pass"',
      "---",
    ].join("\n")
  );
});

test("le stringhe difficili non rompono il blocco", () => {
  const out = toFrontmatter({ title: 'con "virgolette"\ne un a capo: e due punti' });
  assert.equal(out.split("\n").length, 3, "il valore resta su una riga sola");
  assert.match(out, /^title: "con \\"virgolette\\"\\ne un a capo: e due punti"$/m);
});

test("un oggetto vuoto non produce una chiave senza valore", () => {
  assert.equal(toFrontmatter({ validation: {} }), ["---", "validation: {}", "---"].join("\n"));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/plugin-frontmatter.test.mjs
```

Atteso: FAIL — `Cannot find module '../scripts/frontmatter.mjs'`.

- [ ] **Step 3: Implement**

Crea `scripts/frontmatter.mjs`:

```js
// A YAML emitter for exactly one shape: the issue record. Harness ships with zero dependencies and
// this is not the place to acquire the first one — but hand-rolled YAML is where escaping bugs
// live, so every scalar goes through JSON.stringify. JSON is a subset of YAML: a JSON string
// literal IS a valid YAML double-quoted scalar, quotes, newlines, colons and all.
//
// Block style, not flow style: the frontmatter is read by a person often enough to be worth the
// extra lines, and by a content collection that does not care either way.

function scalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Returns what follows the "key:" — either " value" on the same line, or a newline and an indented
// block. The caller owns the key, this owns everything after the colon.
function emitValue(value, indent) {
  if (Array.isArray(value)) {
    if (value.length === 0) return " []";
    const pad = " ".repeat(indent + 2);
    const items = value.map((item) => {
      if (!isPlainObject(item)) return `${pad}- ${scalar(item)}`;
      const entries = Object.entries(item);
      if (entries.length === 0) return `${pad}- {}`;
      const [firstKey, firstValue] = entries[0];
      return [
        `${pad}- ${firstKey}:${emitValue(firstValue, indent + 4)}`,
        ...entries.slice(1).map(([key, val]) => `${pad}  ${key}:${emitValue(val, indent + 4)}`),
      ].join("\n");
    });
    return `\n${items.join("\n")}`;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return " {}";
    const pad = " ".repeat(indent + 2);
    return `\n${entries.map(([key, val]) => `${pad}${key}:${emitValue(val, indent + 2)}`).join("\n")}`;
  }

  return ` ${scalar(value)}`;
}

export function toFrontmatter(record) {
  const body = Object.entries(record).map(([key, value]) => `${key}:${emitValue(value, 0)}`);
  return ["---", ...body, "---"].join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/frontmatter.mjs test/plugin-frontmatter.test.mjs
git commit -m "feat: emettitore YAML per il frontmatter dell'export"
```

---

### Task 5: `export-md.mjs` — il documento di una issue

**Files:**
- Create: `scripts/export-md.mjs`
- Create: `test/plugin-export-md.test.mjs`

**Interfaces:**
- Consumes: `toFrontmatter` (Task 4), `shortId` e `dependsOn` (Task 1).
- Produces: `issueRecord(issue) -> object`, `issueBody(issue, titleByShortId) -> string`, `issueDocument(issue, titleByShortId) -> string`. `titleByShortId` è una `Map<string,string>` da `short_id` a titolo, usata per rendere leggibili i link fra file.

- [ ] **Step 1: Write the failing test**

Crea `test/plugin-export-md.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { issueBody, issueDocument, issueRecord } from "../scripts/export-md.mjs";

const FULL = {
  id: "663a70ae-48ba-4e41-b48d-27af3dc7843b",
  title: "Un titolo",
  description: "Primo paragrafo.\n\nSecondo paragrafo.",
  status: "in_review",
  tier: "standard",
  depends_on: ["12ab34cd-0000-0000-0000-000000000000"],
  covers: ["abc1234"],
  tasks: [
    { id: 1, short_title: "fatto", full_description: "d1", checked: true },
    { id: 2, short_title: "da fare", full_description: "d2", checked: false },
  ],
  validation: {
    criteria: ["il comando esce 0"],
    tasks: [{ id: 1, short_title: "criterio", full_description: "d", checked: false }],
    state: "unknown",
  },
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-02T10:00:00.000Z",
};

test("issueRecord porta il record intero, con le strutture intatte", () => {
  const record = issueRecord(FULL);
  assert.equal(record.id, FULL.id);
  assert.equal(record.short_id, "663a70ae");
  assert.deepEqual(record.tasks, FULL.tasks, "i task restano oggetti, non stringhe");
  assert.deepEqual(record.validation, FULL.validation, "la validazione resta annidata");
  assert.deepEqual(record.depends_on, FULL.depends_on);
  assert.deepEqual(record.covers, FULL.covers);
});

test("issueRecord materializza i default di una issue scritta prima dei campi", () => {
  const record = issueRecord({ id: "aaaaaaaa-0000-0000-0000-000000000000", title: "t", status: "backlog", description: "d" });
  assert.deepEqual(record.depends_on, []);
  assert.deepEqual(record.covers, []);
  assert.deepEqual(record.tasks, []);
  assert.equal(record.validation, null);
  assert.equal(record.tier, null);
});

test("issueBody rende prosa, criteri, task e dipendenze", () => {
  const titles = new Map([["12ab34cd", "La dipendenza"]]);
  const body = issueBody(FULL, titles);
  assert.match(body, /^# Un titolo$/m);
  assert.match(body, /^Primo paragrafo\.$/m);
  assert.match(body, /^- il comando esce 0$/m);
  assert.match(body, /^- \[x\] fatto$/m);
  assert.match(body, /^- \[ \] da fare$/m);
  assert.match(body, /^- \[La dipendenza\]\(\.\/12ab34cd\.md\)$/m);
});

test("una dipendenza fuori dal tracker si vede, non sparisce", () => {
  const body = issueBody(FULL, new Map());
  assert.match(body, /12ab34cd \(non nel tracker\)/);
});

test("una issue senza validazione non stampa la sezione", () => {
  const body = issueBody({ ...FULL, validation: null }, new Map());
  assert.equal(body.includes("## Criteri di validazione"), false);
});

test("issueDocument è il frontmatter seguito dal corpo", () => {
  const doc = issueDocument(FULL, new Map());
  assert.match(doc, /^---\n/);
  assert.match(doc, /\n---\n\n# Un titolo/);
  assert.match(doc, /\n$/, "il file finisce con un a capo");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/plugin-export-md.test.mjs
```

Atteso: FAIL — `Cannot find module '../scripts/export-md.mjs'`.

- [ ] **Step 3: Implement**

Crea `scripts/export-md.mjs`:

```js
#!/usr/bin/env node
// Emits the tracker as markdown under .harness/export/: one file per issue plus an index carrying
// the Mermaid graph. A projection, never a source — issues.json stays the only thing anybody
// writes to, and this directory is rewritten whole on every run.
//
// It exists because the board used to be a server, and a server dies. A formatter has no state and
// cannot die: see docs/superpowers/specs/2026-08-13-ergonomia-emessa-design.md.

import { dependsOn, shortId } from "./tracker-graph.mjs";
import { toFrontmatter } from "./frontmatter.mjs";

// Key order is deliberate: the structured fields first, the long prose last, so the head of the
// block shows the shape of the record instead of a wall of text.
export function issueRecord(issue) {
  return {
    id: issue.id,
    short_id: shortId(issue.id),
    title: issue.title,
    status: issue.status,
    tier: issue.tier ?? null,
    depends_on: Array.isArray(issue.depends_on) ? issue.depends_on : [],
    covers: Array.isArray(issue.covers) ? issue.covers : [],
    tasks: Array.isArray(issue.tasks) ? issue.tasks : [],
    validation: issue.validation ?? null,
    created_at: issue.created_at ?? null,
    updated_at: issue.updated_at ?? null,
    description: issue.description,
  };
}

function checkbox(task) {
  return `- [${task && task.checked === true ? "x" : " "}] ${task.short_title}`;
}

// The body carries only the prose, rendered for a viewer that cannot read frontmatter. A structured
// consumer reads the frontmatter and ignores everything below it.
export function issueBody(issue, titleByShortId) {
  const lines = [`# ${issue.title}`, "", issue.description, ""];

  const validation = issue.validation ?? null;
  if (validation) {
    const criteria = Array.isArray(validation.criteria) ? validation.criteria : [validation.criteria];
    lines.push("## Criteri di validazione", "");
    for (const criterion of criteria) lines.push(`- ${criterion}`);
    lines.push("");

    const validationTasks = Array.isArray(validation.tasks) ? validation.tasks : [];
    if (validationTasks.length > 0) {
      lines.push("## Task di validazione", "");
      for (const task of validationTasks) lines.push(checkbox(task));
      lines.push("");
    }
  }

  const tasks = Array.isArray(issue.tasks) ? issue.tasks : [];
  if (tasks.length > 0) {
    lines.push("## Task", "");
    for (const task of tasks) lines.push(checkbox(task));
    lines.push("");
  }

  const deps = dependsOn(issue);
  if (deps.length > 0) {
    lines.push("## Dipende da", "");
    for (const id of deps) {
      const short = shortId(id);
      const title = titleByShortId.get(short);
      // A dependency that is not in the tracker is reported, not dropped: it is exactly the thing
      // buildAlerts raises, and an export that hid it would disagree with the summary.
      lines.push(title ? `- [${title}](./${short}.md)` : `- ${short} (non nel tracker)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function issueDocument(issue, titleByShortId) {
  return `${toFrontmatter(issueRecord(issue))}\n\n${issueBody(issue, titleByShortId)}`.replace(/\n*$/, "\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/export-md.mjs test/plugin-export-md.test.mjs
git commit -m "feat: il documento markdown di una issue, con il record nel frontmatter"
```

---

### Task 6: `export-md.mjs` — indice e grafo Mermaid

**Files:**
- Modify: `scripts/export-md.mjs` (aggiunta)
- Modify: `test/plugin-export-md.test.mjs` (aggiunta)

**Interfaces:**
- Consumes: `chains` (Task 2), `countByStatus`, `indexById`, `buildAlerts`, `isWorkable` (Task 1), `toFrontmatter` (Task 4).
- Produces: `mermaidLabel(text) -> string`, `mermaidGraph(issues) -> string`, `indexDocument(issues, {project, schemaVersion, generatedAt}) -> string`.

- [ ] **Step 1: Write the failing test**

Aggiungi in coda a `test/plugin-export-md.test.mjs`:

```js
import { indexDocument, mermaidGraph, mermaidLabel } from "../scripts/export-md.mjs";

const node = (id, status, deps = [], title = `titolo ${id}`) => ({
  id: `${id}`.padEnd(8, "0"),
  title,
  description: "d",
  status,
  depends_on: deps.map((d) => `${d}`.padEnd(8, "0")),
});

test("mermaidLabel toglie i caratteri che rompono il diagramma", () => {
  assert.equal(mermaidLabel('un "titolo" con #hash e `backtick`'), "un titolo con hash e backtick");
  assert.equal(mermaidLabel("a\nb   c"), "a b c");
});

test("il grafo esclude le issue chiuse", () => {
  const graph = mermaidGraph([node("aaa", "done"), node("bbb", "backlog")]);
  assert.equal(graph.includes("aaa00000"), false);
  assert.equal(graph.includes("bbb00000"), true);
});

test("una catena di due o piu' diventa un subgraph, una issue sola no", () => {
  const graph = mermaidGraph([
    node("aaa", "backlog"),
    node("bbb", "backlog", ["aaa"]),
    node("ccc", "backlog"),
  ]);
  assert.match(graph, /subgraph catena1\["Catena 1"\]/);
  assert.equal(graph.match(/subgraph/g).length, 1, "la issue isolata non ha un subgraph");
});

test("l'arco va dalla dipendenza alla issue che la dichiara", () => {
  const graph = mermaidGraph([node("aaa", "backlog"), node("bbb", "backlog", ["aaa"])]);
  assert.match(graph, /^ {2}aaa00000 --> bbb00000$/m);
});

test("un arco verso una issue non disegnata non viene emesso", () => {
  const graph = mermaidGraph([node("aaa", "done"), node("bbb", "backlog", ["aaa"])]);
  assert.equal(graph.includes("-->"), false);
});

test("senza issue aperte il blocco mermaid non viene aperto", () => {
  const graph = mermaidGraph([node("aaa", "done")]);
  assert.equal(graph.includes("```mermaid"), false);
  assert.match(graph, /Nessuna issue aperta/);
});

test("l'indice porta schema_version, conteggi e la tabella", () => {
  const doc = indexDocument([node("aaa", "backlog"), node("bbb", "done")], {
    project: "Progetto",
    schemaVersion: 3,
    generatedAt: "2026-08-13T10:00:00.000Z",
  });
  assert.match(doc, /^schema_version: 3$/m);
  assert.match(doc, /^generated_at: "2026-08-13T10:00:00\.000Z"$/m);
  assert.match(doc, /^ {2}backlog: 1$/m);
  assert.match(doc, /^ {2}done: 1$/m);
  assert.match(doc, /\[titolo aaa\]\(\.\/issues\/aaa00000\.md\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/plugin-export-md.test.mjs
```

Atteso: FAIL — `mermaidGraph is not a function`.

- [ ] **Step 3: Implement**

Aggiungi a `scripts/export-md.mjs`. Estendi l'import da `./tracker-graph.mjs`:

```js
import {
  buildAlerts,
  chains,
  countByStatus,
  dependsOn,
  indexById,
  isWorkable,
  shortId,
} from "./tracker-graph.mjs";
```

E in coda al file:

```js
export const MERMAID_CLASS = {
  backlog: "fill:#e5e7eb,stroke:#9ca3af,color:#111827",
  in_progress: "fill:#bfdbfe,stroke:#3b82f6,color:#111827",
  in_review: "fill:#fde68a,stroke:#f59e0b,color:#111827",
  blocked: "fill:#fecaca,stroke:#ef4444,color:#111827",
};

export const LABEL_MAX = 40;

// Mermaid takes the label as its own little language: quotes end it, # opens an entity, backticks
// switch to another node shape. Stripping is safer than escaping, and a label is a hint anyway —
// the full title is one click away in the issue file.
export function mermaidLabel(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/["`#]/g, "")
    .trim()
    .slice(0, LABEL_MAX);
}

// Only the issues that are not done, by default: this repository passed 88 issues, and a flowchart
// of 88 nodes is noise rather than information. One subgraph per chain — the connected component
// the 1-WIP rule is written around, drawn as a graph for the first time.
export function mermaidGraph(issues) {
  const open = issues.filter((issue) => issue.status !== "done");
  if (open.length === 0) return "_Nessuna issue aperta._";

  const drawn = new Set(open.map((issue) => issue.id));
  const byId = indexById(open);
  const lines = ["```mermaid", "flowchart LR"];

  for (const [status, style] of Object.entries(MERMAID_CLASS)) {
    lines.push(`  classDef ${status} ${style}`);
  }

  const nodeLine = (issue) =>
    `${shortId(issue.id)}["${shortId(issue.id)} ${mermaidLabel(issue.title)}"]:::${issue.status}`;

  let chainNumber = 0;
  for (const group of chains(open)) {
    const nodes = group.map((id) => byId.get(id));
    if (nodes.length > 1) {
      chainNumber += 1;
      lines.push(`  subgraph catena${chainNumber}["Catena ${chainNumber}"]`);
      for (const issue of nodes) lines.push(`    ${nodeLine(issue)}`);
      lines.push("  end");
    } else {
      lines.push(`  ${nodeLine(nodes[0])}`);
    }
  }

  for (const issue of open) {
    for (const dep of dependsOn(issue)) {
      if (drawn.has(dep)) lines.push(`  ${shortId(dep)} --> ${shortId(issue.id)}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

function tableRow(issue) {
  const short = shortId(issue.id);
  const tasks = Array.isArray(issue.tasks) ? issue.tasks : [];
  const progress = tasks.length === 0 ? "-" : `${tasks.filter((t) => t && t.checked === true).length}/${tasks.length}`;
  return `| \`${short}\` | ${issue.status} | ${issue.tier ?? "-"} | ${progress} | [${issue.title}](./issues/${short}.md) |`;
}

export function indexDocument(issues, { project, schemaVersion, generatedAt }) {
  const counts = countByStatus(issues);
  const byId = indexById(issues);
  const workableTotal = issues.filter((issue) => isWorkable(issue, byId)).length;

  const record = {
    schema_version: schemaVersion,
    generated_at: generatedAt,
    project,
    counts,
    alerts: buildAlerts(issues, byId, counts, workableTotal),
  };

  return [
    toFrontmatter(record),
    "",
    `# ${project}`,
    "",
    "> Generato da `harness`. Non modificare a mano: questa directory viene riscritta a ogni export.",
    "",
    "## Catene aperte",
    "",
    mermaidGraph(issues),
    "",
    "## Issue",
    "",
    "| id | stato | tier | task | titolo |",
    "|---|---|---|---|---|",
    ...issues.map(tableRow),
    "",
  ].join("\n");
}
```

Nota: `schema_version` esce **non quotato** perché `toFrontmatter` lascia i numeri nudi, mentre `generated_at` è una stringa e quindi quotato. È ciò che i test asseriscono.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/export-md.mjs test/plugin-export-md.test.mjs
git commit -m "feat: indice dell'export con il grafo delle catene in Mermaid"
```

---

### Task 7: `export-md.mjs` — CLI, scrittura, pulizia e rifiuti

**Files:**
- Modify: `scripts/export-md.mjs` (CLI e I/O)
- Modify: `test/plugin-export-md.test.mjs` (aggiunta)

**Interfaces:**
- Consumes: tutto quanto sopra.
- Produces: `shortIdCollisions(issues) -> [issue, issue][]`; l'eseguibile `node scripts/export-md.mjs [--project-dir <path>] [--help]`, che risponde con una riga JSON `{"ok":true,"data":{"root":…,"written":<n>,"removed":<n>}}`.

- [ ] **Step 1: Write the failing test**

Aggiungi in coda a `test/plugin-export-md.test.mjs`:

```js
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { shortIdCollisions } from "../scripts/export-md.mjs";

const EXPORT_SCRIPT = fileURLToPath(new URL("../scripts/export-md.mjs", import.meta.url));

function project(issues, extra = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-export-"));
  writeFileSync(
    path.join(dir, "issues.json"),
    JSON.stringify({ schema_version: 3, project: "P", issues, ...extra })
  );
  return dir;
}

function runExport(dir) {
  const run = spawnSync(process.execPath, [EXPORT_SCRIPT, "--project-dir", dir], {
    encoding: "utf8",
  });
  return { ...run, json: JSON.parse(run.stdout) };
}

test("shortIdCollisions vede due id che condividono i primi otto caratteri", () => {
  const clash = shortIdCollisions([
    { id: "aaaaaaaa-1111-0000-0000-000000000000" },
    { id: "aaaaaaaa-2222-0000-0000-000000000000" },
  ]);
  assert.equal(clash.length, 1);
  assert.equal(shortIdCollisions([{ id: "aaaaaaaa-1" }, { id: "bbbbbbbb-2" }]).length, 0);
});

test("l'export scrive l'indice e un file per issue", () => {
  const dir = project([node("aaa", "backlog"), node("bbb", "done")]);
  const run = runExport(dir);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, "");
  assert.equal(run.json.ok, true);
  assert.equal(run.json.data.written, 3, "due issue piu' l'indice");

  const root = path.join(dir, ".harness", "export");
  assert.match(readFileSync(path.join(root, "index.md"), "utf8"), /^# P$/m);
  assert.match(readFileSync(path.join(root, "issues", "aaa00000.md"), "utf8"), /^short_id: "aaa00000"$/m);
});

test("un tracker assente produce un export vuoto, non un errore", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-export-"));
  const run = runExport(dir);
  assert.equal(run.status, 0);
  assert.equal(run.json.ok, true);
  assert.equal(run.json.data.written, 1, "solo l'indice");
});

test("il file di una issue sparita viene rimosso", () => {
  const dir = project([node("aaa", "backlog"), node("bbb", "backlog")]);
  runExport(dir);
  writeFileSync(
    path.join(dir, "issues.json"),
    JSON.stringify({ schema_version: 3, project: "P", issues: [node("aaa", "backlog")] })
  );
  const run = runExport(dir);
  assert.equal(run.json.data.removed, 1);
  assert.deepEqual(readdirSync(path.join(dir, ".harness", "export", "issues")), ["aaa00000.md"]);
});

test("un file estraneo fa rifiutare, e niente viene rimosso", () => {
  const dir = project([node("aaa", "backlog")]);
  runExport(dir);
  const issuesDir = path.join(dir, ".harness", "export", "issues");
  writeFileSync(path.join(issuesDir, "note.txt"), "mio");
  const run = runExport(dir);
  assert.equal(run.status, 1);
  assert.equal(run.json.ok, false);
  assert.equal(run.json.code, "FOREIGN_CONTENT");
  assert.equal(readdirSync(issuesDir).includes("note.txt"), true);
});

test("una collisione di short-id fa rifiutare nominando le due issue", () => {
  const dir = project([
    { ...node("aaa", "backlog"), id: "aaaaaaaa-1111-0000-0000-000000000000" },
    { ...node("aaa", "backlog"), id: "aaaaaaaa-2222-0000-0000-000000000000" },
  ]);
  const run = runExport(dir);
  assert.equal(run.status, 1);
  assert.equal(run.json.code, "ID_COLLISION");
  assert.match(run.json.error, /aaaaaaaa-1111/);
  assert.match(run.json.error, /aaaaaaaa-2222/);
});

test("un tracker malformato risponde sul contratto normale", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-export-"));
  writeFileSync(path.join(dir, "issues.json"), "{ non e' json");
  const run = runExport(dir);
  assert.equal(run.status, 1);
  assert.equal(run.json.code, "INVALID_JSON");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/plugin-export-md.test.mjs
```

Atteso: FAIL — `shortIdCollisions is not a function`, e lo script non produce JSON.

- [ ] **Step 3: Implement**

Estendi gli import in testa a `scripts/export-md.mjs`:

```js
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
```

E aggiungi in coda:

```js
export function shortIdCollisions(issues) {
  const seen = new Map();
  const clashes = [];
  for (const issue of issues) {
    const short = shortId(issue.id);
    if (seen.has(short)) clashes.push([seen.get(short), issue]);
    else seen.set(short, issue);
  }
  return clashes;
}

const USAGE = [
  "Usage:",
  "  node export-md.mjs [--project-dir <path>] [--help]",
  "",
  "Writes the tracker as markdown under .harness/export/: index.md with the Mermaid graph of the",
  "open chains, and issues/<short-id>.md per issue with the whole record in the frontmatter.",
  "",
  "The directory is owned by this command and rewritten whole: files of issues that no longer",
  "exist are removed. Anything else found in there makes the command refuse instead of clean.",
  "",
  "--project-dir  directory holding issues.json (default: the current directory).",
  "               A project without issues.json exports an empty index, not an error.",
  "",
  "stdout is always one line of JSON. Nothing is written to stderr.",
  "",
].join("\n");

function writeOk(data) {
  process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
  process.exit(0);
}

function writeFail(message, code) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: message, code })}\n`);
  process.exit(1);
}

// The command owns .harness/export/ and rewrites it whole, which is the only way a compacted or
// deleted issue stops leaving a ghost file behind. Owning a directory means being able to delete
// from it, so it refuses the moment it finds something it did not write: a mistyped --project-dir
// must not become a deletion.
function assertOwnDirectory(dir, allowed) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (allowed(entry)) continue;
    writeFail(
      `'${path.join(dir, entry.name)}' non e' stato scritto dall'export: la directory non e' vuota di roba altrui e non viene toccata.`,
      "FOREIGN_CONTENT"
    );
  }
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      options: {
        "project-dir": { type: "string" },
        help: { type: "boolean", default: false },
      },
    }));
  } catch (error) {
    writeFail(`${error.message.replace(/\.?$/, ".")} export-md.mjs accetta solo --project-dir e --help.`, "MISSING_ARGS");
  }

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const projectDir = path.resolve(values["project-dir"] ?? process.cwd());
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    writeFail(`La directory di progetto '${projectDir}' non esiste.`, "FILE_NOT_FOUND");
  }

  const trackerPath = path.join(projectDir, "issues.json");
  let data = { issues: [] };
  if (existsSync(trackerPath)) {
    try {
      data = JSON.parse(readFileSync(trackerPath, "utf8"));
    } catch {
      writeFail(`'${trackerPath}' non e' un JSON valido: il tracker non e' leggibile.`, "INVALID_JSON");
    }
  }

  const issues = Array.isArray(data.issues) ? data.issues : [];
  const project = typeof data.project === "string" && data.project ? data.project : path.basename(projectDir);

  const clashes = shortIdCollisions(issues);
  if (clashes.length > 0) {
    const [first, second] = clashes[0];
    writeFail(
      `I primi otto caratteri di '${first.id}' e '${second.id}' coincidono: lo slug non sarebbe univoco, e allungarlo cambierebbe URL gia' pubblicati.`,
      "ID_COLLISION"
    );
  }

  const root = path.join(projectDir, ".harness", "export");
  const issuesDir = path.join(root, "issues");
  const expected = new Set(issues.map((issue) => `${shortId(issue.id)}.md`));

  assertOwnDirectory(root, (entry) => entry.name === "index.md" || (entry.isDirectory() && entry.name === "issues"));
  assertOwnDirectory(issuesDir, (entry) => entry.isFile() && entry.name.endsWith(".md"));

  mkdirSync(issuesDir, { recursive: true });

  const titleByShortId = new Map(issues.map((issue) => [shortId(issue.id), issue.title]));
  let written = 0;

  writeFileSync(
    path.join(root, "index.md"),
    indexDocument(issues, {
      project,
      schemaVersion: data.schema_version ?? 0,
      generatedAt: new Date().toISOString(),
    }),
    "utf8"
  );
  written += 1;

  for (const issue of issues) {
    writeFileSync(path.join(issuesDir, `${shortId(issue.id)}.md`), issueDocument(issue, titleByShortId), "utf8");
    written += 1;
  }

  let removed = 0;
  for (const entry of readdirSync(issuesDir)) {
    if (expected.has(entry)) continue;
    rmSync(path.join(issuesDir, entry));
    removed += 1;
  }

  writeOk({ root, written, removed });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Atteso: PASS.

- [ ] **Step 5: Prova su questo repository, che è il primo consumer**

```bash
node scripts/export-md.mjs
```

Atteso: una riga JSON con `ok:true`. Apri `.harness/export/index.md` e verifica a occhio che il grafo Mermaid renderizzi e che le catene abbiano senso.

- [ ] **Step 6: Commit**

```bash
git add scripts/export-md.mjs test/plugin-export-md.test.mjs
git commit -m "feat: export-md scrive .harness/export e possiede la directory"
```

---

### Task 8: Rimozione del board

**Files:**
- Delete: `scripts/board-server.mjs`, `scripts/board.html`, `test/plugin-board.test.mjs`, `commands/board.md`, `skills/harness/references/board.md`
- Modify: `.gitignore`, `.claude-plugin/plugin.json`, `README.md`, `CONTRIBUTING.md`
- Modify: `test/plugin-skill.test.mjs`, `test/plugin-commands.test.mjs`, `test/smoke.test.mjs`
- Modify: `scripts/status-cli.mjs:7-9` e `scripts/issue-manager.mjs` (commenti che nominano il board)

**Interfaces:**
- Consumes: niente.
- Produces: niente. È una rimozione, e la superficie del plugin si restringe.

- [ ] **Step 1: Update the inventory tests first**

I test su skill e comandi verificano l'inventario del plugin: vanno cambiati **prima**, così il rosso che segue è quello atteso e non un effetto collaterale. Apri `test/plugin-commands.test.mjs`, `test/plugin-skill.test.mjs` e `test/smoke.test.mjs`, togli `board` da ogni elenco di comandi e di reference attesi, e aggiungi `export` dove i comandi vengono elencati (il file arriva nel Task 9).

```bash
grep -rn "board" test/plugin-commands.test.mjs test/plugin-skill.test.mjs test/smoke.test.mjs
```

- [ ] **Step 2: Run the suite to see the expected red**

```bash
npm test
```

Atteso: FAIL sui soli test di inventario, che ora cercano un mondo senza board. `test/plugin-board.test.mjs` è ancora verde: sparisce al passo dopo.

- [ ] **Step 3: Delete the files**

```bash
git rm scripts/board-server.mjs scripts/board.html test/plugin-board.test.mjs commands/board.md skills/harness/references/board.md
```

- [ ] **Step 4: Clean up the references**

In `.gitignore`, togli le due righe dei lanciatori che il board scriveva:

```
.harness/board.cmd
.harness/board.sh
```

In `.claude-plugin/plugin.json`, la `description` promette un board vivo:

```json
  "description": "Controlled development harness for AI agents: issue tracker, markdown export, and agent operating rules — installed as a plugin, leaving nothing but issues.json in your project.",
```

Poi cerca ed elimina ogni altra eco:

```bash
grep -rni "board" README.md CONTRIBUTING.md skills/ commands/ scripts/ .claude-plugin/
```

Aggiorna quello che esce in `README.md`, `CONTRIBUTING.md`, `skills/harness/SKILL.md` (elenco delle reference, e la riga del clock-out che dice di fermare il board), `skills/harness/references/status.md`, `references/docs-gate.md`, `references/issues.md`, e i commenti in testa a `scripts/status-cli.mjs` e `scripts/issue-manager.mjs`.

**Non toccare** `docs/superpowers/specs/`, `docs/superpowers/plans/`, `docs/superpowers/approvazioni/`, `issues.json`, `.harness/archive/` e `proposals/`: registrano cosa fu deciso allora, ed è ciò che rende comprensibile questa decisione fra sei mesi.

- [ ] **Step 5: Run the suite to verify it is green**

```bash
npm test
```

Atteso: PASS. Se un test cerca ancora `scripts/board.html`, è un inventario che era sfuggito al passo 1.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: il board servito esce dal plugin"
```

---

### Task 9: La documentazione, che è metà del plugin

Harness è una CLI più documenti: uno script senza la sua reference è un componente che nessun agente troverà.

**Files:**
- Create: `skills/harness/references/export.md`, `commands/export.md`
- Modify: `skills/harness/references/status.md`, `skills/harness/SKILL.md`

**Interfaces:**
- Consumes: i comandi dei Task 3 e 7.
- Produces: la superficie documentale che li rende invocabili.

- [ ] **Step 1: Write `references/export.md`**

In italiano, nel registro delle altre reference. Deve coprire: cosa scrive e dove (`.harness/export/index.md` e `issues/<short-id>.md`); che `short-id` sono i primi otto caratteri del GUID e fanno **due lavori** — slug del file e id del nodo Mermaid — e che sono derivati dall'`id`, quindi stabili al cambio di titolo; che il frontmatter porta **il record intero con le strutture intatte** e il corpo solo la prosa, e che un consumatore strutturato legge il primo e ignora il secondo; che la directory è **posseduta** dal comando, riscritta a ogni giro, con i file delle issue sparite rimossi e il rifiuto `FOREIGN_CONTENT` davanti a qualunque altra cosa; che il grafo mostra **solo le issue non chiuse**, un `subgraph` per catena, e l'arco dalla dipendenza alla issue che la dichiara; che `schema_version` viaggia nell'indice; che **se versionare l'export lo decide il progetto**, perché harness non scrive nessun `.gitignore`; la tabella dei codici di errore (`FOREIGN_CONTENT`, `ID_COLLISION`, `INVALID_JSON`, `FILE_NOT_FOUND`, `MISSING_ARGS`).

- [ ] **Step 2: Write `commands/export.md`**

Sul modello di `commands/status.md`: descrizione breve in testa (è quella che finisce nell'elenco delle skill), cosa fa senza argomenti, e il richiamo a `references/export.md` per il contratto.

- [ ] **Step 3: Document the inverted contract in `references/status.md`**

Aggiungi la sezione su `--oneline`, **col motivo**: gira a ogni refresh di una barra di stato, un errore ripetuto lì è peggio del silenzio, quindi esce sempre 0, non scrive mai su stderr, degrada a riga vuota, e non usa caratteri fuori da ASCII perché finisce in tmux o in un prompt PowerShell dove la codifica non è garantita. Scrivi che **è un'eccezione deliberata** al contratto del resto della CLI: senza quella riga qualcuno lo riporterà alla forma generale.

Aggiungi anche gli esempi di configurazione dell'ospite, perché sono il punto in cui la portabilità smette di essere una promessa:

````markdown
```jsonc
// .claude/settings.json
{ "statusLine": { "type": "command", "command": "node \"$SCRIPTS/status-cli.mjs\" --oneline" } }
```

```bash
# tmux
set -g status-right '#(node "$SCRIPTS/status-cli.mjs" --oneline)'
```
````

- [ ] **Step 4: Update `SKILL.md`**

Nell'elenco delle reference in coda, togli la riga del board e aggiungi:

```markdown
- [references/export.md](references/export.md) — export markdown del tracker: cosa scrive, dove, e
  come si legge il grafo delle catene.
```

Controlla il capitolo «Clock out»: la riga che dice di fermare il board col `pid` della riga di avvio non ha più oggetto e va tolta.

- [ ] **Step 5: Verify the suite and the plugin surface**

```bash
npm test
```

Atteso: PASS, inclusi i test di inventario aggiornati nel Task 8, che ora trovano `commands/export.md`.

- [ ] **Step 6: Commit**

```bash
git add skills/ commands/
git commit -m "docs: reference e comando dell'export, contratto invertito di --oneline"
```

- [ ] **Step 7: Prova in una sessione vera**

`CLAUDE.md` lo impone e nessun test lo copre: **riavvia la sessione di Claude Code**, poi invoca `/harness:export` e verifica che il comando esista e risponda. Un componente aggiunto non è invocabile finché la sessione non riparte, e questo è l'unico modo di accorgersene.

---

## Note di rilascio da scrivere

Nei progetti che hanno già usato il board restano `.harness/board.cmd` e `.harness/board.sh`. Harness **non li cancella**: sono file inerti, e un plugin che ripulisce da sé la directory di un progetto fa più danni di quanti ne eviti. Va detto nelle note di rilascio, non automatizzato.

## Self-review

**Copertura della spec** — «Il principio» → Task 8 (rimozione) più l'architettura di tutti i task; «I componenti» → Task 1, 3, 7; «`--oneline`» e il contratto invertito → Task 3 (codice) e Task 9 passo 3 (motivazione scritta dove vive il contratto); «Il formato dell'export», frontmatter, corpo, Mermaid, proprietà della directory, versionamento → Task 4, 5, 6, 7; «Cosa viene rimosso» → Task 8 voce per voce; «Errori e degradazione» → la tabella della spec è coperta riga per riga dai test dei Task 3 e 7; «Testing» → i test di ogni task. La `description` di `plugin.json` e le righe di `.gitignore`, nominate nella spec, sono nel Task 8 passo 4.

**Placeholder** — nessun «TBD», nessun «gestisci gli edge case»: ogni passo di codice porta il codice, ogni passo di test porta le asserzioni. Il Task 9 descrive contenuti di documentazione invece di dettarli parola per parola, ed è deliberato: sono documenti in prosa, e l'elenco di ciò che devono coprire è il vincolo verificabile.

**Coerenza dei tipi** — `shortId` è definito nel Task 1 e usato con la stessa firma nei Task 5, 6, 7; `chains(issues) -> string[][]` è definito nel Task 2 e consumato nel Task 6; `toFrontmatter(record) -> string` è definito nel Task 4 e usato nei Task 5 e 6; `titleByShortId` è una `Map<string,string>` in entrambi i posti in cui compare (Task 5 e Task 7). `buildSnapshot` e `renderSnapshot` mantengono la firma che avevano, ed è per questo che i test di `status-cli` restano verdi senza essere toccati nel Task 1.
