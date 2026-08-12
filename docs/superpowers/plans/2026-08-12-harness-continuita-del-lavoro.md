# La continuità del lavoro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spostare il secondo invariante dal commit alla **pubblicazione**, e dare alla issue due
array di task strutturati — uno di esecuzione, uno di validazione — così che congelare il lavoro
diventi un sottoprodotto del lavorarlo invece di un rito da ricordare.

**Architecture:** Un campo nuovo per grana (`tasks` sulla issue, `validation.tasks` dentro
`validation`) in `issue-manager.mjs`, con la migrazione `2 → 3` accodata alla lista che `--upgrade`
già percorre. Tre guard nuovi nello stesso script, perché è l'unico posto in cui harness può
rendere una regola impossibile invece che sconsigliata. Due rendering che leggono i campi e non li
scrivono (`status-cli.mjs`, `board.html`). Il resto è prosa: il contratto dei campi in
`references/issues.md`, il flusso in `SKILL.md`, il confine di pubblicazione in `references/git.md`.

**Tech Stack:** Node.js ≥ 18 senza dipendenze (`node:util` `parseArgs`, `node:fs`, `node:crypto`);
`node:test` + `node:assert/strict`; `npm run test` come gate; markdown per skill, reference e
comandi; Tailwind/daisyUI via CDN nella sola `board.html`, come già è.

## Global Constraints

- **La spec di riferimento è**
  `docs/superpowers/specs/2026-08-10-harness-continuita-del-lavoro-design.md`. In caso di
  divergenza fra questo piano e la spec, **vince la spec**. Dove il piano decide qualcosa che la
  spec non fissa, lo dice esplicitamente (vedi «Le cinque decisioni che la spec non fissa»).
- **P1 e P2 sono già implementati e chiusi.** La bussola *costoso e invisibile*, la verifica
  leggera e la regola sulle prove fuori portata vivono in `SKILL.md`; `covers` e la migrazione
  `1 → 2` vivono in `issue-manager.mjs`. Non riscrivere niente di tutto questo: linkalo.
- **`SCHEMA_VERSION` va a 3**, e la migrazione si **accoda** alla lista `MIGRATIONS`. Le voci
  esistenti non si rinumerano, non si riordinano, non si modificano: il significato di `to: 1` non
  può cambiare sotto un tracker che si aggiorna tardi.
- **Nessuna dipendenza esterna.** Solo la standard library di Node.
- **Il contratto di output di `issue-manager.mjs` non cambia:** una riga di JSON su stdout, niente
  su stderr, `ok:true`/`ok:false` come oggi. `status-cli.mjs` resta testo su stdout.
- **Nessun endpoint di scrittura sul board.** Il board resta in sola lettura: si spunta solo dalla
  CLI, perché il guard anti-self-validation vive nell'environment del processo e un click nel
  browser non porta nessun ruolo.
- **Lingua italiana** nella prosa di skill, reference e comandi; **inglese** nei commenti del
  codice, nei messaggi di errore della CLI e nei nomi dei test, come tutto il repository. Le righe
  markdown si mandano a capo intorno a **95 colonne**. **Non riformattare i paragrafi che non stai
  modificando**: un reflow di massa nasconde la modifica vera.
- **Line ending preservati.** Il repository ha un `.gitattributes`; non convertire i fine riga di
  un file che stai modificando.
- **Workflow harness su sé stesso** (`CLAUDE.md`): ogni task finisce a `in_review`, **mai con un
  commit**. Il commit avviene solo dopo il `pass` del verificatore indipendente.
- **`issues.json` non si modifica a mano**, mai, nemmeno un campo: si passa sempre da
  `node scripts/issue-manager.mjs`. Per esercitare il tracker si usa una directory temporanea,
  come fa già la suite.
- **Lavorando inline il ruolo va dichiarato:** `$env:HARNESS_ROLE='worker'; node ...` su
  PowerShell, `HARNESS_ROLE=worker node ...` in bash.
- **Il gate è `npm run test`** e dev'essere verde alla fine di ogni task.
- **Nel file va solo ciò che sta dentro il blocco di codice.** La prosa che lo precede — note,
  avvertenze, riferimenti a «Task N» — parla a chi esegue il piano, non al lettore del file. È già
  successo che un'avvertenza finisse dentro una reference e venisse spedita come documentazione di
  harness, dove nessuno sa cosa sia un Task 4. Nessun test lo intercetta.

### Le cinque decisioni che la spec non fissa, prese qui

La spec descrive i due array, i guard e il rendering senza fissare cinque dettagli che il codice
incontra al primo giro. Sono decisi così, e le reference lo scrivono:

1. **Il confronto dell'aggiornamento appaiato ignora `checked`.** §3.3 chiede che prosa e
   decomposizione si tocchino insieme. Se «toccare i task» includesse la spunta, ogni allineamento
   al commit — cioè l'azione più frequente del workflow, §4 — richiederebbe il flag: verrebbe
   passato sempre, e il guard smetterebbe di significare qualcosa. Confrontiamo quindi la
   **decomposizione** (`id`, `short_title`, `full_description`), non lo stato di avanzamento.
2. **La prima materializzazione non è una divergenza.** Se la issue non ha ancora task, il guard
   appaiato non scatta: sta nascendo la decomposizione che §3.1 impone al clock-in, non si sta
   allontanando da una prosa che descriveva altro. Il guard difende una decomposizione **che
   esiste**.
3. **Sul lato validazione il guard vale solo a `state: "unknown"`.** Alla chiusura `criteria` non
   è più la lista di accettazione ma l'**evidenza** — la CLI già distingue i due momenti in
   `validateCriteria` — e pretendere che il verificatore tocchi anche i task per scrivere
   l'evidenza renderebbe il flag obbligatorio a ogni chiusura.
4. **`validation.tasks` sopravvive a un update che non lo nomina.** Il payload di chiusura è
   `{criteria, state}`: senza questa regola la chiusura cancellerebbe la checklist che ha appena
   giudicato. È la stessa semantica di merge che `--update` ha già al livello superiore. Per
   svuotarli si passa `"tasks": []` esplicito.
5. **Un `in_progress` senza task è rifiutato con `INVALID_INPUT`.** Il payload manca di un
   contenuto obbligatorio, e si corregge aggiungendolo: è la definizione di `INVALID_INPUT`.
   `INVALID_STATUS` resta per un valore fuori enum.

## File Structure

**Modificati:**

- `scripts/issue-manager.mjs` — i due array nello schema, i limiti, la migrazione `2 → 3`, i tre
  guard, il flag `--decomposition-unchanged`, `--help`.
- `scripts/status-cli.mjs` — la colonna del conteggio nelle righe `IN CORSO`, il nuovo troncamento.
- `scripts/board.html` — due righe di riepilogo per card, espansione, persistenza dell'espansione.
- `skills/harness/SKILL.md` — «Gate sul commit» → «Gate sulla pubblicazione»; il capitolo sui task
  (quando nascono, chi li spunta, l'ancoraggio al commit, il congelamento).
- `skills/harness/references/issues.md` — proprietaria dello schema: i due array, i limiti, la
  tabella dei campi in input, i codici di errore, il flag nuovo.
- `skills/harness/references/git.md` — commit locali liberi, `push`/merge come confine.
- `skills/harness/references/status.md` — la colonna nuova e il caso senza task.
- `skills/harness/references/board.md` — le due righe, l'espansione, la sola lettura riconfermata.
- `skills/harness/references/verification.md` — il verificatore spunta `validation.tasks`.
- `commands/issue.md`, `commands/verify.md` — retrofit minimo: chi scrive cosa.

**Test toccati:** `test/plugin-issue-manager.test.mjs`, `test/plugin-status-cli.test.mjs`,
`test/plugin-board.test.mjs`, `test/plugin-skill.test.mjs` (solo se un'asserzione esistente cita
una sezione rinominata).

**Nessun file nuovo.** Nessuno script nuovo, nessun comando nuovo: i campi vivono nella CLI che già
possiede lo schema, e il flusso nella skill che già possiede il workflow.

### Catene

- Task 1 → Task 2 → Task 3 → Task 7 (schema, guard, contratto, flusso).
- Task 1 → Task 4 (rendering `status-cli`).
- Task 1 → Task 5 (rendering board).
- Task 6 è **indipendente**: è doc-only e non tocca nessun campo. Può procedere in parallelo.

---

### Task 1: I due array nello schema, e la migrazione `2 → 3`

**Files:**
- Modify: `scripts/issue-manager.mjs` (intestazione, `LIMITS`, `SCHEMA_VERSION`, `MIGRATIONS`,
  `validateIssueInput`, `insertIssue`, `updateIssue`, `compactTracker`, `showHelp`)
- Test: `test/plugin-issue-manager.test.mjs`

**Interfaces:**
- Produces: `validateTasks(tasks, fieldName)`, `normalizeValidation(validation, existingValidation)`
  — usate da Task 2; `LIMITS.taskTitle = 60`, `LIMITS.taskDescription = 1200`;
  `SCHEMA_VERSION = 3`; la forma memorizzata `{ id, short_title, full_description, checked }` e
  `validation: { criteria, tasks, state }`, che Task 4 e Task 5 leggono.

- [ ] **Step 1: Scrivi i test che falliscono — forma e integrità dei task**

In coda a `test/plugin-issue-manager.test.mjs`, dopo la sezione `covers`:

```js
// tasks e validation.tasks — la decomposizione a uso dell'agente. description e
// validation.criteria restano prosa; questi due array sono la stessa cosa a grana fine, ed è ciò
// che rende il congelamento un sottoprodotto invece di un documento scritto a mano.

function task(id, overrides = {}) {
  return {
    id,
    short_title: `Task ${id}`,
    full_description: `Run the command and check the output for task ${id}`,
    checked: false,
    ...overrides,
  };
}

function insertWithTasks(dir, payload) {
  const file = path.join(dir, "payload.json");
  writeFileSync(
    file,
    JSON.stringify({ title: "T", description: "D", status: "backlog", ...payload }),
    "utf8"
  );
  return run(dir, ["--insert", "--issue-data-file", file]);
}

test("--insert stores tasks verbatim and reads them back", () => {
  const { dir } = setupTempProject();
  try {
    const data = assertOk(insertWithTasks(dir, { tasks: [task(1), task(2, { checked: true })] }));
    assert.equal(data.tasks.length, 2);
    assert.deepEqual(data.tasks[0], task(1));
    assert.equal(data.tasks[1].checked, true);
    assert.deepEqual(assertOk(run(dir, ["--get", "--issue-id", data.id])).tasks, data.tasks);
  } finally {
    cleanup(dir);
  }
});

test("tasks absent at --insert is stored as [], never as a missing key", () => {
  const { dir } = setupTempProject();
  try {
    const data = assertOk(insertWithTasks(dir, {}));
    assert.deepEqual(data.tasks, []);
    assert.ok("tasks" in data, "an absent tasks must materialize as an empty array");
  } finally {
    cleanup(dir);
  }
});

test("validation.tasks lives inside validation and materializes to []", () => {
  const { dir } = setupTempProject();
  try {
    const data = assertOk(
      insertWithTasks(dir, { validation: { criteria: ["the command exits 0"], state: "unknown" } })
    );
    assert.deepEqual(data.validation.tasks, []);
    const withTasks = assertOk(
      insertWithTasks(dir, {
        validation: { criteria: ["the command exits 0"], tasks: [task(1)], state: "unknown" },
      })
    );
    assert.deepEqual(withTasks.validation.tasks, [task(1)]);
  } finally {
    cleanup(dir);
  }
});

test("validation stays null when it is null: no tasks are invented for it", () => {
  const { dir } = setupTempProject();
  try {
    const data = assertOk(insertWithTasks(dir, { validation: null }));
    assert.equal(data.validation, null);
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: a task id must be a unique positive integer", () => {
  const { dir } = setupTempProject();
  try {
    assertFail(insertWithTasks(dir, { tasks: [task("1")] }), "INVALID_INPUT");
    assertFail(insertWithTasks(dir, { tasks: [task(1.5)] }), "INVALID_INPUT");
    assertFail(insertWithTasks(dir, { tasks: [task(0)] }), "INVALID_INPUT");
    assertFail(insertWithTasks(dir, { tasks: [task(1), task(1)] }), "INVALID_INPUT");
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: every task field is required, checked is a boolean, no extra fields", () => {
  const { dir } = setupTempProject();
  try {
    const { checked, ...noChecked } = task(1);
    assertFail(insertWithTasks(dir, { tasks: [noChecked] }), "INVALID_INPUT");
    assertFail(insertWithTasks(dir, { tasks: [task(1, { checked: "yes" })] }), "INVALID_INPUT");
    assertFail(insertWithTasks(dir, { tasks: [task(1, { short_title: "  " })] }), "INVALID_INPUT");
    assertFail(insertWithTasks(dir, { tasks: [task(1, { full_description: "" })] }), "INVALID_INPUT");
    assertFail(insertWithTasks(dir, { tasks: [{ ...task(1), owner: "me" }] }), "INVALID_INPUT");
    assertFail(insertWithTasks(dir, { tasks: "one, two" }), "INVALID_INPUT");
    assertFail(insertWithTasks(dir, { tasks: null }), "INVALID_INPUT");
  } finally {
    cleanup(dir);
  }
});

test("LIMIT_EXCEEDED: short_title over 60 characters, full_description over 1200", () => {
  const { dir } = setupTempProject();
  try {
    assertFail(insertWithTasks(dir, { tasks: [task(1, { short_title: "x".repeat(61) })] }), "LIMIT_EXCEEDED");
    assertFail(
      insertWithTasks(dir, { tasks: [task(1, { full_description: "x".repeat(1201) })] }),
      "LIMIT_EXCEEDED"
    );
    // The count of tasks is deliberately uncapped: a limit would push a caller to merge real steps
    // to make the payload fit, exactly as it would with depends_on.
    const many = Array.from({ length: 40 }, (_, i) => task(i + 1));
    assert.equal(assertOk(insertWithTasks(dir, { tasks: many })).tasks.length, 40);
  } finally {
    cleanup(dir);
  }
});

test("--update carries validation.tasks over when the payload does not name them", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      insertWithTasks(dir, {
        status: "in_review",
        tasks: [task(1, { checked: true })],
        validation: { criteria: ["the command exits 0"], tasks: [task(1)], state: "unknown" },
      })
    );
    const file = path.join(dir, "close.json");
    writeFileSync(
      file,
      JSON.stringify({ status: "done", validation: { criteria: "npm test: 88 passing", state: "pass" } }),
      "utf8"
    );
    const closed = assertOk(run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", file]));
    assert.deepEqual(
      closed.validation.tasks,
      [task(1)],
      "closing an issue must not delete the checklist it was judged against"
    );
    assert.equal(closed.validation.state, "pass");
  } finally {
    cleanup(dir);
  }
});

test("an explicit empty array clears the validation tasks", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      insertWithTasks(dir, {
        validation: { criteria: ["the command exits 0"], tasks: [task(1)], state: "unknown" },
      })
    );
    const file = path.join(dir, "clear.json");
    writeFileSync(
      file,
      JSON.stringify({ validation: { criteria: ["the command exits 0"], tasks: [], state: "unknown" } }),
      "utf8"
    );
    const updated = assertOk(run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", file]));
    assert.deepEqual(updated.validation.tasks, []);
  } finally {
    cleanup(dir);
  }
});
```

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
node --test test/plugin-issue-manager.test.mjs
```

Attesi in rosso: i campi `tasks` sono rifiutati come sconosciuti (`INVALID_INPUT` dove il test si
aspetta `ok:true`), e i test sui limiti passano per il motivo sbagliato. Non proseguire se un test
nuovo è verde: significa che sta misurando altro.

- [ ] **Step 3: Aggiungi i limiti, il validatore e la normalizzazione**

In `scripts/issue-manager.mjs`, estendi `LIMITS`:

```js
const LIMITS = {
  title: 80,
  description: 1200,
  criterion: 200,
  criteriaCount: 7,
  // Measured in characters and not in words: the real constraint is fitting one row of the
  // summary and one row of the board, and that is what the rendering measures. Counting words is
  // ambiguous across languages, hyphens and acronyms.
  taskTitle: 60,
  // Generous, not unlimited. High enough never to bite an index entry — a command, its expected
  // outcome, the pointer to the plan step — low enough to stop a manual. A LIMIT_EXCEEDED here
  // does not say "compress it", it says "that content is not a task".
  taskDescription: 1200,
};
```

Subito dopo `validateCoversShape`, aggiungi:

```js
// Helper: validate an array of tasks — the decomposition of the prose, one entry per step.
//
// Used for both arrays, because they have the same shape and differ only in who may write them:
// `tasks` is the execution checklist, materialized by whoever takes the issue, and
// `validation.tasks` is the judgement checklist, born with the issue. The role guard is what tells
// them apart, and it lives in enforceRolePolicy, not here.
//
// `id` is a positive integer, unique inside its own array and stable: it is local and ordinal —
// the useful reference is "task 4" — and a GUID would make it unreadable in the one context where
// it is read. No cap on the number of entries, for the reason depends_on has none: a cap pushes a
// caller to merge real steps to make the payload fit.
function validateTasks(tasks, fieldName) {
  if (!Array.isArray(tasks)) {
    fail(
      `'${fieldName}' must be an array of { id, short_title, full_description, checked }. Pass [] to clear it.`,
      "INVALID_INPUT"
    );
  }

  const seen = new Set();
  const allowed = ["id", "short_title", "full_description", "checked"];

  tasks.forEach((entry, index) => {
    const where = `${fieldName}[${index}]`;

    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`'${where}' must be an object with ${allowed.join(", ")}.`, "INVALID_INPUT");
    }

    const unknown = Object.keys(entry).filter((f) => !allowed.includes(f));
    if (unknown.length > 0) {
      fail(
        `Unknown field(s) in '${where}': ${unknown.join(", ")}. Allowed fields: ${allowed.join(", ")}.`,
        "INVALID_INPUT"
      );
    }
    for (const field of allowed) {
      if (!hasProp(entry, field)) {
        fail(`'${where}.${field}' is required.`, "INVALID_INPUT");
      }
    }

    if (typeof entry.id !== "number" || !Number.isInteger(entry.id) || entry.id < 1) {
      fail(`'${where}.id' must be a positive integer: it is a local ordinal reference, not a GUID.`, "INVALID_INPUT");
    }
    if (seen.has(entry.id)) {
      fail(`'${fieldName}' lists id ${entry.id} more than once: an id must name one task.`, "INVALID_INPUT");
    }
    seen.add(entry.id);

    if (isNullOrWhitespace(entry.short_title)) {
      fail(`'${where}.short_title' must be a non-empty string.`, "INVALID_INPUT");
    }
    validateLength(`${where}.short_title`, entry.short_title, LIMITS.taskTitle);

    if (isNullOrWhitespace(entry.full_description)) {
      fail(`'${where}.full_description' must be a non-empty string.`, "INVALID_INPUT");
    }
    validateLength(`${where}.full_description`, entry.full_description, LIMITS.taskDescription);

    if (typeof entry.checked !== "boolean") {
      fail(`'${where}.checked' must be a boolean.`, "INVALID_INPUT");
    }
  });
}

// Helper: build the validation object as it gets STORED.
//
// Two jobs, and both exist because a reader must never have to tell a missing key from an empty
// list — the same reason depends_on and covers are materialized on insert:
//   1. an absent `tasks` becomes [];
//   2. on --update, a payload that does not name `tasks` inherits the ones already stored.
// (2) is not a nicety: the closing payload is {criteria, state}, and without it every closure
// would delete the very checklist it just judged. Clearing them stays possible with "tasks": [].
// A null validation stays null: an issue with no criteria has no object to put tasks in.
function normalizeValidation(validation, existingValidation) {
  if (validation === null || validation === undefined) {
    return validation ?? null;
  }
  if (typeof validation !== "object" || Array.isArray(validation)) {
    return validation;
  }
  const inherited =
    existingValidation !== null &&
    typeof existingValidation === "object" &&
    !Array.isArray(existingValidation) &&
    Array.isArray(existingValidation.tasks)
      ? existingValidation.tasks
      : [];
  return {
    criteria: validation.criteria,
    tasks: hasProp(validation, "tasks") ? validation.tasks : inherited,
    state: validation.state,
  };
}
```

- [ ] **Step 4: Accetta i campi in input**

In `validateIssueInput`, estendi la lista dei campi ammessi e valida i due array:

```js
  const allowedFields = ["title", "description", "status", "validation", "tier", "depends_on", "covers", "tasks"];
```

Subito dopo il blocco `covers`, prima del blocco `validation`:

```js
  // tasks: optional everywhere, absent reads as []. The decomposition of `description` at the
  // grain the agent works on; the prose stays untouched next to it.
  if (hasProp(issue, "tasks")) {
    validateTasks(issue.tasks, "tasks");
  }
```

Dentro il blocco `validation`, estendi i campi ammessi e valida:

```js
    const allowedValidationFields = ["criteria", "state", "tasks"];
```

e, dopo `validateCriteria(v.criteria, v.state)`:

```js
    // The validation tasks live INSIDE validation and not beside it: everything that concerns the
    // judgement of an issue lives here, guard included, and splitting the notion across two places
    // in the schema would only make it easier to update one and forget the other.
    if (hasProp(v, "tasks")) {
      validateTasks(v.tasks, "validation.tasks");
    }
```

- [ ] **Step 5: Memorizza i campi in `--insert`, `--update` e `--compact`**

In `insertIssue`, dentro `storedIssue`, dopo `covers`:

```js
    // Always an array, never absent: status-cli and the board read this field on every issue, and
    // a missing key would push that check onto every reader instead of settling it here.
    tasks: hasProp(newIssue, "tasks") ? newIssue.tasks : [],
    validation: normalizeValidation(hasProp(newIssue, "validation") ? newIssue.validation : null, null),
```

(la riga `validation:` esistente va sostituita, non aggiunta.)

In `updateIssue`, dentro `storedIssue`, con la stessa forma di merge di `covers`:

```js
    tasks: hasProp(updatedIssue, "tasks")
      ? updatedIssue.tasks
      : Array.isArray(existing.tasks)
        ? existing.tasks
        : [],
    validation: normalizeValidation(
      hasProp(updatedIssue, "validation") ? updatedIssue.validation : existing.validation,
      existing.validation ?? null
    ),
```

In `compactTracker`, dentro `blockIssues`, dopo `covers: []`:

```js
    // A block summarises closed work: there is nothing left to execute and nothing left to judge.
    // The originals keep their own tasks, whole, inside the archive.
    tasks: [],
```

e dentro il suo `validation`, accanto a `criteria` e `state`:

```js
      tasks: [],
```

- [ ] **Step 6: Accoda la migrazione `2 → 3` e alza `SCHEMA_VERSION`**

```js
const SCHEMA_VERSION = 3;
```

In coda all'array `MIGRATIONS`, dopo la voce `to: 2`:

```js
  {
    to: 3,
    // 2 -> 3: materialize tasks: [] on the issue, and validation.tasks: [] on the issues that
    // carry a validation object. Same shape as the two migrations before it: an issue written
    // before the field already READS as "no tasks" everywhere else, and this only writes that
    // reading down. Nothing acquires a task, and no validation object is created for an issue
    // that had none — a null validation has nowhere to put them.
    migrateIssue(issue) {
      const needsTasks = !hasProp(issue, "tasks");
      const validation = issue.validation;
      const hasValidationObject =
        validation !== null &&
        validation !== undefined &&
        typeof validation === "object" &&
        !Array.isArray(validation);
      const needsValidationTasks = hasValidationObject && !hasProp(validation, "tasks");

      if (!needsTasks && !needsValidationTasks) {
        return issue;
      }
      const next = { ...issue };
      if (needsTasks) {
        next.tasks = [];
      }
      if (needsValidationTasks) {
        next.validation = { ...validation, tasks: [] };
      }
      return next;
    },
  },
```

- [ ] **Step 7: Aggiorna l'intestazione e `--help`**

Nel commento di intestazione dello script, nel blocco che descrive la struttura di una issue,
aggiungi le due chiavi:

```js
//     "covers": ["<git-ref>"],
//     "tasks": [ { "id": 1, "short_title": "<string>", "full_description": "<string>", "checked": false } ],
//     "validation": { "criteria": ["<string>"], "tasks": [ ... ], "state": "<unknown|pass|fail>" }|null,
```

e, dopo il paragrafo su `covers`:

```js
// tasks / validation.tasks: the decomposition of the prose at the grain the agent works on — one
// entry per step, { id, short_title, full_description, checked }. `tasks` are the execution steps,
// materialized by whoever takes the issue; `validation.tasks` are the judgement steps, born with
// the issue. Both are always stored as an array ([] when absent). They INDEX, they do not replace:
// full_description carries what it takes to act, not the analysis behind it. The ids are integers,
// unique inside their array, local and ordinal.
```

In `showHelp`, nella tabella dei campi in input, dopo la riga `covers`:

```js
    `  tasks        : array of { id, short_title (max ${LIMITS.taskTitle} chars), full_description (max ${LIMITS.taskDescription}), checked }`,
    "                 the execution steps; absent reads as [], [] clears it. ids are unique positive integers",
```

e nella riga di `validation`:

```js
    "  validation   : null OR { criteria, tasks, state: unknown|pass|fail }",
```

Nella descrizione di `--upgrade`, estendi l'elenco delle migrazioni:

```js
    "                fields with their default (0->1 materializes depends_on: [] where missing,",
    "                1->2 does the same with covers: [], 2->3 with tasks: [] and validation.tasks:",
    "                [] on the issues that carry a validation object); never touches or removes an",
    "                existing value. Idempotent: a file already at SCHEMA_VERSION returns",
    "                migrated: 0 and is NOT rewritten. A file declaring a schema_version ABOVE",
    "                SCHEMA_VERSION fails with SCHEMA_TOO_NEW and writes",
```

(sostituisce le righe corrispondenti; le successive restano invariate.)

- [ ] **Step 8: Scrivi i test della migrazione e di `--compact`**

In `test/plugin-issue-manager.test.mjs`, accanto ai test `(a)`–`(c)` di `--upgrade`:

```js
test("(d) 2 -> 3 materializes tasks and validation.tasks, and creates no validation where there was none", () => {
  const seed = {
    schema_version: 2,
    last_updated: "1970-01-01T00:00:00Z",
    issues: [
      {
        id: ID_ONE,
        title: "No validation",
        description: "D",
        status: "backlog",
        tier: null,
        depends_on: [],
        covers: [],
        validation: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: ID_TWO,
        title: "With validation",
        description: "D",
        status: "in_review",
        tier: null,
        depends_on: [],
        covers: [],
        validation: { criteria: ["the command exits 0"], state: "unknown" },
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
    ],
  };
  const { dir } = setupTempProject(seed);
  try {
    const data = assertOk(run(dir, ["--upgrade"]));
    assert.equal(data.from, 2);
    assert.equal(data.to, 3);
    assert.equal(data.migrated, 2);

    const after = JSON.parse(readFileSync(path.join(dir, "issues.json"), "utf8"));
    const [first, second] = after.issues;
    assert.deepEqual(first.tasks, []);
    assert.equal(first.validation, null, "a null validation must not grow a tasks array");
    assert.deepEqual(second.tasks, []);
    assert.deepEqual(second.validation.tasks, []);
    assert.deepEqual(second.validation.criteria, ["the command exits 0"]);
    assert.equal(second.validation.state, "unknown");

    // Idempotent down to the bytes, like every migration before it.
    const bytes = readFileSync(path.join(dir, "issues.json"), "utf8");
    assert.equal(assertOk(run(dir, ["--upgrade"])).migrated, 0);
    assert.equal(readFileSync(path.join(dir, "issues.json"), "utf8"), bytes);
  } finally {
    cleanup(dir);
  }
});

test("--compact archives the originals with their tasks and writes empty ones on the block", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      insertWithTasks(dir, {
        status: "in_review",
        tasks: [task(1, { checked: true })],
        validation: { criteria: ["the command exits 0"], tasks: [task(1)], state: "unknown" },
      })
    );
    const close = path.join(dir, "close.json");
    writeFileSync(
      close,
      JSON.stringify({ status: "done", validation: { criteria: "npm test: green", state: "pass" } }),
      "utf8"
    );
    assertOk(run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", close]));

    const blocks = path.join(dir, "blocks.json");
    writeFileSync(
      blocks,
      JSON.stringify({ blocks: [{ title: "Block", description: "One closed issue", issue_ids: [created.id] }] }),
      "utf8"
    );
    const result = assertOk(run(dir, ["--compact", "--issue-data-file", blocks]));

    const archived = JSON.parse(readFileSync(result.archivePath, "utf8"));
    assert.deepEqual(archived.issues[0].tasks, [task(1, { checked: true })]);
    assert.deepEqual(archived.issues[0].validation.tasks, [task(1)]);

    const after = JSON.parse(readFileSync(path.join(dir, "issues.json"), "utf8"));
    const block = after.issues.find((i) => i.id === result.blocks[0].id);
    assert.deepEqual(block.tasks, []);
    assert.deepEqual(block.validation.tasks, []);
  } finally {
    cleanup(dir);
  }
});

test("--help documents tasks and the 2 -> 3 migration", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /tasks/);
    assert.match(result.stdout, /2->3/);
  } finally {
    cleanup(dir);
  }
});
```

- [ ] **Step 9: Lancia la suite intera e falla passare**

```bash
npm run test
```

Attesa: tutto verde. Se un test **esistente** si rompe, guarda quale: un'asserzione che enumera le
chiavi di una issue o l'elenco dei campi ammessi va aggiornata (il campo nuovo è atteso); una che
riguarda `validation` memorizzata verbatim va letta con attenzione — la normalizzazione è
voluta, ma solo su `tasks`, mai su `criteria` o `state`.

- [ ] **Step 10: Porta la issue a `in_review`**

Nessun commit. Aggiorna la issue del tracker a `in_review` con `validation.state = unknown` e
fermati: la chiusura spetta al verificatore indipendente.

---

### Task 2: I tre guard, e il flag che dichiara invariata la decomposizione

**Files:**
- Modify: `scripts/issue-manager.mjs` (`enforceRolePolicy`, nuove `enforceTasksForProgress` e
  `enforcePairedUpdate`, `insertIssue`, `updateIssue`, `main`, `showHelp`)
- Test: `test/plugin-issue-manager.test.mjs`

**Interfaces:**
- Consumes: `validateTasks`, `normalizeValidation`, la forma memorizzata di Task 1.
- Produces: il flag CLI `--decomposition-unchanged` (booleano, solo su `--update`); i tre rifiuti
  `FORBIDDEN_ROLE` (spunta di `validation.tasks`), `INVALID_INPUT` (`in_progress` senza task) e
  `INVALID_INPUT` (aggiornamento non appaiato), che `references/issues.md` documenta in Task 3.

- [ ] **Step 1: Scrivi i test che falliscono**

```js
// I guard: la parte di questa spec che non è un campo ma una regola resa impossibile. Il tracker
// non impedisce di lavorare male; impedisce le tre mosse che rendono invisibile il lavorare male.

test("FORBIDDEN_ROLE: a worker cannot check a validation task", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      insertWithTasks(dir, {
        validation: { criteria: ["the command exits 0"], tasks: [task(1)], state: "unknown" },
      })
    );
    const file = path.join(dir, "check.json");
    writeFileSync(
      file,
      JSON.stringify({
        validation: {
          criteria: ["the command exits 0"],
          tasks: [task(1, { checked: true })],
          state: "unknown",
        },
      }),
      "utf8"
    );
    const refused = runWithRole(dir, ["--update", "--issue-id", created.id, "--issue-data-file", file], "worker");
    assertFail(refused, "FORBIDDEN_ROLE");

    // The same payload from a non-worker goes through: the guard is about the role, not the shape.
    assertOk(runWithRole(dir, ["--update", "--issue-id", created.id, "--issue-data-file", file], undefined));
  } finally {
    cleanup(dir);
  }
});

test("a worker may still check its own execution tasks", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(insertWithTasks(dir, { status: "in_progress", tasks: [task(1), task(2)] }));
    const file = path.join(dir, "tick.json");
    writeFileSync(file, JSON.stringify({ tasks: [task(1, { checked: true }), task(2)] }), "utf8");
    const data = assertOk(
      runWithRole(dir, ["--update", "--issue-id", created.id, "--issue-data-file", file], "worker")
    );
    assert.equal(data.tasks[0].checked, true);
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: in_progress is refused without at least one task, on insert and on update", () => {
  const { dir } = setupTempProject();
  try {
    assertFail(insertWithTasks(dir, { status: "in_progress" }), "INVALID_INPUT");
    assertFail(insertWithTasks(dir, { status: "in_progress", tasks: [] }), "INVALID_INPUT");
    assert.equal(assertOk(insertWithTasks(dir, { status: "in_progress", tasks: [task(1)] })).status, "in_progress");

    const backlog = assertOk(insertWithTasks(dir, {}));
    const file = path.join(dir, "start.json");
    writeFileSync(file, JSON.stringify({ status: "in_progress" }), "utf8");
    assertFail(run(dir, ["--update", "--issue-id", backlog.id, "--issue-data-file", file]), "INVALID_INPUT");

    const withTasks = path.join(dir, "start-with-tasks.json");
    writeFileSync(withTasks, JSON.stringify({ status: "in_progress", tasks: [task(1)] }), "utf8");
    assert.equal(
      assertOk(run(dir, ["--update", "--issue-id", backlog.id, "--issue-data-file", withTasks])).status,
      "in_progress"
    );
  } finally {
    cleanup(dir);
  }
});

test("an issue that already has tasks can go in_progress without resending them", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(insertWithTasks(dir, { tasks: [task(1)] }));
    const file = path.join(dir, "start.json");
    writeFileSync(file, JSON.stringify({ status: "in_progress" }), "utf8");
    assert.equal(assertOk(run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", file])).status, "in_progress");
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: description and its decomposition must move together", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(insertWithTasks(dir, { tasks: [task(1), task(2)] }));

    const proseOnly = path.join(dir, "prose.json");
    writeFileSync(proseOnly, JSON.stringify({ description: "A different plan entirely" }), "utf8");
    assertFail(run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", proseOnly]), "INVALID_INPUT");

    const tasksOnly = path.join(dir, "tasks.json");
    writeFileSync(tasksOnly, JSON.stringify({ tasks: [task(1), task(2), task(3)] }), "utf8");
    assertFail(run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", tasksOnly]), "INVALID_INPUT");

    // Together: accepted.
    const both = path.join(dir, "both.json");
    writeFileSync(
      both,
      JSON.stringify({ description: "A different plan entirely", tasks: [task(1), task(2), task(3)] }),
      "utf8"
    );
    assertOk(run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", both]));

    // Declared unchanged: accepted, and it is the caller who says so.
    const declared = path.join(dir, "declared.json");
    writeFileSync(declared, JSON.stringify({ description: "Reworded, same steps" }), "utf8");
    assertOk(
      run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", declared, "--decomposition-unchanged"])
    );
  } finally {
    cleanup(dir);
  }
});

test("ticking a task is progress, not a new decomposition: no flag needed", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(insertWithTasks(dir, { status: "in_progress", tasks: [task(1), task(2)] }));
    const file = path.join(dir, "tick.json");
    writeFileSync(file, JSON.stringify({ tasks: [task(1, { checked: true }), task(2)] }), "utf8");
    assertOk(run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", file]));
  } finally {
    cleanup(dir);
  }
});

test("the first materialization of tasks needs no flag: there is nothing to diverge from", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(insertWithTasks(dir, {}));
    const file = path.join(dir, "materialize.json");
    writeFileSync(file, JSON.stringify({ status: "in_progress", tasks: [task(1), task(2)] }), "utf8");
    assertOk(run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", file]));
  } finally {
    cleanup(dir);
  }
});

test("the paired rule applies to validation only while the criteria are the contract", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      insertWithTasks(dir, {
        status: "in_review",
        validation: { criteria: ["the command exits 0"], tasks: [task(1)], state: "unknown" },
      })
    );

    const criteriaOnly = path.join(dir, "criteria.json");
    writeFileSync(
      criteriaOnly,
      JSON.stringify({ validation: { criteria: ["something else entirely"], state: "unknown" } }),
      "utf8"
    );
    assertFail(run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", criteriaOnly]), "INVALID_INPUT");

    // At closure criteria carries the EVIDENCE, not the contract: the pairing does not apply, and
    // a verifier never has to pass a flag to close an issue.
    const closing = path.join(dir, "closing.json");
    writeFileSync(
      closing,
      JSON.stringify({ status: "done", validation: { criteria: "npm test: 88 passing", state: "pass" } }),
      "utf8"
    );
    assertOk(run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", closing]));
  } finally {
    cleanup(dir);
  }
});

test("clearing validation altogether is paired by construction", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      insertWithTasks(dir, {
        validation: { criteria: ["the command exits 0"], tasks: [task(1)], state: "unknown" },
      })
    );
    const file = path.join(dir, "clear.json");
    writeFileSync(file, JSON.stringify({ validation: null }), "utf8");
    assert.equal(assertOk(run(dir, ["--update", "--issue-id", created.id, "--issue-data-file", file])).validation, null);
  } finally {
    cleanup(dir);
  }
});
```

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
node --test test/plugin-issue-manager.test.mjs
```

Attesi in rosso tutti i test che si aspettano un rifiuto: oggi la CLI accetta tutto.
`--decomposition-unchanged` è ignorato da `parseArgs` (`strict: false`), quindi quel test passa
per il motivo sbagliato finché il guard non esiste — è normale a questo punto.

- [ ] **Step 3: Estendi il guard di ruolo**

In `enforceRolePolicy`, dopo il blocco su `validation.state === "pass"`:

```js
  if (
    hasProp(payload, "validation") &&
    payload.validation !== null &&
    typeof payload.validation === "object" &&
    Array.isArray(payload.validation.tasks) &&
    payload.validation.tasks.some((entry) => entry !== null && typeof entry === "object" && entry.checked === true)
  ) {
    fail(
      "Role 'worker' cannot check an entry of 'validation.tasks' (self-validation is forbidden). A " +
        "worker checks its own execution tasks; the judgement ones belong to the verifier, exactly " +
        "as validation.state does.",
      "FORBIDDEN_ROLE"
    );
  }
```

Aggiorna anche il paragrafo «Role guard» nell'intestazione dello script e in `showHelp`:

```js
    "Role guard: when env var HARNESS_ROLE=worker, --insert/--update requests that set",
    "status=done, validation.state=pass, or check an entry of validation.tasks are rejected with",
    "FORBIDDEN_ROLE (no self-validation). A worker may still set status up to in_review,",
    "validation.state up to unknown, and check its own 'tasks'.",
```

- [ ] **Step 4: Aggiungi il guard su `in_progress`**

Subito dopo `enforceRolePolicy`:

```js
// Helper: an issue in flight declares HOW it will be done, or it is not in flight.
//
// This is the point where "decided upstream" stops being an intention and becomes data: the agent
// that takes the issue is the one who knows the steps, and if they only live in its session they
// die with it. That is the cost this whole field exists to remove, and a rule nobody enforces is
// the rule that was already being skipped.
function enforceTasksForProgress(status, tasks) {
  if (status !== "in_progress") {
    return;
  }
  if (Array.isArray(tasks) && tasks.length > 0) {
    return;
  }
  fail(
    "An issue cannot go to 'in_progress' with an empty 'tasks': whoever takes it materializes the " +
      "steps first, so the tracker keeps them when the session that held them ends.",
    "INVALID_INPUT"
  );
}
```

In `insertIssue`, dopo `validateDependencyGraph(...)`:

```js
  enforceTasksForProgress(newIssue.status, hasProp(newIssue, "tasks") ? newIssue.tasks : []);
```

In `updateIssue`, subito prima di costruire `storedIssue` — sui valori **risultanti** dal merge,
non su quelli del payload, altrimenti una issue che ha già i task non potrebbe partire senza
rispedirli:

```js
  const mergedStatus = hasProp(updatedIssue, "status") ? updatedIssue.status : existing.status;
  const mergedTasks = hasProp(updatedIssue, "tasks")
    ? updatedIssue.tasks
    : Array.isArray(existing.tasks)
      ? existing.tasks
      : [];
  enforceTasksForProgress(mergedStatus, mergedTasks);
```

e usa `mergedTasks` nel campo `tasks:` di `storedIssue` al posto dell'espressione scritta in Task 1.

- [ ] **Step 5: Aggiungi il guard sull'aggiornamento appaiato**

Dopo `enforceTasksForProgress`:

```js
// Helper: the fingerprint of a decomposition — what the tasks SAY, not how far along they are.
// `checked` is deliberately out: ticking a task off is progress, and a rule that asked for the
// flag on every tick would be answered with the flag on every call, which is how a guard stops
// meaning anything.
function decompositionOf(tasks) {
  return JSON.stringify(
    (Array.isArray(tasks) ? tasks : []).map((entry) => [
      entry?.id ?? null,
      entry?.short_title ?? null,
      entry?.full_description ?? null,
    ])
  );
}

// Helper: prose and its decomposition move together, or neither moves (design §3.3).
//
// Without this the drift would be silent and worse than having no tasks at all: the verifier would
// measure one thing and the human would read another, and nothing would say so. It is the same
// philosophy with which the CLI already defends the DAG from cycles — impossible by construction,
// not discouraged in words.
//
// Two deliberate exemptions, both of which would otherwise turn the flag into a reflex:
//   - a decomposition that does not exist yet cannot diverge, so the first materialization is free;
//   - on the validation side the rule holds only while state is "unknown", because at closure
//     `criteria` carries the evidence and not the contract.
function enforcePairedUpdate(payload, existing, declaredUnchanged) {
  if (declaredUnchanged) {
    return;
  }

  const currentTasks = Array.isArray(existing.tasks) ? existing.tasks : [];
  if (currentTasks.length > 0) {
    const nextTasks = hasProp(payload, "tasks") ? payload.tasks : currentTasks;
    const proseMoved =
      hasProp(payload, "description") && payload.description !== existing.description;
    const tasksMoved = decompositionOf(nextTasks) !== decompositionOf(currentTasks);
    if (proseMoved !== tasksMoved) {
      fail(
        proseMoved
          ? "'description' changed while 'tasks' stayed as they were. The prose and its " +
              "decomposition describe the same work at two grains: update both, or pass " +
              "--decomposition-unchanged to declare that the steps still hold."
          : "'tasks' changed while 'description' stayed as it was. The prose and its " +
              "decomposition describe the same work at two grains: update both, or pass " +
              "--decomposition-unchanged to declare that the prose still holds.",
        "INVALID_INPUT"
      );
    }
  }

  // Clearing validation takes criteria and tasks away together: paired by construction.
  if (!hasProp(payload, "validation") || payload.validation === null) {
    return;
  }
  const currentValidation =
    existing.validation !== null && typeof existing.validation === "object" && !Array.isArray(existing.validation)
      ? existing.validation
      : null;
  if (currentValidation === null || payload.validation.state !== "unknown") {
    return;
  }
  const currentValidationTasks = Array.isArray(currentValidation.tasks) ? currentValidation.tasks : [];
  if (currentValidationTasks.length === 0) {
    return;
  }
  const nextValidationTasks = hasProp(payload.validation, "tasks")
    ? payload.validation.tasks
    : currentValidationTasks;
  const criteriaMoved =
    JSON.stringify(payload.validation.criteria) !== JSON.stringify(currentValidation.criteria);
  const validationTasksMoved =
    decompositionOf(nextValidationTasks) !== decompositionOf(currentValidationTasks);
  if (criteriaMoved !== validationTasksMoved) {
    fail(
      criteriaMoved
        ? "'validation.criteria' changed while 'validation.tasks' stayed as they were. Update both, " +
            "or pass --decomposition-unchanged."
        : "'validation.tasks' changed while 'validation.criteria' stayed as they were. Update both, " +
            "or pass --decomposition-unchanged.",
      "INVALID_INPUT"
    );
  }
}
```

- [ ] **Step 6: Passa il flag dalla riga di comando**

In `updateIssue`, cambia la firma e chiama il guard dopo aver trovato `existing`:

```js
function updateIssue(issueId, issueData, declaredUnchanged = false) {
```

```js
  const existing = issues[issueIndex];
  enforcePairedUpdate(updatedIssue, existing, declaredUnchanged);
```

In `main`, dentro `parseArgs`, accanto agli altri booleani:

```js
      "decomposition-unchanged": { type: "boolean" },
```

e nella chiamata:

```js
    updateIssue(issueId, issueData, values["decomposition-unchanged"] === true);
```

In `showHelp`, nella riga d'uso di `--update` e nel blocco «Passing the payload»:

```js
    "node issue-manager.mjs --update --issue-id <id> (--issue-data '<json>' | --issue-data-file <path>)",
    "                        [--decomposition-unchanged]",
```

```js
    "  --decomposition-unchanged  on --update only: declares that the prose and its tasks still",
    "                             describe the same steps, so one may move without the other.",
    "                             Without it, changing 'description' without 'tasks' (or",
    "                             'validation.criteria' without 'validation.tasks', while state is",
    "                             'unknown') is rejected with INVALID_INPUT. Ticking a task off is",
    "                             progress, not a new decomposition, and never needs the flag.",
```

- [ ] **Step 7: Lancia la suite e falla passare**

```bash
npm run test
```

Attesa: tutto verde. Se un test **esistente** di `--update` si rompe, quasi certamente cambia la
`description` di una issue che ha dei task: è il guard che funziona. Correggi il test spedendo
anche i task o passando il flag — non indebolire il guard.

- [ ] **Step 8: Porta la issue a `in_review`**

Nessun commit finché il verificatore non dà il `pass`.

---

### Task 3: `references/issues.md` — il contratto dei campi nuovi

**Files:**
- Modify: `skills/harness/references/issues.md`
- Test: `test/plugin-skill.test.mjs` (solo se un link o una sezione citata cambia nome)

**Interfaces:**
- Consumes: i limiti, i codici e il flag introdotti da Task 1 e Task 2. **Ogni numero scritto qui
  deve corrispondere a `LIMITS`**: la reference è la fonte per chi legge, il codice per chi esegue,
  e una divergenza fra i due è un bug documentale.

- [ ] **Step 1: Aggiorna lo schema della issue**

Nel blocco JSON sotto `## Schema della issue`, aggiungi le due chiavi:

```json
{
  "id": "<guid>",
  "title": "<string>",
  "description": "<string>",
  "status": "backlog|in_progress|in_review|blocked|done",
  "tier": "economy|standard|reasoning",
  "depends_on": ["<guid>"],
  "covers": ["<git-ref>"],
  "tasks": [{ "id": 1, "short_title": "<string>", "full_description": "<string>", "checked": false }],
  "validation": {
    "criteria": ["<string>"],
    "tasks": [{ "id": 1, "short_title": "<string>", "full_description": "<string>", "checked": false }],
    "state": "unknown|pass|fail"
  },
  "created_at": "<datetime>",
  "updated_at": "<datetime>"
}
```

- [ ] **Step 2: Scrivi il paragrafo dei due array**

Dopo il paragrafo di `covers` e prima di «**Semantica di `validation`**»:

```markdown
**`tasks` e `validation.tasks`** sono la **decomposizione** della prosa alla grana a cui l'agente
lavora: una voce per passo, `{ id, short_title, full_description, checked }`. `description` e
`validation.criteria` **restano invariati e restano prosa** — sono il registro con cui la issue
spiega a una persona cosa vuole e perché; i due array sono la stessa cosa all'altra grana, e
l'aggiornamento appaiato qui sotto impedisce che divergano.

I task **indicizzano, non sostituiscono**: `full_description` porta quanto serve ad agire — il
comando, l'esito atteso, il riferimento al passo di piano — non l'analisi che ci sta dietro. Il
tracker guadagna l'avanzamento, non diventa il documento: `issues.json` è committato e riletto a
ogni comando, e ogni lettura lo paga.

I **task di validazione stanno dentro `validation`**, non accanto: è lì che vive tutto ciò che
riguarda il giudizio, guard compreso, e tenerli fuori spargerebbe la stessa nozione in due punti
dello schema. Se `validation` è `null` — la verifica leggera di [SKILL.md](../SKILL.md) — non ci
sono task di validazione, e non ce n'è dove metterli.

Entrambi sono sempre array — assente vale `[]`, `[]` esplicito ripulisce — e `null` **non** è
ammesso, per lo stesso motivo di `depends_on` e `covers`. `id` è un intero positivo, unico dentro
il proprio array e stabile: è locale e ordinale, e un GUID lo renderebbe illeggibile nell'unico
contesto in cui si legge, dove il riferimento utile è «il task 4». **Nessun tetto al numero di
task**: la grana del livello sotto varia da progetto a progetto, e un limite spingerebbe ad
accorpare passi veri per far passare il payload.

**Quando si scrivono.** `validation.tasks` nascono **con la issue**, come i criteri: chi apre sa
cosa deve essere vero alla fine. `tasks` li materializza **chi prende la issue**, prima di
iniziare: è chi sa *come* arrivarci. La CLI lo impone — un `in_progress` con `tasks` vuoto viene
rifiutato con `INVALID_INPUT`.

**Un `--update` che non nomina `validation.tasks` li conserva.** Il payload di chiusura è
`{criteria, state}`: senza questa regola ogni chiusura cancellerebbe la checklist che ha appena
giudicato. Per svuotarli si passa `"tasks": []` esplicito.

**Aggiornamento appaiato.** Un `--update` che modifica `description` senza toccare `tasks` — o il
contrario — viene rifiutato con `INVALID_INPUT`, e così per `validation.criteria` e
`validation.tasks`. Il flag `--decomposition-unchanged` dichiara che la decomposizione regge
ancora ed è l'unica via d'uscita. È la stessa filosofia con cui la CLI difende il DAG dai cicli:
impossibile per costruzione, non sconsigliato a parole.

Tre cose che il guard **non** rifiuta, e non sono eccezioni ma la sua definizione:

- **spuntare un task** non è una nuova decomposizione: il confronto guarda `id`, `short_title` e
  `full_description`, mai `checked`. L'allineamento prima di ogni commit non chiede mai il flag;
- **la prima materializzazione** non diverge da niente: una issue senza task ancora non ha una
  decomposizione da cui allontanarsi;
- **alla chiusura** (`state` `pass` o `fail`) `criteria` porta l'evidenza e non più il contratto:
  la regola vale solo finché `state` è `unknown`.
```

- [ ] **Step 3: Aggiorna i limiti, la tabella dei campi e i codici**

Nella tabella sotto `## Limiti di formato`, aggiungi due righe:

```markdown
| `tasks[].short_title` | 60 caratteri |
| `tasks[].full_description` | 1200 caratteri |
```

e sotto la tabella:

```markdown
`short_title` si misura in **caratteri, non in parole**: il vincolo vero è che entri in una riga
del riepilogo e in una riga del board, ed è ciò che il rendering misura davvero. Contare parole è
ambiguo fra lingue, trattini e sigle. Gli stessi limiti valgono per `validation.tasks`.

Il tetto di `full_description` è **generoso ma non assente**: abbastanza alto da non mordere mai un
indice, abbastanza basso da fermare un manuale. Vale anche qui la regola di `LIMIT_EXCEEDED`: non
dice «comprimi», dice «quel contenuto non è un task» — e quasi sempre è un passo del piano, che sta
nel piano.
```

Nella tabella `### Campi accettati in input`, dopo la riga `covers`:

```markdown
| `tasks` | array | opzionale | opzionale | passi di esecuzione `{ id, short_title, full_description, checked }`; assente vale `[]`, `[]` ripulisce; `id` intero positivo e unico; `null` non è ammesso |
```

e sostituisci la riga `validation`:

```markdown
| `validation` | object \| null | opzionale | opzionale | `null` oppure `{ criteria, tasks, state: unknown\|pass\|fail }`; `criteria` array a `state: unknown`, stringa o array alla chiusura; `tasks` come sopra, e un `--update` che non li nomina li conserva |
```

Nella tabella `## Codici di errore`, estendi le due righe esistenti:

```markdown
| `INVALID_INPUT` | campo sconosciuto, obbligatorio mancante o vuoto, payload `{}` in update, `page-size` < 1, `criteria` di forma sbagliata (stringa a `state: unknown`, array vuoto, elemento non stringa o vuoto); `tasks`/`validation.tasks` non array, voce malformata, `id` non intero positivo o duplicato, `checked` non booleano; `in_progress` con `tasks` vuoto; aggiornamento non appaiato di prosa e decomposizione; in `--compact` anche `blocks` assente/vuoto, blocco vuoto, stesso id in due blocchi |
| `LIMIT_EXCEEDED` | `title`, `description` o un criterio oltre il limite di caratteri, più di 7 criteri, `short_title` oltre 60 o `full_description` oltre 1200 caratteri (vale anche per `title`/`description` di un blocco di `--compact`) |
| `FORBIDDEN_ROLE` | con `HARNESS_ROLE=worker`, tentativo di impostare `status=done`, `validation.state=pass` o di spuntare una voce di `validation.tasks`, oppure qualunque `--compact` |
```

Nel paragrafo finale su `FORBIDDEN_ROLE`, aggiungi una frase:

```markdown
Per lo stesso motivo un worker non può spuntare una voce di `validation.tasks`: spuntare un
criterio che misura il proprio lavoro è self-validation con un'altra sintassi.
```

- [ ] **Step 4: Documenta `--upgrade` e il flag nei comandi**

Nella sezione `## Comandi`, nel blocco di esempi, aggiungi sotto `--update`:

```bash
# aggiornare dichiarando invariata la decomposizione (prosa e task non si toccano insieme)
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id> \
  --issue-data-file <file> --decomposition-unchanged
```

Nella sezione `## `--upgrade``, aggiungi la migrazione nuova all'elenco:

```markdown
- `2 → 3` materializza `tasks: []` e, sulle issue che hanno un oggetto `validation`,
  `validation.tasks: []`. Una `validation` a `null` non ne guadagna uno: non c'è dove metterli.
```

- [ ] **Step 5: Controlla i link e lancia la suite**

```bash
npm run test
```

Attesa: `plugin-skill.test.mjs` verde — i link fra reference si risolvono, e nessuna sezione è
stata rinominata. Rileggi il diff cercando le due cose che i test non vedono: un numero che non
corrisponde a `LIMITS`, e una riga di prosa rivolta a chi esegue il piano invece che al lettore.

- [ ] **Step 6: Porta la issue a `in_review`**

---

### Task 4: `status-cli` — la colonna del conteggio

**Files:**
- Modify: `scripts/status-cli.mjs`
- Modify: `skills/harness/references/status.md`
- Test: `test/plugin-status-cli.test.mjs`

**Interfaces:**
- Consumes: `issue.tasks` come lo memorizza Task 1.
- Produces: `taskProgress(issue)` (esportata per i test), `TASKS_COL = 5`, `TITLE_MAX = 38`.

- [ ] **Step 1: Scrivi i test che falliscono**

In `test/plugin-status-cli.test.mjs`:

```js
test("an in-flight row carries the count of its execution tasks", () => {
  const rendered = renderSnapshot(
    buildSnapshot([
      issue("aaaaaaaa-0000-0000-0000-000000000000", {
        status: "in_progress",
        title: "Hop Angular 18 -> 19",
        tier: "reasoning",
        tasks: [
          { id: 1, short_title: "one", full_description: "d", checked: true },
          { id: 2, short_title: "two", full_description: "d", checked: true },
          { id: 3, short_title: "three", full_description: "d", checked: false },
        ],
      }),
    ]),
    { project: "P", lastUpdated: null }
  );
  const row = rendered.split("\n").find((line) => line.includes("Hop Angular"));
  assert.match(row, /2\/3/);
});

test("an issue with no tasks shows a dash, exactly like an undeclared tier", () => {
  const rendered = renderSnapshot(
    buildSnapshot([issue("bbbbbbbb-0000-0000-0000-000000000000", { status: "blocked", tasks: [] })]),
    { project: "P", lastUpdated: null }
  );
  const row = rendered.split("\n").find((line) => line.includes("bbbbbbbb"));
  assert.ok(row.includes(" - "), `a task-less row must show a dash: ${JSON.stringify(row)}`);
});

test("no row is wider than the screen once the count column is in", () => {
  const rendered = renderSnapshot(
    buildSnapshot([
      issue("cccccccc-0000-0000-0000-000000000000", {
        status: "in_progress",
        title: "x".repeat(200),
        tier: "reasoning",
        tasks: Array.from({ length: 12 }, (_, i) => ({
          id: i + 1,
          short_title: "t",
          full_description: "d",
          checked: i < 9,
        })),
      }),
    ]),
    { project: "P", lastUpdated: null }
  );
  for (const line of rendered.split("\n")) {
    assert.ok(line.length <= WIDTH, `row wider than ${WIDTH}: ${JSON.stringify(line)}`);
  }
});

test("taskProgress counts checked over total and never lies about zero", () => {
  assert.equal(taskProgress({ tasks: [] }), "-");
  assert.equal(taskProgress({}), "-");
  assert.equal(taskProgress({ tasks: [{ checked: false }, { checked: true }] }), "1/2");
  assert.equal(taskProgress({ tasks: [{ checked: true }] }), "1/1");
});
```

Aggiungi `taskProgress` all'import in testa al file, accanto a `TITLE_MAX`.

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
node --test test/plugin-status-cli.test.mjs
```

Atteso: `taskProgress is not a function` e le righe senza conteggio.

- [ ] **Step 3: Implementa la colonna**

In `scripts/status-cli.mjs`, aggiorna le costanti:

```js
export const WIDTH = 80;
export const BAR_INNER = 77; // WIDTH minus the leading space and the two brackets
// Narrower than it was: the count column took seven columns, and a title that runs over the edge
// breaks the table for every row, not just its own.
export const TITLE_MAX = 38;
// Five columns fit "12/34". A three-digit count makes the row longer instead of being truncated:
// a cut number lies, a long row does not.
export const TASKS_COL = 5;
export const WORKABLE_SHOWN = 3;
```

Accanto a `tierIcon`:

```js
// The count of execution tasks — the one datum whoever resumes the work was missing. It shows up
// where the summary actually runs: at a session boundary, which is where every resumption starts.
// A dash where there are no tasks, exactly like an undeclared tier: "none" is a normal state here,
// not a hole to fill. A backlog issue has none by design — the steps are materialized by whoever
// takes it — which is why this column belongs to the in-flight table only.
export function taskProgress(issue) {
  const tasks = Array.isArray(issue.tasks) ? issue.tasks : [];
  if (tasks.length === 0) {
    return "-";
  }
  return `${tasks.filter((task) => task && task.checked === true).length}/${tasks.length}`;
}
```

e nella riga:

```js
function inFlightRow(issue) {
  return (
    `  ${STATUS_ICON[issue.status]} ${shortId(issue.id).padEnd(8)}  ` +
    `${issue.status.padEnd(11)}  ${tierIcon(issue.tier).padEnd(3)}  ` +
    `${taskProgress(issue).padEnd(TASKS_COL)}  ` +
    truncate(issue.title, TITLE_MAX)
  );
}
```

- [ ] **Step 4: Lancia i test e verifica che passino**

```bash
node --test test/plugin-status-cli.test.mjs
```

Atteso: verde. Se un test esistente sulla larghezza fallisce, ricontrolla l'aritmetica: indentazione
2 + icona 1 + spazio 1 + id 8 + 2 + stato 11 + 2 + tier 3 + 2 + conteggio 5 + 2 + titolo 38 = 77.

- [ ] **Step 5: Aggiorna `references/status.md`**

Nella sezione che descrive le sezioni dell'output, dopo la descrizione della riga `IN CORSO`:

```markdown
La riga porta anche il **conteggio dei task di esecuzione** della issue, `spuntati/totali`, fra il
tier e il titolo. È l'unico dato che mancava a chi riprende il lavoro, e compare nel punto e nel
momento in cui il riepilogo gira davvero: a un confine di sessione.

Un `-` al posto del conteggio significa che la issue non ha task. Sulle issue in `blocked` scritte
prima del campo è la normalità; su una issue `in_progress` non può succedere, perché la CLI rifiuta
quel passaggio di stato senza almeno un task.

Il conteggio non compare fra le **lavorabili**: una issue in backlog non ha ancora task, e non è
una mancanza — i passi li materializza chi la prende.
```

Se il documento riporta un esempio di riga o cita il troncamento a 45 colonne, aggiornalo a 38 e
rigenera l'esempio con l'output reale del comando.

- [ ] **Step 6: Lancia la suite e porta la issue a `in_review`**

```bash
npm run test
```

---

### Task 5: Il board — due righe, e l'espansione

**Files:**
- Modify: `scripts/board.html`
- Modify: `skills/harness/references/board.md`
- Test: `test/plugin-board.test.mjs`

**Interfaces:**
- Consumes: `issue.tasks` e `issue.validation.tasks` come li memorizza Task 1.
- Produces: `progressBar(done, total)` e `renderTaskBlock(tasks, options)` — estratte dai test con
  `extractFunctions`, quindi **non devono leggere nessun global della pagina**: tutto arriva per
  argomento, come già fa `renderDependsOn`.

- [ ] **Step 1: Scrivi i test che falliscono**

In `test/plugin-board.test.mjs`, accanto ai test di `renderDependsOn`:

```js
test("progressBar fills only when the work is actually finished", async () => {
  const html = await fetchPage();
  const { progressBar } = extractFunctions(html, ["progressBar"]);

  assert.equal(progressBar(0, 0), "");
  assert.equal(progressBar(0, 4), "░".repeat(10));
  assert.equal(progressBar(4, 4), "▓".repeat(10));
  // 9 of 10 is not 10 of 10: a full bar must mean done, so anything short of it keeps a gap.
  assert.ok(progressBar(9, 10).endsWith("░"));
});

test("a card summarises its tasks in one row and hides them until expanded", async () => {
  const html = await fetchPage();
  const { renderTaskBlock } = extractFunctions(html, ["renderTaskBlock", "escapeHtml", "progressBar"]);

  const rendered = renderTaskBlock(
    [
      { id: 1, short_title: "one", full_description: "run the command", checked: true },
      { id: 2, short_title: "two", full_description: "read the output", checked: false },
    ],
    { issueId: "abc", kind: "exec", label: "task", expanded: new Set() }
  );

  assert.match(rendered, /<details/);
  assert.ok(!/\sopen[\s>]/.test(rendered), "a collapsed block must not carry the open attribute");
  assert.match(rendered, /1\/2/);
  assert.match(rendered, /one/);
  assert.match(rendered, /run the command/);
});

test("an expanded block stays expanded across a re-render", async () => {
  const html = await fetchPage();
  const { renderTaskBlock } = extractFunctions(html, ["renderTaskBlock", "escapeHtml", "progressBar"]);

  const rendered = renderTaskBlock([{ id: 1, short_title: "one", full_description: "d", checked: false }], {
    issueId: "abc",
    kind: "exec",
    label: "task",
    expanded: new Set(["abc:exec"]),
  });
  assert.match(rendered, /\sopen[\s>]/);
});

test("a card with no tasks renders no task block at all", async () => {
  const html = await fetchPage();
  const { renderTaskBlock } = extractFunctions(html, ["renderTaskBlock", "escapeHtml", "progressBar"]);

  const options = { issueId: "abc", kind: "exec", label: "task", expanded: new Set() };
  assert.equal(renderTaskBlock([], options), "");
  assert.equal(renderTaskBlock(null, options), "");
  assert.equal(renderTaskBlock(undefined, options), "");
});

test("task text is escaped like every other field on the card", async () => {
  const html = await fetchPage();
  const { renderTaskBlock } = extractFunctions(html, ["renderTaskBlock", "escapeHtml", "progressBar"]);

  const rendered = renderTaskBlock(
    [{ id: 1, short_title: "<script>alert(1)</script>", full_description: "<img onerror=x>", checked: false }],
    { issueId: "abc", kind: "exec", label: "task", expanded: new Set() }
  );
  assert.ok(!rendered.includes("<script>"));
  assert.ok(!rendered.includes("<img onerror"));
});

test("the board never writes: no method mutates issues.json", async () => {
  const dir = tempProject(seed([issue("11111111-1111-1111-1111-111111111111")]));
  const { child, url } = await startServer(dir);
  try {
    const before = readFileSync(path.join(dir, "issues.json"), "utf8");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      await fetch(new URL("api/issues", url), { method, body: method === "DELETE" ? undefined : "{}" });
    }
    assert.equal(
      readFileSync(path.join(dir, "issues.json"), "utf8"),
      before,
      "the board is read-only: the guard against self-validation lives in the process environment, " +
        "and a click in a browser carries no role"
    );
  } finally {
    child.kill();
  }
});
```

Se `fetchPage`, `readFileSync` o `issue()` non sono già disponibili nel file, usa gli helper che ci
sono (`startServer`, `tempProject`, `seed`) e aggiungi l'import mancante in testa; non
reimplementarli.

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
node --test test/plugin-board.test.mjs
```

Atteso: `extractFunctions` non trova `progressBar` né `renderTaskBlock`. Il test sui metodi HTTP
può già passare — il server oggi ignora il metodo e non scrive comunque: è un test di regressione,
e il suo valore è impedire che un endpoint di scrittura compaia dopo.

- [ ] **Step 3: Implementa il rendering**

In `scripts/board.html`, dopo `renderDependsOn`:

```js
    // Ten cells, and a full bar means finished. Rounding up at 95% would show a completed row for
    // work that is not, which is exactly the kind of "fresh-looking stale datum" the design refuses
    // elsewhere: anything short of every task checked keeps at least one empty cell.
    function progressBar(done, total) {
      const cells = 10;
      if (!total) return "";
      if (done >= total) return "▓".repeat(cells);
      const filled = Math.min(cells - 1, Math.floor((done / total) * cells));
      return "▓".repeat(filled) + "░".repeat(cells - filled);
    }

    // One summary row per array, and the tasks themselves only on expansion.
    //
    // The card hides nothing today — full description, every criterion, a chip per dependency — and
    // has no collapse mechanism at all. Twelve execution tasks and six validation ones always
    // visible would produce cards that fill the screen on their own, and the board would lose the
    // thing it exists for: seeing where the project stands at a glance. So expansion is a new
    // capability of the page, not a tweak.
    //
    // Everything arrives by argument — `expanded` included — because the test pulls this function
    // out of the served page and runs it where none of this page's globals exist.
    function renderTaskBlock(tasks, { issueId, kind, label, expanded }) {
      const items = Array.isArray(tasks) ? tasks.filter((t) => t && typeof t === "object") : [];
      if (items.length === 0) return "";

      const done = items.filter((t) => t.checked === true).length;
      const key = `${issueId}:${kind}`;
      const rows = items
        .map(
          (t) => `
            <li class="flex items-start gap-2">
              <span class="font-mono opacity-70">${t.checked === true ? "[x]" : "[ ]"}</span>
              <span>
                <span class="${t.checked === true ? "line-through opacity-60" : ""}">${escapeHtml(t.short_title)}</span>
                <span class="block text-xs opacity-60 preserve-newlines">${escapeHtml(t.full_description)}</span>
              </span>
            </li>`
        )
        .join("");

      return `
        <details class="mt-2 group" data-issue="${escapeHtml(issueId)}" data-kind="${escapeHtml(kind)}"${
          expanded && expanded.has(key) ? " open" : ""
        }>
          <summary class="flex items-center gap-2 cursor-pointer text-xs uppercase tracking-wide opacity-70">
            <i data-lucide="chevron-right" class="w-3 h-3 transition-transform group-open:rotate-90"></i>
            <span>${escapeHtml(label)}</span>
            <span class="font-mono normal-case tracking-normal">${progressBar(done, items.length)}</span>
            <span class="font-mono normal-case tracking-normal">${done}/${items.length}</span>
          </summary>
          <ul class="mt-2 space-y-1.5 text-sm">${rows}</ul>
        </details>`;
    }
```

In `issueCard`, aggiungi il blocco di esecuzione dopo la description e quello di validazione dentro
il riquadro «Validazione», sotto i criteri:

```js
            ${it.description ? `<p class="text-sm text-base-content/80 mt-2 preserve-newlines">${escapeHtml(it.description)}</p>` : ""}

            ${renderTaskBlock(it.tasks, { issueId: it.id, kind: "exec", label: "task", expanded: state.expanded })}
```

```js
          ${criteriaMarkup}
          ${renderTaskBlock(validation.tasks, {
            issueId: it.id,
            kind: "validation",
            label: "validazione",
            expanded: state.expanded,
          })}
```

- [ ] **Step 4: Rendi l'espansione persistente**

Nell'oggetto `state` della pagina, aggiungi il campo:

```js
      // Which task blocks the reader opened. Every push from the server rebuilds the list through
      // innerHTML, and without this an expansion would close itself at the first write — that is,
      // constantly, since writes are exactly what happens while the work is going on.
      expanded: new Set(),
```

e accanto a `bindSearch`, una funzione chiamata una volta nel boot (dove viene già chiamata
`bindSearch`):

```js
    function bindTaskExpansion() {
      // `toggle` does not bubble, so the listener has to run in the capture phase. One listener on
      // the container, never one per card: the cards are thrown away and rebuilt on every push.
      el.issuesList.addEventListener(
        "toggle",
        (event) => {
          const details = event.target;
          if (!details || details.tagName !== "DETAILS" || !details.dataset.issue) return;
          const key = `${details.dataset.issue}:${details.dataset.kind}`;
          if (details.open) {
            state.expanded.add(key);
          } else {
            state.expanded.delete(key);
          }
        },
        true
      );
    }
```

- [ ] **Step 5: Lancia i test e verifica che passino**

```bash
node --test test/plugin-board.test.mjs
```

- [ ] **Step 6: Guarda la pagina davvero**

Un test sul markup non dice se la card è leggibile. Avvia il board su un progetto temporaneo con
una issue che ha task di entrambi i tipi, apri l'URL, e controlla tre cose: la riga di riepilogo si
legge da chiusa, l'espansione mostra i task, e la card **non** riempie lo schermo da sola.

```powershell
Start-Process -FilePath node -ArgumentList "scripts/board-server.mjs","--port","3100" -PassThru
```

Fermalo col `pid` che la riga di avvio stampa.

- [ ] **Step 7: Aggiorna `references/board.md`**

Nella sezione che descrive la card:

```markdown
La card riassume i **task** della issue in una riga per array — barra e conteggio `spuntati/totali`
— e li mostra solo **espandendo**. È una capacità nuova della pagina: fino a qui la card non
nascondeva niente, e dodici task di esecuzione più sei di validazione sempre visibili avrebbero
prodotto card che riempiono lo schermo da sole, facendo perdere al board la cosa per cui esiste.

L'espansione è ricordata finché la pagina resta aperta: il server spinge un aggiornamento a ogni
scrittura di `issues.json`, cioè di continuo mentre si lavora, e un blocco che si richiude a ogni
push sarebbe inutilizzabile.

Una issue senza task non mostra nessuna riga: niente da riassumere, nessuno spazio occupato.
```

Nella sezione `## Cosa non fa`, rafforza la sola lettura:

```markdown
**Non si spunta dal browser.** Il board non ha nessun endpoint di scrittura, e non lo avrà: il
guard anti-self-validation vive nell'**environment del processo** — rifiuta perché chi invoca ha
`HARNESS_ROLE=worker` — e un click nel browser non porta con sé nessun ruolo. Per rispettarlo il
server dovrebbe deciderlo per conto proprio, cioè reimplementare in un secondo posto l'unica difesa
tecnica che harness possiede. I task si spuntano dalla CLI, come ogni altra modifica.
```

- [ ] **Step 8: Lancia la suite e porta la issue a `in_review`**

```bash
npm run test
```

---

### Task 6: L'invariante si sposta dal commit alla pubblicazione

**Files:**
- Modify: `skills/harness/SKILL.md` (invarianti, capitolo «Gate sul commit»)
- Modify: `skills/harness/references/git.md`
- Test: `test/plugin-skill.test.mjs`

**Interfaces:**
- Non consuma niente e non produce niente di eseguibile: è doc-only, e per questo è una catena
  indipendente. **Non tocca i due array**: se ti trovi a scrivere «task», sei nel task sbagliato.

- [ ] **Step 1: Riformula il secondo invariante**

In `SKILL.md`, nella lista «Invarianti, non negoziabili»:

```markdown
- **verifica indipendente su OGNI issue** — mai auto-verifica;
- **niente raggiunge il ramo condiviso prima del `pass`** assegnato dal verificatore;
- **nessun `pass` auto-assegnato** da chi ha svolto il lavoro.
```

- [ ] **Step 2: Riscrivi «Gate sul commit» come «Gate sulla pubblicazione»**

Sostituisci l'intero capitolo:

```markdown
## Gate sulla pubblicazione

**Niente raggiunge il ramo condiviso prima del `pass`.** Il commit locale su un ramo di lavoro è un
punto fermo, non una pubblicazione: è il `push` — o il merge — che il `pass` autorizza.

L'invariante stava sul commit, e contraddiceva il modello di verifica. Un criterio come «`git show
<sha> --numstat` sulla spec madre: 67 aggiunte, 0 cancellazioni» **non è controllabile prima che la
revisione esista**, e la regola sulle prove fuori portata ne chiede di committate, e `covers` nomina
revisioni che devono esistere. Chi lavorava scioglieva la contraddizione come poteva, in silenzio,
ogni volta. Spostata al confine di pubblicazione, la regola smette di contraddirsi: il verificatore
lavora su un commit che c'è e può usare `git show` e `git diff --stat`.

- **Il verificatore ci guadagna**: giudica artefatti reali, non promesse.
- **Il caso `fail` non chiede niente di speciale.** Una issue bloccata lascia commit sul ramo:
  restano lì, si corregge con altri commit, e si pubblica dopo il `pass`. È il funzionamento
  normale di git — nessuna storia da riscrivere.
- **Cade la corrispondenza uno-a-uno fra issue e commit.** Harness non prescrive di schiacciare la
  storia: prescrive che niente attraversi quel confine senza `pass`. Per questo `covers` è un
  array — una issue docs può coprire i sei commit locali di un tratto di lavoro, non uno solo.

Resta vietato pubblicare una issue `done`/`pass` che nessun altro agente ha verificato, o una
issue `blocked`. Se la verifica fallisce: nessuna pubblicazione finché la issue non viene ripresa,
corretta e riverificata.

Convenzioni di branch, messaggi e confine: [references/git.md](references/git.md).
```

- [ ] **Step 3: Aggiorna i riferimenti al vecchio capitolo**

Cerca nel repository le occorrenze del vecchio nome e le frasi che ancora legano il commit al
`pass`, e aggiornale una per una:

```bash
grep -rn "Gate sul commit\|commit SOLO dopo\|commit solo dopo il" skills/ commands/ agents/ README.md CONTRIBUTING.md
```

Nel capitolo «Clock out» di `SKILL.md`, la riga di flusso diventa:

```markdown
Per ogni issue lavorata: lavoro concluso → `in_review` → verifica indipendente → `pass` →
pubblicazione. Se durante la sessione hai avviato il board, fermalo adesso col `pid` della riga di
avvio.
```

Non riscrivere i capitoli che nominano il commit per altri motivi — il gate documentale continua a
scattare **dopo ogni commit**, ed è giusto così: guarda i commit, non le pubblicazioni.

- [ ] **Step 4: Riscrivi il confine in `references/git.md`**

Nella sezione `## Commit`, sostituisci il paragrafo di apertura:

```markdown
In inglese, piccoli, leggibili, legati a una modifica coerente. **Sul ramo di lavoro i commit sono
liberi**: sono punti fermi, e un lavoro lungo ne merita più di uno.

Il confine è la **pubblicazione**: `push` sul ramo condiviso, o merge. Niente lo attraversa prima
del `pass` del verificatore. Una issue che fallisce lascia i suoi commit sul ramo: si corregge con
altri commit e si pubblica dopo, senza riscrivere niente.
```

E in coda alla sezione:

```markdown
Non c'è più una corrispondenza obbligata fra una issue e un commit. Harness non chiede di
schiacciare la storia: chiede che al confine di pubblicazione ogni issue rappresentata di là abbia
il suo `pass`.
```

Nella checklist `## Revisione prima di fondere`, aggiungi in cima:

```markdown
- ogni issue rappresentata nei commit che stai per pubblicare ha il suo `pass`;
```

- [ ] **Step 5: Lancia la suite**

```bash
npm run test
```

Attesa: verde. `plugin-skill.test.mjs` controlla frontmatter e link; se un'asserzione cita il nome
del capitolo rinominato, aggiornala — è la stessa modifica, non un'eccezione.

- [ ] **Step 6: Porta la issue a `in_review`**

---

### Task 7: Il flusso dei task in `SKILL.md`, e il retrofit di verifica e comandi

**Files:**
- Modify: `skills/harness/SKILL.md`
- Modify: `skills/harness/references/verification.md`
- Modify: `commands/issue.md`, `commands/verify.md`
- Test: `test/plugin-skill.test.mjs`, `test/plugin-commands.test.mjs`

**Interfaces:**
- Consumes: i campi di Task 1, i guard di Task 2, il contratto scritto in Task 3 (che questo task
  **linka**, non ripete), il capitolo di pubblicazione di Task 6.

- [ ] **Step 1: Scrivi il capitolo dei task in `SKILL.md`**

Subito dopo il capitolo «Verifica leggera» e prima di «Verifica indipendente»:

```markdown
## I task: la issue dice anche a che punto è

`description` e `validation.criteria` sono prosa, e restano tali. Accanto a loro la issue porta due
array di task — `tasks` per l'esecuzione, `validation.tasks` per il giudizio — che sono la stessa
cosa alla grana a cui un agente lavora davvero. La forma e i limiti stanno in
[references/issues.md](references/issues.md); qui sta il flusso.

Prima esistevano lo stesso, ma nella testa della sessione: ogni agente rileggeva la prosa e ne
ricavava un albero di attività, a runtime, da capo, e leggermente diverso da quello dell'agente
prima. Quell'albero era la cosa su cui il lavoro procedeva, e moriva con la sessione.

**Non contraddicono la bussola.** La bussola governa dove scatta la **verifica indipendente**, cioè
dove si spende un agente intero; una checklist dentro la issue non crea nessun giro di verificatore
in più. Il tracker guadagna l'avanzamento, non diventa il documento: i task **indicizzano** il
livello a grana fine, non lo sostituiscono.

### I due momenti

**`validation.tasks` nascono con la issue**, come i criteri: chi apre sa cosa deve essere vero alla
fine. Se `validation` è `null` — la verifica leggera — non ce ne sono.

**`tasks` li materializza chi prende la issue**, al clock-in, prima di iniziare: è chi sa *come*
arrivarci. La CLI lo impone: un `in_progress` con `tasks` vuoto viene rifiutato. L'asimmetria è la
stessa che la bussola descrive al punto 3 — chiedere a chi apre di indovinare anche i passi
produrrebbe passi inventati, che il worker riscriverebbe comunque.

### Chi può spuntare cosa

Il worker spunta i propri task di **esecuzione**, mai quelli di **giudizio**: spuntare un criterio
che misura il proprio lavoro è self-validation con un'altra sintassi, e con `HARNESS_ROLE=worker`
la CLI lo rifiuta con `FORBIDDEN_ROLE`, come rifiuta `status=done` e `validation.state=pass`.

Per lo stesso motivo **il worker non cancella né riscrive i propri task di validazione**, come già
non può declassare i criteri: cancellare ciò che ti giudica e dichiararlo soddisfatto sono la
stessa mossa. Questo la CLI non lo impedisce — lo impedisci tu.

**Prosa e task si toccano insieme.** Un `--update` che riscrive la `description` senza rivedere i
`tasks` viene rifiutato; se la decomposizione regge davvero, lo si dichiara con
`--decomposition-unchanged`. Spuntare un task non è una nuova decomposizione e non chiede mai il
flag.

### L'ancoraggio al commit

**Prima di ogni commit, i task si allineano.** Il punto è scelto sui numeri: il commit è l'azione
più frequente del workflow, il doppio delle invocazioni del riepilogo, ed è già un momento
presidiato da harness.

È una **prescrizione, non una garanzia** — e la differenza col gate documentale è la forma del
danno quando salta: un gate saltato *perde* un promemoria, un allineamento saltato lascia il
tracker **indietro di un commit, non sbagliato**.

Ai due momenti che sono atti dichiarati — il **clock-out**, e l'istante in cui un umano dice
«congela» — l'allineamento è completo ed esplicito. Non sono riti impliciti: sono richieste.

**Il congelamento non ha bisogno di altro.** La decisione lasciata in sospeso — quella che alla
ripresa vale più di tutto il resto — è un task non spuntato il cui `short_title` è la decisione da
prendere. E lo stato di git non entra nel tracker: ramo, commit avanti, commit non spinti sono a un
comando di distanza e cambiano a ogni commit; duplicarli in `issues.json` produrrebbe un dato
stantio con l'aria di essere fresco. Il tracker dice cosa è fatto e cosa è aperto, git dice dov'è.
```

- [ ] **Step 2: Aggiorna il clock-in e il clock-out**

Nel passo 5 del clock-in («Scelta del lavoro»):

```markdown
5. **Scelta del lavoro** — identifica le issue su cui lavorare rispettando la regola 1-WIP qui
   sotto. Prima di portarne una a `in_progress`, materializza i suoi `tasks`: la CLI rifiuta il
   passaggio senza almeno un task, ed è lì che «predefinito a monte» smette di essere
   un'intenzione e diventa un dato.
```

Nel «Clock out», dopo la riga di flusso:

```markdown
Prima di chiudere, allinea i task di ogni issue toccata: è uno dei due momenti in cui
l'allineamento è un atto dichiarato, non un rito implicito.
```

- [ ] **Step 3: Estendi `references/verification.md`**

Nella lista «Cosa deve fare il verificatore», dopo il punto 1:

```markdown
2. **Spuntare i `validation.tasks`** man mano che li verifica, e lasciarli come stanno se non li
   ha verificati. Sono i suoi, non del worker: la CLI rifiuta a un processo `HARNESS_ROLE=worker`
   di spuntarne uno, come rifiuta `validation.state = pass`. Un task di validazione non spuntato su
   una issue chiusa `pass` è una contraddizione, e va risolta prima di chiudere — non dopo.
```

(rinumera i punti successivi.)

Nel blocco dei comandi di chiusura, una nota dopo l'esempio:

```markdown
Il payload di chiusura può omettere `validation.tasks`: la CLI conserva quelli già memorizzati
invece di cancellarli. Per spuntarli vanno rispediti per intero, con `checked` aggiornato.
```

- [ ] **Step 4: Retrofit dei due comandi**

In `commands/issue.md`, nella sezione `new`, dopo la frase sui criteri:

```markdown
Insieme ai criteri scrivi i `validation.tasks`: la decomposizione di ciò che il verificatore
dovrà controllare, una voce per passo. I `tasks` di esecuzione **non** si scrivono qui: li
materializza chi prende la issue, ed è la CLI a esigerli al passaggio a `in_progress`.
```

Nella sezione `update`:

```markdown
Prosa e decomposizione si toccano insieme: un aggiornamento che cambia la `description` senza
rivedere i `tasks` viene rifiutato. Se i passi reggono ancora, dichiaralo con
`--decomposition-unchanged` invece di inventare una modifica ai task.
```

In `commands/verify.md`, dove descrive cosa fa il verificatore:

```markdown
Il verificatore legge i `validation.criteria`, li confronta con gli artefatti reali, spunta i
`validation.tasks` che ha effettivamente verificato, esegue il comando di verifica del progetto e
chiude la issue.
```

- [ ] **Step 5: Lancia la suite**

```bash
npm run test
```

Attesa: verde, `plugin-commands.test.mjs` compreso — controlla frontmatter e struttura dei comandi,
e la prosa aggiunta non li tocca.

- [ ] **Step 6: Rileggi il diff cercando la prosa di piano**

Cerca nel diff le parole «Task», «Step», «piano», «spec»: se compaiono in un file spedito come
documentazione di harness, sono finite lì per errore.

- [ ] **Step 7: Porta la issue a `in_review`**

---

## Dopo i sette task

**Il tracker di questo repository va portato allo schema 3.** Non è uno dei task: è un'operazione
sui dati reali, e si fa **dopo** che il codice della migrazione è stato verificato e pubblicato,
esattamente come è già successo per lo schema 2.

```powershell
node scripts/issue-manager.mjs --upgrade
```

Attesa: `{"ok":true,"data":{"from":2,"to":3,"migrated":<n>}}`, dove `<n>` è il numero di issue del
tracker. Il file va poi committato come `chore:`, da solo. **Non modificarlo a mano** e non
provare la migrazione su questo file: per quello c'è la directory temporanea della suite.

**Poi la prova che nessun test può dare.** I componenti del plugin appena scritti diventano
invocabili solo dopo un riavvio della sessione di Claude Code: riavvia, e in una sessione reale di
questo repository apri una issue con i suoi `validation.tasks`, materializzane i `tasks` portandola
a `in_progress`, spuntane uno, e guarda il riepilogo e il board. È il gate che `CLAUDE.md` impone e
che `npm test` non sostituisce.

## Self-review

Copertura della spec, sezione per sezione:

| Spec | Task |
|---|---|
| §1 L'invariante si sposta alla pubblicazione | Task 6 |
| §2 I due array di task | Task 1 |
| §2.1 Rapporto col livello a grana fine | Task 3, Task 7 |
| §2.2 Limiti di formato | Task 1 (`LIMITS`), Task 3 (contratto) |
| §3.1 I due momenti | Task 2 (guard `in_progress`), Task 7 (flusso) |
| §3.2 Il guard si estende | Task 2 (`FORBIDDEN_ROLE`), Task 7 (divieto di riscrittura) |
| §3.3 Prosa e task si toccano insieme | Task 2 (guard + flag), Task 3 (contratto) |
| §4 L'ancoraggio al commit | Task 7 |
| §5.1 `status-cli` | Task 4 |
| §5.2 Il board | Task 5 |
| §5.3 La decisione aperta non ha un campo | Task 7 (è un task non spuntato) |
| §5.4 Lo stato git non entra nel tracker | Task 7 (scritto per negazione) |
| §6.1 Il rovesciamento del grafo esce | nessun task, ed è il punto |
| §7 Come si verifica | i test di Task 1, 2, 4, 5 |

Due cose che questo piano **non** fa, e per scelta:

- **nessuna automazione della spunta.** Agganciarla a un hook riporterebbe il modello v1 che il
  passaggio a plugin ha rimosso: l'allineamento è una prescrizione a chi lavora, e la spec lo dice
  senza girarci intorno;
- **nessun campo per lo stato congelato**, nessun puntatore a un documento esterno: con i task
  strutturati lo stato *è* nel tracker.
