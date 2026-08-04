# Riepilogo del tracker a riga di comando — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere `/harness:status`, un comando che stampa in una schermata sola i conteggi del tracker, cosa è in corso e cosa si può prendere adesso.

**Architecture:** Un solo file nuovo, `scripts/status-cli.mjs`, con tre funzioni a confine netto — `buildSnapshot(issues)` decide (pura), `renderSnapshot(snapshot, opts)` formatta (pura), `main()` fa I/O. Le due funzioni pure si esportano e si provano importandole; `main()` si prova con `spawnSync`. Nessuno degli script esistenti viene toccato.

**Tech Stack:** Node.js ≥ 18, ESM, `node:test` + `node:assert/strict`, `node:util.parseArgs`. Nessuna dipendenza esterna: il plugin non ne ha e non ne acquisisce.

**Spec:** [docs/superpowers/specs/2026-08-04-status-cli-design.md](../specs/2026-08-04-status-cli-design.md)

## Global Constraints

- **Nessuna dipendenza npm.** Solo moduli `node:`.
- **Larghezza fissa 80 colonne.** Nessuna riga dell'output può superarla, per nessun input.
- **Icone in ASCII puro** (`o + ~ ! #` per gli stati, `$ $$ $$$` per i tier, `-` per il tier assente). Le cornici possono usare `─` e `═`. Nessun altro carattere non-ASCII nell'output, e mai in una colonna che porta significato.
- **Troncamento con `...`**, tre caratteri ASCII, mai `…`.
- **Niente ANSI, niente colore, nessuna lettura di `isTTY`.**
- **Stdout è testo, non JSON**, e niente viene scritto su stderr in nessun caso.
- **Non modificare `issues.json` alla radice** per nessun motivo: i test lavorano su directory temporanee (`mkdtempSync`), come fa già `test/plugin-board.test.mjs`.
- **Commenti nel codice in inglese**, come tutti gli script del plugin; documentazione utente (`commands/`, `skills/`, `README`) in italiano tranne il `README`, che è in inglese.
- **`npm test` verde** prima di ogni commit.

## File Structure

| file | responsabilità | stato |
|---|---|---|
| `scripts/status-cli.mjs` | `buildSnapshot`, `renderSnapshot`, `main` | nuovo |
| `test/plugin-status-cli.test.mjs` | unità sulle due funzioni pure, processo su `main` | nuovo |
| `commands/status.md` | prompt dello slash command | nuovo |
| `test/plugin-commands.test.mjs` | aggiungere `status` a `COMMANDS` | modificato |
| `skills/harness/SKILL.md` | riepilogo a clock-in e a clock-out | modificato |
| `README.md` | riga nella tabella dei comandi | modificato |

Un file solo per lo script, non due: il totale è ~200 righe, e il confine fra decisione e resa è già portato dalle firme delle tre funzioni.

---

### Task 1: Costanti, `buildSnapshot` — conteggi e sezione in corso

**Files:**
- Create: `scripts/status-cli.mjs`
- Test: `test/plugin-status-cli.test.mjs`

**Interfaces:**
- Consumes: niente.
- Produces:
  - `export const STATUS_ICON: Record<string, string>` — `{ backlog: "o", in_progress: "+", in_review: "~", blocked: "!", done: "#" }`
  - `export const TIER_ICON: Record<string, string>` — `{ economy: "$", standard: "$$", reasoning: "$$$" }`
  - `export const IN_FLIGHT_ORDER: string[]` — `["in_progress", "in_review", "blocked"]`
  - `export const BAR_ORDER: string[]` — `["done", "in_progress", "in_review", "blocked", "backlog"]`
  - `export const WIDTH = 80`, `export const BAR_INNER = 77`, `export const TITLE_MAX = 45`, `export const WORKABLE_SHOWN = 3`
  - `export function buildSnapshot(issues: object[]): { counts, inFlight, workable, workableTotal, alerts }` — in questo task `workable: []`, `workableTotal: 0`, `alerts: []`; `counts` ha tutte e cinque le chiavi, sempre, anche a zero; `inFlight` è un array di issue.

- [ ] **Step 1: Write the failing test**

Crea `test/plugin-status-cli.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: FAIL — `Cannot find module .../scripts/status-cli.mjs`

- [ ] **Step 3: Write minimal implementation**

Crea `scripts/status-cli.mjs`:

```javascript
#!/usr/bin/env node
// One screen of tracker status, printed into the session.
//
// Usage:
//   node status-cli.mjs [--project-dir <path>] [--help]
//
// STDOUT IS TEXT, NOT JSON. This is a deliberate break from issue-manager.mjs and
// board-server.mjs, which print one line of JSON because an agent parses it. This script talks to
// a human reading a code block in the session: it has no automated consumers and must not acquire
// any. Nothing is ever written to stderr.
//
// No colour, no ANSI, no isTTY: the surface this exists for is `/harness:status`, where stdout is
// a pipe to the agent and a colour branch would never run. Alignment and ASCII icons carry the
// distinctions instead, and they survive a markdown code block.

export const STATUS_ICON = {
  backlog: "o",
  in_progress: "+",
  in_review: "~",
  blocked: "!",
  done: "#",
};

export const TIER_ICON = { economy: "$", standard: "$$", reasoning: "$$$" };

// Reading order of the in-flight section: what is moving, then what is waiting on a verifier,
// then what is stuck.
export const IN_FLIGHT_ORDER = ["in_progress", "in_review", "blocked"];

// Reading order of the bar and its legend: closed work on the left, untouched backlog on the
// right, so the bar fills left to right as the project advances.
export const BAR_ORDER = ["done", "in_progress", "in_review", "blocked", "backlog"];

export const WIDTH = 80;
export const BAR_INNER = 77; // WIDTH minus the leading space and the two brackets
export const TITLE_MAX = 45;
export const WORKABLE_SHOWN = 3;

function emptyCounts() {
  return { backlog: 0, in_progress: 0, in_review: 0, blocked: 0, done: 0 };
}

export function buildSnapshot(issues) {
  const counts = emptyCounts();
  for (const issue of issues) {
    if (Object.hasOwn(counts, issue.status)) {
      counts[issue.status] += 1;
    }
  }

  const inFlight = issues
    .filter((issue) => IN_FLIGHT_ORDER.includes(issue.status))
    .sort(
      (a, b) =>
        IN_FLIGHT_ORDER.indexOf(a.status) - IN_FLIGHT_ORDER.indexOf(b.status) ||
        String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))
    );

  return { counts, inFlight, workable: [], workableTotal: 0, alerts: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: PASS, 6 test

- [ ] **Step 5: Commit**

```bash
git add scripts/status-cli.mjs test/plugin-status-cli.test.mjs
git commit -m "feat: conteggi e sezione in corso del riepilogo del tracker"
```

---

### Task 2: `buildSnapshot` — lavorabili e dipendenze fantasma

**Files:**
- Modify: `scripts/status-cli.mjs`
- Test: `test/plugin-status-cli.test.mjs`

**Interfaces:**
- Consumes: `buildSnapshot` da Task 1.
- Produces: `buildSnapshot(...).workable` — array delle issue `backlog` lavorabili, **già tagliato a `WORKABLE_SHOWN`**, ordinato per `created_at` crescente; `.workableTotal` — quante sono in tutto, prima del taglio.

- [ ] **Step 1: Write the failing test**

Aggiungi in fondo a `test/plugin-status-cli.test.mjs`:

```javascript
test("an issue with no dependencies is workable", () => {
  const snapshot = buildSnapshot([issue("aaaaaaaa")]);
  assert.deepEqual(snapshot.workable.map((i) => i.id), ["aaaaaaaa"]);
  assert.equal(snapshot.workableTotal, 1);
});

test("an issue is workable once every dependency is done", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "done" }),
    issue("bbbbbbbb", { status: "done" }),
    issue("cccccccc", { depends_on: ["aaaaaaaa", "bbbbbbbb"] }),
  ]);
  assert.deepEqual(snapshot.workable.map((i) => i.id), ["cccccccc"]);
});

test("one dependency still open is enough to keep an issue out", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "done" }),
    issue("bbbbbbbb", { status: "in_progress" }),
    issue("cccccccc", { depends_on: ["aaaaaaaa", "bbbbbbbb"] }),
  ]);
  assert.deepEqual(snapshot.workable, []);
  assert.equal(snapshot.workableTotal, 0);
});

test("only backlog issues are workable: in flight ones are already taken", () => {
  const snapshot = buildSnapshot([issue("aaaaaaaa", { status: "in_progress" })]);
  assert.deepEqual(snapshot.workable, []);
});

test("a dependency that does not exist makes the issue not workable", () => {
  // Conservative on purpose: we do not know what is missing, and calling an issue that depends on
  // nothing workable is how the wrong work gets started.
  const snapshot = buildSnapshot([issue("cccccccc", { depends_on: ["ffffffff"] })]);
  assert.deepEqual(snapshot.workable, []);
  assert.equal(snapshot.workableTotal, 0);
});

test("workable issues come out oldest first", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { created_at: "2026-03-01T00:00:00Z" }),
    issue("bbbbbbbb", { created_at: "2026-01-01T00:00:00Z" }),
    issue("cccccccc", { created_at: "2026-02-01T00:00:00Z" }),
  ]);
  assert.deepEqual(
    snapshot.workable.map((i) => i.id),
    ["bbbbbbbb", "cccccccc", "aaaaaaaa"]
  );
});

test("workable is cut to three, and the total says how many there really are", () => {
  const many = Array.from({ length: 7 }, (_, n) =>
    issue(`${n}`.padStart(8, "0"), { created_at: `2026-01-0${n + 1}T00:00:00Z` })
  );
  const snapshot = buildSnapshot(many);
  assert.equal(snapshot.workable.length, 3);
  assert.equal(snapshot.workableTotal, 7);
  assert.deepEqual(
    snapshot.workable.map((i) => i.id),
    ["00000000", "00000001", "00000002"]
  );
});

test("a missing depends_on field reads as no dependencies", () => {
  const bare = issue("aaaaaaaa");
  delete bare.depends_on;
  assert.deepEqual(buildSnapshot([bare]).workable.map((i) => i.id), ["aaaaaaaa"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: FAIL — `workable` è sempre `[]`, il primo test si aspetta `["aaaaaaaa"]`

- [ ] **Step 3: Write minimal implementation**

In `scripts/status-cli.mjs`, aggiungi sopra `buildSnapshot`:

```javascript
function dependsOn(issue) {
  return Array.isArray(issue.depends_on) ? issue.depends_on : [];
}

// A dangling id — one that matches no issue in the tracker — leaves the issue unworkable. It
// happens after a hand edit of issues.json, and after an archive that took away something still
// referenced. Either way we do not know what is missing, so we do not clear the issue for work.
function danglingDeps(issue, byId) {
  return dependsOn(issue).filter((id) => !byId.has(id));
}

function isWorkable(issue, byId) {
  if (issue.status !== "backlog") return false;
  const deps = dependsOn(issue);
  if (deps.some((id) => !byId.has(id))) return false;
  return deps.every((id) => byId.get(id).status === "done");
}
```

e sostituisci il corpo di `buildSnapshot` dopo il calcolo di `inFlight`:

```javascript
  const byId = new Map(issues.map((issue) => [issue.id, issue]));

  const workableAll = issues
    .filter((issue) => isWorkable(issue, byId))
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));

  return {
    counts,
    inFlight,
    workable: workableAll.slice(0, WORKABLE_SHOWN),
    workableTotal: workableAll.length,
    alerts: [],
  };
```

`danglingDeps` non è ancora chiamata da nessuno: la usa Task 3. Lasciala definita.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: PASS, 14 test

- [ ] **Step 5: Commit**

```bash
git add scripts/status-cli.mjs test/plugin-status-cli.test.mjs
git commit -m "feat: issue lavorabili e dipendenze fantasma nel riepilogo"
```

---

### Task 3: `buildSnapshot` — allerte

**Files:**
- Modify: `scripts/status-cli.mjs`
- Test: `test/plugin-status-cli.test.mjs`

**Interfaces:**
- Consumes: `buildSnapshot`, `danglingDeps` da Task 2.
- Produces: `buildSnapshot(...).alerts` — array di stringhe **senza** il `!` davanti, che aggiunge il renderer. Nell'ordine: ciclo, dipendenze fantasma, stallo.

- [ ] **Step 1: Write the failing test**

Aggiungi in fondo a `test/plugin-status-cli.test.mjs`:

```javascript
test("no alerts on a healthy tracker", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "done" }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
  ]);
  assert.deepEqual(snapshot.alerts, []);
});

test("a cycle among open issues is reported with every id involved", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { depends_on: ["bbbbbbbb"] }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
  ]);
  assert.equal(snapshot.alerts.length, 1);
  assert.match(snapshot.alerts[0], /^ciclo nei depends_on: /);
  assert.match(snapshot.alerts[0], /aaaaaaaa/);
  assert.match(snapshot.alerts[0], /bbbbbbbb/);
});

test("a cycle among done issues is history, not an alert", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "done", depends_on: ["bbbbbbbb"] }),
    issue("bbbbbbbb", { status: "done", depends_on: ["aaaaaaaa"] }),
  ]);
  assert.deepEqual(snapshot.alerts, []);
});

test("a cycle does not stop the rest of the snapshot", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { depends_on: ["bbbbbbbb"] }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
    issue("cccccccc", { status: "in_progress" }),
  ]);
  assert.equal(snapshot.counts.in_progress, 1);
  assert.deepEqual(snapshot.inFlight.map((i) => i.id), ["cccccccc"]);
});

test("dangling dependencies are counted and their missing ids named", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { depends_on: ["ffffffff"] }),
    issue("bbbbbbbb", { depends_on: ["ffffffff"] }),
  ]);
  const alert = snapshot.alerts.find((a) => a.includes("id inesistenti"));
  assert.match(alert, /^2 issue dipendono da id inesistenti: ffffffff$/);
});

test("one dangling dependency reads in the singular", () => {
  const snapshot = buildSnapshot([issue("aaaaaaaa", { depends_on: ["ffffffff"] })]);
  const alert = snapshot.alerts.find((a) => a.includes("id inesistente"));
  assert.match(alert, /^1 issue dipende da id inesistente: ffffffff$/);
});

test("a full backlog with nothing workable is a standstill", () => {
  const snapshot = buildSnapshot([
    issue("aaaaaaaa", { status: "in_progress" }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
    issue("cccccccc", { depends_on: ["aaaaaaaa"] }),
  ]);
  const alert = snapshot.alerts.find((a) => a.startsWith("lavorabili 0"));
  assert.equal(alert, "lavorabili 0 di 2 — ogni issue in backlog attende qualcosa");
});

test("an empty backlog is not a standstill", () => {
  const snapshot = buildSnapshot([issue("aaaaaaaa", { status: "done" })]);
  assert.deepEqual(snapshot.alerts, []);
});

test("blocked issues raise no alert: they are already in the in-flight section", () => {
  const snapshot = buildSnapshot([issue("aaaaaaaa", { status: "blocked" })]);
  assert.deepEqual(snapshot.alerts, []);
  assert.deepEqual(snapshot.inFlight.map((i) => i.id), ["aaaaaaaa"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: FAIL — `alerts` è sempre `[]`, il test del ciclo si aspetta una riga

- [ ] **Step 3: Write minimal implementation**

In `scripts/status-cli.mjs`, aggiungi sopra `buildSnapshot`:

```javascript
// Depth-first search restricted to open issues. A cycle among closed ones is a fact of history:
// nothing is waiting on it any more, and reporting it every time would train the reader to skip
// the alert line.
function findCycle(issues, byId) {
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

function buildAlerts(issues, byId, counts, workableTotal) {
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
    const verb = broken.length === 1 ? "issue dipende da id inesistente" : "issue dipendono da id inesistenti";
    alerts.push(`${broken.length} ${verb}: ${missing}`);
  }

  if (counts.backlog > 0 && workableTotal === 0) {
    alerts.push(`lavorabili 0 di ${counts.backlog} — ogni issue in backlog attende qualcosa`);
  }

  return alerts;
}
```

e aggiungi, sempre sopra `buildSnapshot`:

```javascript
export function shortId(id) {
  return String(id ?? "").slice(0, 8);
}
```

Poi, nel `return` di `buildSnapshot`, sostituisci `alerts: []` con:

```javascript
    alerts: buildAlerts(issues, byId, counts, workableAll.length),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: PASS, 23 test

- [ ] **Step 5: Commit**

```bash
git add scripts/status-cli.mjs test/plugin-status-cli.test.mjs
git commit -m "feat: allerte su cicli, dipendenze fantasma e stallo del backlog"
```

---

### Task 4: `renderSnapshot` — intestazione, barra, legenda degli stati

**Files:**
- Modify: `scripts/status-cli.mjs`
- Test: `test/plugin-status-cli.test.mjs`

**Interfaces:**
- Consumes: `buildSnapshot`, `BAR_ORDER`, `BAR_INNER`, `WIDTH`, `STATUS_ICON` dai task precedenti.
- Produces: `export function renderSnapshot(snapshot, { project, lastUpdated }): string` — stringa multiriga, senza `\n` finale. In questo task rende solo intestazione, riga `═`, barra e legenda.

- [ ] **Step 1: Write the failing test**

Aggiungi `renderSnapshot`, `WIDTH` e `BAR_INNER` all'import in cima al file di test:

```javascript
import {
  buildSnapshot,
  renderSnapshot,
  STATUS_ICON,
  TIER_ICON,
  WIDTH,
  BAR_INNER,
} from "../scripts/status-cli.mjs";
```

e aggiungi in fondo:

```javascript
function render(issues, opts = {}) {
  return renderSnapshot(buildSnapshot(issues), {
    project: "harness",
    lastUpdated: "2026-08-04T09:12:00Z",
    ...opts,
  });
}

function lines(text) {
  return text.split("\n");
}

test("the header names the project and the tracker size", () => {
  const first = lines(render([issue("aaaaaaaa")]))[0];
  assert.match(first, /^ harness · 1 issue · aggiornato /);
});

test("the header counts done issues too: it is the tracker, not the open work", () => {
  const first = lines(render([issue("aaaaaaaa", { status: "done" }), issue("bbbbbbbb")]))[0];
  assert.match(first, /^ harness · 2 issue/);
});

test("a tracker with no last_updated stops the header at the count", () => {
  const first = lines(render([issue("aaaaaaaa")], { lastUpdated: null }))[0];
  assert.equal(first, " harness · 1 issue");
});

test("an unparseable last_updated is dropped rather than printed raw", () => {
  const first = lines(render([issue("aaaaaaaa")], { lastUpdated: "not a date" }))[0];
  assert.equal(first, " harness · 1 issue");
});

test("the bar segments always add up to the exact bar width", () => {
  const cases = [
    [issue("aaaaaaaa")],
    [issue("aaaaaaaa", { status: "done" }), issue("bbbbbbbb")],
    Array.from({ length: 97 }, (_, n) =>
      issue(`${n}`.padStart(8, "0"), { status: n === 0 ? "blocked" : "done" })
    ),
  ];
  for (const issues of cases) {
    const bar = lines(render(issues)).find((l) => l.trim().startsWith("["));
    const inner = bar.trim().slice(1, -1);
    assert.equal(inner.length, BAR_INNER, `bar was ${inner.length} wide for ${issues.length} issues`);
  }
});

test("a status with at least one issue never vanishes from the bar", () => {
  const issues = Array.from({ length: 200 }, (_, n) =>
    issue(`${n}`.padStart(8, "0"), { status: n === 0 ? "blocked" : "done" })
  );
  const bar = lines(render(issues)).find((l) => l.trim().startsWith("["));
  assert.ok(bar.includes(STATUS_ICON.blocked), "one blocked issue in two hundred still gets a column");
});

test("the legend lists only the statuses that are actually there", () => {
  const legend = lines(render([issue("aaaaaaaa", { status: "done" }), issue("bbbbbbbb")])).find(
    (l) => l.includes("done")
  );
  assert.match(legend, /# done 1/);
  assert.match(legend, /o backlog 1/);
  assert.ok(!legend.includes("blocked"), "an empty status in the legend explains an absent icon");
});

const EVERY_STATUS = ["done", "in_progress", "in_review", "blocked", "backlog"];

test("no line is wider than eighty columns, even with three-digit counts", () => {
  const issues = Array.from({ length: 999 }, (_, n) =>
    issue(`${n}`.padStart(8, "0"), { status: EVERY_STATUS[n % 5] })
  );
  for (const line of lines(render(issues))) {
    assert.ok(line.length <= WIDTH, `line is ${line.length} columns: ${JSON.stringify(line)}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: FAIL — `renderSnapshot is not a function`

- [ ] **Step 3: Write minimal implementation**

Aggiungi in `scripts/status-cli.mjs`, dopo `buildSnapshot`:

```javascript
// Local time, minute precision: this is read by a person who wants to know whether the tracker
// moved since they last looked, not by anything that parses it.
function formatWhen(lastUpdated) {
  if (!lastUpdated) return null;
  const when = new Date(lastUpdated);
  if (Number.isNaN(when.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ` +
    `${pad(when.getHours())}:${pad(when.getMinutes())}`
  );
}

// Segments are proportional, but a status holding at least one issue always gets a column: a
// single blocked issue among two hundred is exactly the thing worth seeing. The rounding error
// that leaves behind is absorbed by the widest segment, which is always big enough to take it.
function barSegments(counts) {
  const present = BAR_ORDER.filter((status) => counts[status] > 0);
  if (present.length === 0) return [];
  const total = present.reduce((sum, status) => sum + counts[status], 0);
  const segments = present.map((status) => ({
    status,
    width: Math.max(1, Math.floor((counts[status] / total) * BAR_INNER)),
  }));
  const drift = BAR_INNER - segments.reduce((sum, segment) => sum + segment.width, 0);
  const widest = segments.reduce((a, b) => (b.width > a.width ? b : a));
  widest.width += drift;
  return segments;
}

function renderBar(counts) {
  const segments = barSegments(counts);
  const inner = segments.map((s) => STATUS_ICON[s.status].repeat(s.width)).join("");
  return ` [${inner}]`;
}

function renderLegend(counts) {
  const parts = BAR_ORDER.filter((status) => counts[status] > 0).map(
    (status) => `${STATUS_ICON[status]} ${status} ${counts[status]}`
  );
  return `  ${parts.join("  ")}`;
}

export function renderSnapshot(snapshot, { project, lastUpdated }) {
  const total = Object.values(snapshot.counts).reduce((sum, n) => sum + n, 0);
  const when = formatWhen(lastUpdated);
  const out = [
    ` ${project} · ${total} issue${when ? ` · aggiornato ${when}` : ""}`,
    "═".repeat(WIDTH),
    renderBar(snapshot.counts),
    renderLegend(snapshot.counts),
  ];
  return out.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: PASS, 31 test

- [ ] **Step 5: Commit**

```bash
git add scripts/status-cli.mjs test/plugin-status-cli.test.mjs
git commit -m "feat: intestazione, barra proporzionale e legenda del riepilogo"
```

---

### Task 5: `renderSnapshot` — sezioni, righe e troncamento

**Files:**
- Modify: `scripts/status-cli.mjs`
- Test: `test/plugin-status-cli.test.mjs`

**Interfaces:**
- Consumes: `renderSnapshot` da Task 4, `TIER_ICON`, `TITLE_MAX`, `shortId`.
- Produces: l'output completo nel caso pieno — sezioni `IN CORSO` e `LAVORABILI`, riga di legenda dei tier in fondo.

- [ ] **Step 1: Write the failing test**

Aggiungi `TITLE_MAX` all'import e in fondo al file di test:

```javascript
test("an in-flight row carries icon, short id, status word, tier and title", () => {
  const out = render([
    issue("aaaaaaaa-1111-2222-3333-444444444444", {
      status: "in_progress",
      tier: "standard",
      title: "vista albero delle catene",
    }),
  ]);
  const row = lines(out).find((l) => l.includes("vista albero"));
  assert.equal(row, "  + aaaaaaaa  in_progress  $$   vista albero delle catene");
});

test("a workable row drops the status word: every one of them is backlog", () => {
  const out = render([issue("bbbbbbbb", { tier: "economy", title: "drawer con focus trap" })]);
  const row = lines(out).find((l) => l.includes("drawer con"));
  assert.equal(row, "  o bbbbbbbb  $    drawer con focus trap");
});

test("every tier gets its icon, and an undeclared tier gets a dash", () => {
  const out = render([
    issue("aaaaaaaa", { tier: "economy", title: "eco" }),
    issue("bbbbbbbb", { tier: "standard", title: "std" }),
    issue("cccccccc", { tier: "reasoning", title: "rsn" }),
  ]);
  assert.match(lines(out).find((l) => l.endsWith("eco")), /\$ {4}eco$/);
  assert.match(lines(out).find((l) => l.endsWith("std")), /\$\$ {3}std$/);
  assert.match(lines(out).find((l) => l.endsWith("rsn")), /\$\$\$ {2}rsn$/);

  const bare = render([issue("dddddddd", { tier: null, title: "senza tier" })]);
  assert.match(lines(bare).find((l) => l.includes("senza tier")), /- {4}senza tier$/);
});

test("a long title is cut to the limit with three ASCII dots", () => {
  const long = "filtri per tier nel board, con scorciatoie e tema a tre stati";
  const out = render([issue("aaaaaaaa", { status: "in_progress", title: long })]);
  const row = lines(out).find((l) => l.includes("filtri per tier"));
  const title = row.slice(row.indexOf("filtri"));
  assert.equal(title.length, TITLE_MAX);
  assert.ok(title.endsWith("..."), "the ellipsis must be three ASCII dots, never a single glyph");
  assert.ok(!title.includes("…"));
});

test("a title exactly at the limit is left alone", () => {
  const exact = "x".repeat(TITLE_MAX);
  const out = render([issue("aaaaaaaa", { status: "in_progress", title: exact })]);
  assert.ok(out.includes(exact));
  assert.ok(!out.includes("..."));
});

test("newlines inside a title cannot break the table", () => {
  const out = render([issue("aaaaaaaa", { status: "in_progress", title: "prima\nseconda" })]);
  assert.ok(out.includes("prima seconda"));
  for (const line of lines(out)) {
    assert.ok(line.length <= WIDTH);
  }
});

test("the workable heading always declares the real total", () => {
  const many = Array.from({ length: 7 }, (_, n) =>
    issue(`${n}`.padStart(8, "0"), { created_at: `2026-01-0${n + 1}T00:00:00Z` })
  );
  assert.ok(render(many).includes("LAVORABILI · 3 di 7"));
});

test("the tier legend closes the output", () => {
  const out = render([issue("aaaaaaaa")]);
  assert.match(
    lines(out).at(-1),
    /^ tier {2}\$ economy {3}\$\$ standard {3}\$\$\$ reasoning {3}- non dichiarato$/
  );
});

test("the section headings are the agreed words", () => {
  const out = render([issue("aaaaaaaa", { status: "in_progress" }), issue("bbbbbbbb")]);
  assert.ok(out.includes(" IN CORSO"), "the heading is IN CORSO, not IN VOLO");
  assert.ok(!out.includes("IN VOLO"));
  assert.ok(out.includes(" LAVORABILI · 1 di 1"));
});

test("no line is wider than eighty columns with the longest legal title", () => {
  const out = render([
    issue("aaaaaaaa", { status: "in_progress", tier: "reasoning", title: "x".repeat(80) }),
    issue("bbbbbbbb", { tier: "reasoning", title: "y".repeat(80) }),
  ]);
  for (const line of lines(out)) {
    assert.ok(line.length <= WIDTH, `line is ${line.length} columns: ${JSON.stringify(line)}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: FAIL — nessuna riga contiene `vista albero`, le sezioni non sono ancora rese

- [ ] **Step 3: Write minimal implementation**

In `scripts/status-cli.mjs`, aggiungi sopra `renderSnapshot`:

```javascript
const RULE = ` ${"─".repeat(WIDTH - 1)}`;

// A title is one line or it is not a table. Whitespace is collapsed first so a newline inside a
// title cannot smuggle a second row into the output.
function truncate(text, max) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3)}...`;
}

function tierIcon(tier) {
  return TIER_ICON[tier] ?? "-";
}

function inFlightRow(issue) {
  return (
    `  ${STATUS_ICON[issue.status]} ${shortId(issue.id).padEnd(8)}  ` +
    `${issue.status.padEnd(11)}  ${tierIcon(issue.tier).padEnd(3)}  ` +
    truncate(issue.title, TITLE_MAX)
  );
}

function workableRow(issue) {
  return (
    `  ${STATUS_ICON.backlog} ${shortId(issue.id).padEnd(8)}  ` +
    `${tierIcon(issue.tier).padEnd(3)}  ${truncate(issue.title, TITLE_MAX)}`
  );
}

const TIER_LEGEND = " tier  $ economy   $$ standard   $$$ reasoning   - non dichiarato";
```

e sostituisci il corpo di `renderSnapshot`:

```javascript
export function renderSnapshot(snapshot, { project, lastUpdated }) {
  const total = Object.values(snapshot.counts).reduce((sum, n) => sum + n, 0);
  const when = formatWhen(lastUpdated);
  const out = [
    ` ${project} · ${total} issue${when ? ` · aggiornato ${when}` : ""}`,
    "═".repeat(WIDTH),
    renderBar(snapshot.counts),
    renderLegend(snapshot.counts),
    "",
    " IN CORSO",
    RULE,
    ...snapshot.inFlight.map(inFlightRow),
    "",
    ` LAVORABILI · ${snapshot.workable.length} di ${snapshot.workableTotal}`,
    RULE,
    ...snapshot.workable.map(workableRow),
    RULE,
    TIER_LEGEND,
  ];
  return out.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: PASS, 41 test

- [ ] **Step 5: Commit**

```bash
git add scripts/status-cli.mjs test/plugin-status-cli.test.mjs
git commit -m "feat: sezioni in corso e lavorabili con troncamento a 45 colonne"
```

---

### Task 6: `renderSnapshot` — allerte e casi vuoti

**Files:**
- Modify: `scripts/status-cli.mjs`
- Test: `test/plugin-status-cli.test.mjs`

**Interfaces:**
- Consumes: `renderSnapshot` da Task 5.
- Produces: le righe `!` sopra la barra e le quattro rese dei casi vuoti. Firma invariata.

- [ ] **Step 1: Write the failing test**

Aggiungi in fondo al file di test:

```javascript
test("alerts sit above the bar, each behind an exclamation mark", () => {
  const out = render([
    issue("aaaaaaaa", { depends_on: ["bbbbbbbb"] }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
  ]);
  const rows = lines(out);
  const alertAt = rows.findIndex((l) => l.startsWith(" ! "));
  const barAt = rows.findIndex((l) => l.trim().startsWith("["));
  assert.ok(alertAt >= 0, "the cycle must reach the output");
  assert.ok(alertAt < barAt, "an alert below the bar is an alert nobody reads first");
  assert.match(rows[alertAt], /^ ! ciclo nei depends_on: /);
});

test("a healthy tracker prints no exclamation line", () => {
  const out = render([issue("aaaaaaaa", { status: "done" })]);
  assert.ok(!lines(out).some((l) => l.startsWith(" ! ")));
});

test("an alert line is wrapped, never allowed past eighty columns", () => {
  const many = Array.from({ length: 40 }, (_, n) => `${n}`.padStart(8, "0"));
  const issues = many.map((id, n) =>
    issue(id, { depends_on: [many[(n + 1) % many.length]] })
  );
  for (const line of lines(render(issues))) {
    assert.ok(line.length <= WIDTH, `line is ${line.length} columns: ${JSON.stringify(line)}`);
  }
});

test("an empty tracker says so and prints nothing else", () => {
  const out = renderSnapshot(buildSnapshot([]), { project: "harness", lastUpdated: null });
  assert.equal(out, " harness · tracker vuoto");
});

test("nothing in flight is itself the answer, so the section stays", () => {
  const out = render([issue("aaaaaaaa")]);
  const rows = lines(out);
  const at = rows.indexOf(" IN CORSO");
  assert.ok(at >= 0);
  assert.equal(rows[at + 2], "  nessuna issue aperta");
});

test("an empty backlog says there is nothing to take", () => {
  const out = render([issue("aaaaaaaa", { status: "in_progress" })]);
  const rows = lines(out);
  const at = rows.indexOf(" LAVORABILI · 0 di 0");
  assert.ok(at >= 0);
  assert.equal(rows[at + 2], "  niente in backlog");
});

test("a full backlog with nothing workable shows the standstill alert and the empty section", () => {
  const out = render([
    issue("aaaaaaaa", { status: "in_progress" }),
    issue("bbbbbbbb", { depends_on: ["aaaaaaaa"] }),
  ]);
  assert.ok(out.includes(" ! lavorabili 0 di 1 — ogni issue in backlog attende qualcosa"));
  assert.ok(out.includes(" LAVORABILI · 0 di 1"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: FAIL — nessuna riga inizia con `" ! "`, e il tracker vuoto rende intestazione e barra

- [ ] **Step 3: Write minimal implementation**

In `scripts/status-cli.mjs`, aggiungi sopra `renderSnapshot`:

```javascript
// An alert is data, and data must not run off the row. Wrapping keeps the ids readable where
// truncation would hide exactly the one you need.
function alertLines(alerts) {
  const rows = [];
  for (const alert of alerts) {
    let current = " !";
    for (const word of `${alert}`.split(" ")) {
      if (current.length + 1 + word.length > WIDTH) {
        rows.push(current);
        current = `   ${word}`;
      } else {
        current += ` ${word}`;
      }
    }
    rows.push(current);
  }
  return rows;
}
```

e sostituisci il corpo di `renderSnapshot`:

```javascript
export function renderSnapshot(snapshot, { project, lastUpdated }) {
  const total = Object.values(snapshot.counts).reduce((sum, n) => sum + n, 0);
  if (total === 0) {
    // Not an error and not a failure to read: a project that has not opened an issue yet.
    return ` ${project} · tracker vuoto`;
  }

  const when = formatWhen(lastUpdated);
  const out = [` ${project} · ${total} issue${when ? ` · aggiornato ${when}` : ""}`];
  out.push(...alertLines(snapshot.alerts));
  out.push(
    "═".repeat(WIDTH),
    renderBar(snapshot.counts),
    renderLegend(snapshot.counts),
    "",
    " IN CORSO",
    RULE,
    ...(snapshot.inFlight.length > 0
      ? snapshot.inFlight.map(inFlightRow)
      : ["  nessuna issue aperta"]),
    "",
    ` LAVORABILI · ${snapshot.workable.length} di ${snapshot.workableTotal}`,
    RULE,
    ...(snapshot.workable.length > 0
      ? snapshot.workable.map(workableRow)
      : ["  niente in backlog"]),
    RULE,
    TIER_LEGEND
  );
  return out.join("\n");
}
```

Attenzione: `" nessuna issue aperta"` compare quando `inFlight` è vuoto **anche** se il backlog è pieno, ed è corretto — è la verifica 1-WIP. `" niente in backlog"` compare quando `workable` è vuoto, sia perché il backlog è vuoto sia perché è in stallo; nel secondo caso l'allerta di stallo in cima dice quale dei due.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: PASS, 48 test

- [ ] **Step 5: Commit**

```bash
git add scripts/status-cli.mjs test/plugin-status-cli.test.mjs
git commit -m "feat: allerte e casi vuoti nella resa del riepilogo"
```

---

### Task 7: `main()` — contratto CLI e codici d'uscita

**Files:**
- Modify: `scripts/status-cli.mjs`
- Test: `test/plugin-status-cli.test.mjs`

**Interfaces:**
- Consumes: `buildSnapshot`, `renderSnapshot`.
- Produces: lo script eseguibile. Nessuna nuova esportazione — `main` non si esporta, si lancia.

- [ ] **Step 1: Write the failing test**

Aggiungi in cima al file di test, sotto gli import esistenti:

```javascript
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "status-cli.mjs");

function runIn(projectDir, args = []) {
  return spawnSync(process.execPath, [SCRIPT, "--project-dir", projectDir, ...args], {
    encoding: "utf8",
  });
}

function tempProject(tracker) {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-status-"));
  if (tracker !== undefined) {
    writeFileSync(path.join(dir, "issues.json"), tracker);
  }
  return dir;
}
```

e in fondo:

```javascript
test("a valid tracker prints the snapshot and exits zero", () => {
  const dir = tempProject(
    JSON.stringify({
      last_updated: "2026-08-04T09:12:00Z",
      issues: [issue("aaaaaaaa", { status: "in_progress", title: "prima issue" })],
    })
  );
  try {
    const run = runIn(dir);
    assert.equal(run.status, 0);
    assert.equal(run.stderr, "", "nothing goes to stderr, ever");
    assert.match(run.stdout, /IN CORSO/);
    assert.match(run.stdout, /prima issue/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the project name falls back to the directory when the tracker does not carry one", () => {
  const dir = tempProject(JSON.stringify({ last_updated: null, issues: [issue("aaaaaaaa")] }));
  try {
    assert.ok(runIn(dir).stdout.startsWith(` ${path.basename(dir)} · 1 issue`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a project with no issues.json is an empty tracker, not an error", () => {
  const dir = tempProject(undefined);
  try {
    const run = runIn(dir);
    assert.equal(run.status, 0);
    assert.match(run.stdout, /tracker vuoto/);
    assert.equal(run.stderr, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt issues.json fails loudly instead of printing a plausible screen", () => {
  const dir = tempProject("{ not json");
  try {
    const run = runIn(dir);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /non è un JSON valido/);
    assert.equal(run.stderr, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a project directory that does not exist fails", () => {
  const run = runIn(path.join(tmpdir(), "harness-status-does-not-exist"));
  assert.equal(run.status, 1);
  assert.match(run.stdout, /non esiste/);
  assert.equal(run.stderr, "");
});

test("an invented flag fails instead of printing a summary that looks right", () => {
  const dir = tempProject(JSON.stringify({ last_updated: null, issues: [] }));
  try {
    const run = runIn(dir, ["--watch"]);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /--project-dir/);
    assert.equal(run.stderr, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--help explains the usage and exits zero", () => {
  const run = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /status-cli\.mjs/);
  assert.equal(run.stderr, "");
});

test("stdout is text, not the one-line JSON the other scripts print", () => {
  const dir = tempProject(JSON.stringify({ last_updated: null, issues: [issue("aaaaaaaa")] }));
  try {
    assert.throws(() => JSON.parse(runIn(dir).stdout.split("\n")[0]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plugin-status-cli.test.mjs`
Expected: FAIL — lo script non stampa niente e non ha `main`

- [ ] **Step 3: Write minimal implementation**

Aggiungi in cima a `scripts/status-cli.mjs`, sotto il commento di testa:

```javascript
import { existsSync, readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
```

e in fondo al file:

```javascript
const USAGE = [
  "Usage:",
  "  node status-cli.mjs [--project-dir <path>] [--help]",
  "",
  "Prints one screen of tracker status: counts, what is in flight, what can be taken now.",
  "Output is text, not JSON, and nothing is ever written to stderr.",
  "",
  "--project-dir  directory holding issues.json (default: the current directory).",
  "               A project without issues.json reads as an empty tracker, not an error.",
  "",
  "Exit codes: 0 on success and on an empty tracker; 1 on a missing project directory, an",
  "unreadable issues.json, or an unknown flag.",
  "",
].join("\n");

function fail(message) {
  process.stdout.write(`${message}\n`);
  process.exit(1);
}

function resolveProjectDir(projectDir) {
  const dir = path.resolve(projectDir ?? process.cwd());
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`La directory di progetto '${dir}' non esiste.`);
  }
  return dir;
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
    // strict on purpose: an invented flag must stop here. A summary that looks right but answers
    // a different question is worse than no summary.
    fail(`${error.message.replace(/\.?$/, ".")} status-cli.mjs accetta solo --project-dir e --help.`);
  }

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const projectDir = resolveProjectDir(values["project-dir"]);
  const fallbackName = path.basename(projectDir);
  const trackerPath = path.join(projectDir, "issues.json");

  if (!existsSync(trackerPath)) {
    process.stdout.write(` ${fallbackName} · tracker vuoto\n`);
    return;
  }

  let data;
  try {
    data = JSON.parse(readFileSync(trackerPath, "utf8"));
  } catch {
    fail(`'${trackerPath}' non è un JSON valido: il tracker non è leggibile.`);
  }

  const issues = Array.isArray(data.issues) ? data.issues : [];
  const project = typeof data.project === "string" && data.project ? data.project : fallbackName;
  const rendered = renderSnapshot(buildSnapshot(issues), {
    project,
    lastUpdated: data.last_updated ?? null,
  });
  process.stdout.write(`${rendered}\n`);
}

// The two pure functions above are imported by the tests; main() must not run then.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`
Expected: PASS — l'intera suite, 56 test nel file nuovo e nessuna regressione altrove

- [ ] **Step 5: Commit**

```bash
git add scripts/status-cli.mjs test/plugin-status-cli.test.mjs
git commit -m "feat: contratto CLI e codici d'uscita di status-cli"
```

---

### Task 8: Lo slash command `/harness:status`

**Files:**
- Create: `commands/status.md`
- Modify: `test/plugin-commands.test.mjs:16`

**Interfaces:**
- Consumes: `scripts/status-cli.mjs` da Task 7.
- Produces: il comando invocabile. Nessuna interfaccia di codice.

Il test dei comandi impone cinque vincoli che il file nuovo deve rispettare: frontmatter con `description` di oltre 40 caratteri contenente «senza argomenti», `argument-hint` presente, nessun campo `name`, il corpo deve trattare il caso senza argomenti, ogni invocazione `node` deve passare da `${CLAUDE_PLUGIN_ROOT}`, ogni path `${CLAUDE_PLUGIN_ROOT}/...` deve esistere davvero, e il corpo deve linkare un file sotto `skills/harness/references/`.

- [ ] **Step 1: Write the failing test**

In `test/plugin-commands.test.mjs`, riga 16, aggiungi `status` alla lista:

```javascript
const COMMANDS = ["board", "compact", "issue", "status", "verify"];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plugin-commands.test.mjs`
Expected: FAIL — `commands/status.md must exist`

- [ ] **Step 3: Write minimal implementation**

Crea `commands/status.md`:

```markdown
---
description: Stampa un'istantanea del tracker — conteggi, cosa è in corso, cosa si può prendere adesso. Senza argomenti mostra il progetto corrente.
argument-hint: "[--project-dir <path>]"
allowed-tools: Bash
---

Istantanea del tracker del progetto corrente, in una schermata sola. Il contratto del tracker
che questo comando legge è in
`${CLAUDE_PLUGIN_ROOT}/skills/harness/references/issues.md`: qui non serve, il comando non
scrive niente.

Argomenti: `$ARGUMENTS` (vuoto = progetto corrente).

## Cosa fare

1. Lancia lo script:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/status-cli.mjs" [--project-dir <path>]
   ```

   `--project-dir` serve solo se la cwd non è la radice del progetto.

2. **Ristampa l'output verbatim, dentro un blocco di codice**, e basta.

   Non riformattarlo, non convertirlo in tabella markdown, non riordinare le sezioni, non
   accorciare i titoli già troncati, non tradurre le etichette. L'allineamento è già fatto a 80
   colonne: rifarlo consuma contesto e rende ogni invocazione diversa dalla precedente.

3. Aggiungi al massimo **una riga** tua, e solo se dice qualcosa che l'output non dice già —
   per esempio quale issue proponi di prendere fra le lavorabili. Il riepilogo parla da sé.

## Uscita diversa da zero

Lo script esce 1 e stampa una riga sola quando la directory di progetto non esiste, quando
`issues.json` non è un JSON valido, o quando un flag non esiste. Riporta quella riga così com'è
e fermati: non ritentare con flag inventati, lo script dichiara solo `--project-dir` e `--help`.

Un progetto senza `issues.json` **non** è un errore: esce 0 e stampa `tracker vuoto`.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/plugin-commands.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/status.md test/plugin-commands.test.mjs
git commit -m "feat: slash command /harness:status"
```

---

### Task 9: Aggancio nella skill e nel README

**Files:**
- Modify: `skills/harness/SKILL.md:31-35` (punto 5 del clock-in) e `skills/harness/SKILL.md:242-245` (clock out)
- Modify: `README.md:90-93` (tabella dei comandi)

**Interfaces:**
- Consumes: `commands/status.md` da Task 8.
- Produces: niente codice. È l'ultimo task: dopo questo il lavoro è completo.

- [ ] **Step 1: Sostituire il punto 5 del clock-in**

In `skills/harness/SKILL.md`, il punto 5 oggi lancia due volte `issue-manager.mjs` e chiede un riassunto scritto a mano. Sostituiscilo con il riepilogo, che risponde alla stessa domanda in un giro solo:

```markdown
5. **Stato del tracker** — stampa il riepilogo e ristampalo verbatim in un blocco di codice:
   ```bash
   node "$SCRIPTS/status-cli.mjs"
   ```
   Serve un dettaglio che il riepilogo non porta (description, criteri di validazione)?
   `issue-manager.mjs --get --issue-id <id>` sulla singola issue, non l'elenco intero.
```

- [ ] **Step 2: Aggiungere il riepilogo al clock out**

Sostituisci la sezione «Clock out (fine sessione)»:

```markdown
## Clock out (fine sessione)

Per ogni issue lavorata: lavoro concluso → `in_review` → verifica indipendente → `pass` →
commit dedicato. Poi ferma il board server avviato al clock-in.

Chiudi ristampando il riepilogo (`node "$SCRIPTS/status-cli.mjs"`, verbatim in un blocco di
codice): è il confronto con quello del clock-in, e dice in una schermata cosa si è mosso.
```

- [ ] **Step 3: Aggiungere la riga al README**

In `README.md`, nella tabella dei comandi, fra la riga di `/harness:issue` e quella di
`/harness:verify` — la tabella è in ordine alfabetico:

```markdown
| `/harness:status` | Prints one screen of tracker status: counts, what is in flight, what can be taken now | Reads the current project |
```

- [ ] **Step 4: Run the whole suite**

Run: `node --test`
Expected: PASS, nessuna regressione. `test/plugin-skill.test.mjs` legge `SKILL.md` e va verde.

- [ ] **Step 5: Commit**

```bash
git add skills/harness/SKILL.md README.md
git commit -m "feat: riepilogo del tracker a clock-in e clock-out"
```

---

## Verifica finale, fuori dai task

`CLAUDE.md` impone che ogni modifica al plugin sia provata **in una sessione reale di questo
repository**, e i componenti nuovi diventano invocabili solo dopo un riavvio della sessione di
Claude Code. Vale qui più che altrove: la superficie primaria di questo lavoro è proprio
l'invocazione in sessione.

Dopo l'ultimo commit:

1. Riavvia la sessione di Claude Code.
2. Invoca `/harness:status` in questo repository.
3. Controlla tre cose che `npm test` non può dimostrare: il comando compare ed è invocabile;
   l'agente ristampa il blocco senza riformattarlo; a 80 colonne la tabella regge nel terminale
   senza andare a capo.

Se il terzo punto fallisce, il difetto è la larghezza, non il codice: apri una issue, non
allargare le colonne di nascosto.
