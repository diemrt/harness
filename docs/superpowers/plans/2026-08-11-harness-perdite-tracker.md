# Il tracker non perde più quello che il lavoro scopre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare a harness un modo di **accorgersi** che il gate documentale è saltato — uno script
cumulativo che risponde «quali commit hanno toccato codice senza che nessuna issue li nomini» — e
un modo di **setacciare** i documenti per le occasioni che hanno scoperto e non tracciato.

**Architecture:** Uno script nuovo (`scripts/docs-gate.mjs`), costruito come `status-cli.mjs`: una
funzione pura che decide, provata con oggetti in memoria, e un guscio che parla con git e stampa
testo. Un campo nuovo sullo schema (`covers`, array di riferimenti git) con la sua migrazione
`1 → 2` in `issue-manager.mjs`. Due reference nuove che **possiedono i contratti**
(`references/docs-gate.md`, `references/sweep.md`) e due comandi sottili che vi rimandano. Il
setaccio non ha nessuno script: è tutto giudizio, e usa `--get-all` e `--insert` che esistono già.

**Tech Stack:** Node.js ≥ 18 senza dipendenze (`node:util` `parseArgs`, `node:child_process`
`spawnSync`, `node:fs`); `node:test` + `node:assert/strict`; `npm run test` come gate; markdown
per skill, reference e comandi.

## Global Constraints

- **La spec di riferimento è**
  `docs/superpowers/specs/2026-08-10-harness-perdite-tracker-design.md`. In caso di divergenza fra
  questo piano e la spec, **vince la spec**.
- **P1 è già implementato e chiuso** (commit `2fc7dcd`, `d607a51`, `c256374`): la bussola *costoso
  e invisibile* esiste in `SKILL.md` ed è ciò a cui il setaccio rimanda. Non riscriverla, linkala.
- **Nessuna dipendenza esterna.** Solo la standard library di Node. Niente `minimatch`, niente
  librerie git: il matching dei glob e la lettura della storia si fanno a mano, sul sottoinsieme
  che serve.
- **`docs-gate.mjs` è autonomo:** risolve il progetto, legge `.harness/config.json` e `issues.json`
  per conto suo, e **non importa niente** dagli altri script del plugin. Esporta le sue funzioni
  pure *solo* perché i test le importino, esattamente come fa `status-cli.mjs` con `buildSnapshot`
  — è la lettura di §1 che §7 impone («provata come `buildSnapshot` di `status-cli`: nessun
  repository finto, nessun processo»).
- **Testo su stdout, mai JSON, mai niente su stderr**, per `docs-gate.mjs`. `issue-manager.mjs`
  resta com'è: una riga di JSON.
- **Lingua italiana** nella prosa di skill, reference e comandi; **inglese** nei commenti del
  codice e nei nomi dei test, come tutto il repository. Le righe markdown si mandano a capo
  intorno a **95 colonne**. **Non riformattare i paragrafi che non stai modificando**: un reflow di
  massa nasconde la modifica vera.
- **Line ending preservati.** Il repository ha un `.gitattributes`; non convertire i fine riga di
  un file che stai modificando.
- **Workflow harness su sé stesso** (`CLAUDE.md`): ogni task finisce a `in_review`, **mai con un
  commit**. Il commit avviene solo dopo il `pass` del verificatore indipendente, un commit per
  issue.
- **`issues.json` non si modifica a mano**, mai, nemmeno un campo: si passa sempre da
  `node scripts/issue-manager.mjs`.
- **Lavorando inline il ruolo va dichiarato:** `$env:HARNESS_ROLE='worker'; node ...` su
  PowerShell, `HARNESS_ROLE=worker node ...` in bash.
- **Il gate è `npm run test`** e dev'essere verde alla fine di ogni task.
- **Nel file va solo ciò che sta dentro il blocco di codice.** La prosa che lo precede — note,
  avvertenze, blockquote — parla a chi esegue il piano, non al lettore del file. È già successo
  una volta: un'avvertenza su «Task 4» è finita dentro `references/issues.md` ed è stata spedita
  come documentazione di harness, dove nessuno sa cosa sia un Task 4. Nessun test lo intercetta:
  i controlli strutturali guardano i link, non a chi è rivolto il testo.
- **Il passaggio a `in_review` scrive solo lo stato.** Non allegare l'evidenza in
  `validation.criteria`: con `state: "unknown"` la CLI esige un **array** di criteri brevi e
  rifiuta una stringa libera con `INVALID_INPUT` — la stringa di evidenza è ammessa solo alla
  chiusura, che è del verificatore. I criteri scritti alla creazione restano dove sono, ed è
  giusto: sono il contratto su cui la issue verrà giudicata, non un campo da sovrascrivere con un
  resoconto. L'evidenza del worker va nel suo report, e nel tracker ce la mette il verificatore.

### Due decisioni che la spec non fissa, prese qui

La spec §1.5 elenca i casi di uscita `1` («progetto inesistente, `issues.json` illeggibile, flag
sconosciuto, git non disponibile») senza nominarne altri due che il codice incontra. Sono decisi
così, e le reference lo scrivono:

1. **Nessuna revisione dichiarata e nessun `--since` → uscita `1`.** Non è la stessa cosa di «ho
   trovato commit scoperti», che è un *risultato* e esce `0`. Qui lo script **non ha risposto**, e
   chi ha chiamato deve cambiare l'invocazione e rilanciare — cioè esattamente la classe di «flag
   sconosciuto», che la spec mette a `1`. Il contratto «`1` significa: la richiesta non è stata
   eseguita» resta intatto.
2. **`.harness/config.json` assente → uscita `1`.** Il gate legge da lì quali file contano come
   codice, e indovinarlo in silenzio è la cosa che `references/config.md` vieta. Un `docsGate`
   *parziale* dentro un config esistente è invece completato campo per campo con i default, come
   fa già `harness-config.mjs` in `initConfig()`.

## File Structure

| File | Cosa cambia | Task |
|---|---|---|
| `scripts/issue-manager.mjs` | `covers`: validazione, `--insert`, `--update`, `SCHEMA_VERSION` `1 → 2`, migrazione, blocchi di `--compact`, `--help` | 1 |
| `test/plugin-issue-manager.test.mjs` | test nuovi su `covers`; tre aspettative esistenti aggiornate allo schema 2 | 1 |
| `skills/harness/references/issues.md` | `covers` nello schema, nella tabella dei campi, in `--upgrade`, in `schema_version`, in `--init` | 1 |
| `scripts/docs-gate.mjs` | **nuovo** — parte pura: glob, riferimenti dichiarati, decisione, render | 2 |
| `scripts/docs-gate.mjs` | guscio: config, git, finestra, risoluzione, `main()`, codici d'uscita | 3 |
| `test/plugin-docs-gate.test.mjs` | **nuovo** — parte pura in memoria (task 2), end-to-end con `spawnSync` su un repo git temporaneo (task 3) | 2, 3 |
| `skills/harness/references/docs-gate.md` | **nuova** — il contratto dello script | 4 |
| `commands/docs-gate.md` | **nuovo** — guscio che lancia e rimanda | 4 |
| `skills/harness/references/sweep.md` | **nuova** — il procedimento del setaccio | 5 |
| `commands/sweep.md` | **nuovo** — guscio che lancia e rimanda | 5 |
| `test/plugin-commands.test.mjs` | `COMMANDS` guadagna `docs-gate` (task 4) e `sweep` (task 5) | 4, 5 |
| `README.md` | la tabella dei comandi guadagna una riga per task | 4, 5 |
| `skills/harness/SKILL.md` | capitolo del gate riscritto, riga sul setaccio, indice delle reference | 6 |
| `test/plugin-skill.test.mjs` | test nuovo: nessuno script orfano | 6 |
| `commands/issue.md`, `commands/compact.md` | il giudizio esce e va nella reference; i comandi si accorciano | 7 |
| `skills/harness/references/issues.md` | riceve il giudizio spostato dai due comandi | 7 |

### Catene di dipendenza

**Non sono tre catene indipendenti: sono due, e una è quasi tutta in fila.**

- **Catena A — il gate:** 1 → 2 → 3 → 4 → 6. Task 2 e 3 scrivono lo stesso file, in due strati;
  Task 4 documenta ciò che 3 finisce; Task 6 nomina in `SKILL.md` lo script che 3 rende
  lanciabile, e ci aggancia il test dello script orfano, che senza Task 4 fallirebbe.
- **Catena B — il setaccio e il retrofit:** 5 e 7 non dipendono da nessuna delle precedenti *per
  contenuto*. Ma **Task 5 e Task 4 toccano entrambi `test/plugin-commands.test.mjs` e
  `README.md`**, e **Task 7 e Task 1 toccano entrambi `references/issues.md`**: vanno serializzati
  con i loro omologhi, non lanciati in parallelo.

Ordine sicuro, uno alla volta: **1 → 2 → 3 → 4 → 5 → 6 → 7**. Chi vuole parallelizzare può far
avanzare 7 insieme a 2/3 (`issues.md` è libero dopo il `pass` di Task 1), mai insieme a 1.

---

### Task 1: `covers` nello schema, e la migrazione `1 → 2`

Un campo nuovo sulla issue: quali revisioni git quella issue **copre**. È il dato su cui il gate
di Task 3 decide, e senza di lui il gate non ha niente da leggere.

Perché è scrivibile senza un passo in più: una issue docs nasce **dopo** il commit di codice che
deve documentare, quindi quello SHA esiste già quando la issue si apre e si scrive all'`--insert`.
Nessun aggiornamento post-commit, cioè nessun secondo passo dimenticabile con la stessa forma del
difetto che questa spec ripara (spec §2.1).

**Files:**
- Modify: `scripts/issue-manager.mjs` — intestazione (`:28-30`, `:44-73`), `SCHEMA_VERSION`
  (`:113`), `MIGRATIONS` (`:135-149`), `validateIssueInput` (`:396`, `:449-451`), `insertIssue`
  (`:1048-1060`), `updateIssue` (`:1096-1110`), `compactTracker` (`:844-862`), `showHelp`
  (`:931-938`, `:958-966`)
- Modify: `test/plugin-issue-manager.test.mjs` — `SCHEMA_VERSION` (`:1460`), le aspettative di
  `--upgrade` (`:1562`, `:1593-1594`, `:1661`), più i test nuovi in fondo
- Modify: `skills/harness/references/issues.md` — `schema_version` (`:19-33`), `--init` (`:85-101`),
  `--upgrade` (`:103-130`), `--compact` (`:205-209`), schema (`:257-305`), tabella dei campi
  (`:369-382`)

**Interfaces:**
- Consumes: niente da task precedenti.
- Produces: il campo `covers` sulla issue — array di stringhe non vuote, senza duplicati, assente
  vale `[]`, `null` **non** ammesso. `SCHEMA_VERSION === 2`. È il campo che Task 2 legge con
  `declaredRefs(issues)` e che Task 3 risolve contro git.

- [ ] **Step 1: Scrivere i test — quelli nuovi, e le tre aspettative che lo schema 2 cambia**

In `test/plugin-issue-manager.test.mjs`, per prima cosa portare la costante allo schema nuovo
(riga 1460):

```javascript
const SCHEMA_VERSION = 2; // mirrors the constant in scripts/issue-manager.mjs
```

Poi le tre aspettative che la migrazione `1 → 2` cambia — **non sono test da riscrivere, sono
numeri che descrivono lo schema nuovo.** Alla riga 1562 e alla riga 1661, `migrated: 2` diventa
`migrated: 3`: il fixture ha tre issue, la `0 → 1` ne tocca due (ID_TWO ha già `depends_on`), e la
`1 → 2` le tocca tutte e tre perché nessuna ha `covers`.

```javascript
    assert.deepEqual(data, { from: 0, to: SCHEMA_VERSION, migrated: 3 });
```

Alle righe 1593-1594, il set di chiavi atteso dopo l'upgrade guadagna `covers`, e il test guadagna
l'asserzione sul valore materializzato:

```javascript
      // covers: materialized to [] by migration 1 -> 2, exactly as depends_on was by 0 -> 1.
      assert.deepEqual(afterIssue.covers, []);

      // No key present before is missing after, and no key absent before was invented besides
      // the two the migrations materialize.
      const beforeKeys = new Set([...Object.keys(beforeIssue), "depends_on", "covers"]);
      assert.deepEqual(new Set(Object.keys(afterIssue)), beforeKeys);
```

Infine, in fondo al file, i test nuovi:

```javascript
// ---------------------------------------------------------------------------
// covers — the git revisions an issue declares it covers. General, not docs-specific: the gate
// only asks that SOMEBODY names a revision.
// ---------------------------------------------------------------------------

test("--insert accepts covers and stores it verbatim", () => {
  const { dir } = setupTempProject();
  try {
    const data = assertOk(
      run(dir, [
        "--insert",
        "--issue-data",
        JSON.stringify({
          title: "Docs for the parser",
          description: "Desc",
          status: "backlog",
          covers: ["a1b2c3d", "v1.2.0"],
        }),
      ])
    );
    assert.deepEqual(data.covers, ["a1b2c3d", "v1.2.0"]);
    assert.deepEqual(assertOk(run(dir, ["--get", "--issue-id", data.id])).covers, [
      "a1b2c3d",
      "v1.2.0",
    ]);
  } finally {
    cleanup(dir);
  }
});

test("covers absent at --insert is stored as [], never as a missing key", () => {
  const { dir } = setupTempProject();
  try {
    const data = assertOk(
      run(dir, [
        "--insert",
        "--issue-data",
        JSON.stringify({ title: "T", description: "D", status: "backlog" }),
      ])
    );
    assert.deepEqual(data.covers, [], "an absent covers must materialize as an empty array");
  } finally {
    cleanup(dir);
  }
});

test("covers rejects null, a non-array, an empty entry and a duplicate", () => {
  const { dir } = setupTempProject();
  const base = { title: "T", description: "D", status: "backlog" };
  try {
    // null is refused for depends_on's reason: "nothing" already has one spelling, [], and a
    // second one would make every reader guess which of the two is stored.
    assertFail(
      run(dir, ["--insert", "--issue-data", JSON.stringify({ ...base, covers: null })]),
      "INVALID_INPUT"
    );
    assertFail(
      run(dir, ["--insert", "--issue-data", JSON.stringify({ ...base, covers: "a1b2c3d" })]),
      "INVALID_INPUT"
    );
    assertFail(
      run(dir, ["--insert", "--issue-data", JSON.stringify({ ...base, covers: ["   "] })]),
      "INVALID_INPUT"
    );
    assertFail(
      run(dir, ["--insert", "--issue-data", JSON.stringify({ ...base, covers: ["a1b2c3d", "a1b2c3d"] })]),
      "INVALID_INPUT"
    );
  } finally {
    cleanup(dir);
  }
});

test("covers validation stays loose: a tag, a branch and a long sha are all accepted", () => {
  // Harness is not a git library. A reference that means nothing simply fails to resolve, and
  // docs-gate reports it; a strict check here would refuse legitimate tags and symbolic refs to
  // defend against a mistake that shows up anyway.
  const { dir } = setupTempProject();
  try {
    const data = assertOk(
      run(dir, [
        "--insert",
        "--issue-data",
        JSON.stringify({
          title: "T",
          description: "D",
          status: "backlog",
          covers: ["v2.0.0", "origin/main", "0123456789abcdef0123456789abcdef01234567"],
        }),
      ])
    );
    assert.equal(data.covers.length, 3);
  } finally {
    cleanup(dir);
  }
});

test("--update merges covers: omitted keeps it, [] clears it, a new array replaces it", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      run(dir, [
        "--insert",
        "--issue-data",
        JSON.stringify({ title: "T", description: "D", status: "backlog", covers: ["a1b2c3d"] }),
      ])
    );

    const untouched = assertOk(
      run(dir, ["--update", "--issue-id", created.id, "--issue-data", JSON.stringify({ status: "in_progress" })])
    );
    assert.deepEqual(untouched.covers, ["a1b2c3d"], "an update that omits covers must keep it");

    const replaced = assertOk(
      run(dir, ["--update", "--issue-id", created.id, "--issue-data", JSON.stringify({ covers: ["ffffff1"] })])
    );
    assert.deepEqual(replaced.covers, ["ffffff1"]);

    const cleared = assertOk(
      run(dir, ["--update", "--issue-id", created.id, "--issue-data", JSON.stringify({ covers: [] })])
    );
    assert.deepEqual(cleared.covers, []);
  } finally {
    cleanup(dir);
  }
});

test("an issue written before covers existed stays readable, and the first --update materializes it", () => {
  // Same promise tier and depends_on already made: a new field never invalidates data written
  // before it existed, and no --upgrade is required to keep working.
  const { dir } = setupTempProject();
  try {
    assert.ok(!("covers" in storedIssues(dir).find((i) => i.id === ID_ONE)));
    const updated = assertOk(
      run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", JSON.stringify({ status: "in_progress" })])
    );
    assert.deepEqual(updated.covers, []);
  } finally {
    cleanup(dir);
  }
});

test("--compact writes covers: [] on the block and preserves it on the archived originals", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      run(dir, [
        "--insert",
        "--issue-data",
        JSON.stringify({
          title: "Closed work",
          description: "D",
          status: "done",
          covers: ["a1b2c3d"],
        }),
      ])
    );

    const data = assertOk(
      run(dir, [
        "--compact",
        "--issue-data",
        JSON.stringify({
          blocks: [{ title: "Block", description: "Summary", issue_ids: [created.id] }],
        }),
      ])
    );

    const block = storedIssues(dir).find((i) => i.id === data.blocks[0].id);
    assert.deepEqual(block.covers, [], "a block covers no revision of its own");

    const archived = JSON.parse(readFileSync(data.archivePath, "utf8")).issues[0];
    assert.deepEqual(
      archived.covers,
      ["a1b2c3d"],
      "the archive stores the originals whole: dropping covers would rewrite history"
    );
  } finally {
    cleanup(dir);
  }
});

test("--help lists covers among the accepted input fields", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /covers/);
  } finally {
    cleanup(dir);
  }
});
```

> `storedIssues(dir)` e `readFileSync` sono già in uso in questo file: non aggiungere import.

- [ ] **Step 2: Lanciare i test e verificare che falliscano**

Run: `node --test test/plugin-issue-manager.test.mjs`
Expected: FAIL. In particolare `--insert accepts covers and stores it verbatim` fallisce con
`INVALID_INPUT` («Unknown field(s) not allowed in issue input: covers»), e i test di `--upgrade`
falliscono sui numeri appena cambiati.

- [ ] **Step 3: Portare `SCHEMA_VERSION` a 2 e aggiungere la migrazione**

In `scripts/issue-manager.mjs`, riga 113:

```javascript
const SCHEMA_VERSION = 2;
```

E in `MIGRATIONS` (riga 135-149), **in fondo alla lista, appesa e mai inserita in mezzo** — la
lista è ordinata e il significato di `to: 1` non può spostarsi sotto un tracker che aggiorna dopo:

```javascript
  {
    to: 2,
    // 1 -> 2: materialize covers: [] where the key is missing. Same shape as 0 -> 1 above: an
    // issue written before the field existed already READS as "covers nothing" everywhere else
    // (see docs-gate.mjs, which treats a missing key as []); this only makes that reading
    // explicit on disk.
    migrateIssue(issue) {
      if (hasProp(issue, "covers")) {
        return issue;
      }
      return { ...issue, covers: [] };
    },
  },
```

- [ ] **Step 4: Validare la forma di `covers`**

Sempre in `scripts/issue-manager.mjs`, subito **dopo** `validateDependsOnShape` (riga 302),
aggiungere:

```javascript
// Helper: validate the shape of covers — the git revisions an issue declares it covers.
//
// Deliberately loose: non-empty strings, no duplicates, and nothing else. Harness is not a git
// library and does not try to recognise a valid sha — a wrong reference simply fails to resolve,
// and docs-gate.mjs reports it as unresolved instead of dropping it. A strict check here would
// refuse legitimate tags and symbolic references to defend against a mistake that shows up
// anyway.
//
// Like depends_on: an array and nothing else, because "covers nothing" already has a spelling
// ([]) and a second one would only make callers guess which is stored. No cap on the number of
// entries either, for the same reason: a cap pushes a caller to drop a real revision to make the
// payload fit.
function validateCoversShape(covers) {
  if (!Array.isArray(covers)) {
    fail("'covers' must be an array of git references. Pass [] to clear it.", "INVALID_INPUT");
  }
  const seen = new Set();
  covers.forEach((entry, index) => {
    if (isNullOrWhitespace(entry)) {
      fail(`'covers[${index}]' must be a non-empty string.`, "INVALID_INPUT");
    }
    if (seen.has(entry)) {
      fail(`'covers' lists '${entry}' more than once.`, "INVALID_INPUT");
    }
    seen.add(entry);
  });
}
```

> **Il codice è `INVALID_INPUT`, non un codice nuovo.** `depends_on` ha il proprio
> (`INVALID_DEPENDENCY`) perché una dipendenza è un fatto del grafo con controlli che vanno oltre
> il payload. `covers` non ha grafo, non ha esistenza da verificare e non ha cicli: è forma, e la
> forma è `INVALID_INPUT`. La tabella dei codici in `issues.md` resta invariata.

- [ ] **Step 5: Accettare `covers` in input**

In `validateIssueInput`, riga 396, aggiungere il campo alla lista degli ammessi:

```javascript
  const allowedFields = ["title", "description", "status", "validation", "tier", "depends_on", "covers"];
```

e subito dopo il blocco di `depends_on` (riga 449-451), aggiungere:

```javascript
  // covers: optional everywhere, absent reads as []. Nothing here needs the stored tracker — a
  // reference is checked against git, not against issues.json — so unlike depends_on the whole
  // validation happens right here.
  if (hasProp(issue, "covers")) {
    validateCoversShape(issue.covers);
  }
```

- [ ] **Step 6: Scrivere il campo in `--insert`, `--update` e nei blocchi di `--compact`**

In `insertIssue` (riga 1048-1060), dentro `storedIssue`, subito dopo `depends_on`:

```javascript
    // Always an array, never absent: docs-gate.mjs reads this field on every issue of the
    // tracker, and a missing key would push that check onto every reader instead of settling it
    // here — the same reason depends_on is materialized above.
    covers: hasProp(newIssue, "covers") ? newIssue.covers : [],
```

In `updateIssue` (riga 1096-1110), dentro `storedIssue`, subito dopo `depends_on`:

```javascript
    // Same merge as depends_on: an issue written before this field has no key at all, so the
    // merge must materialise the empty array rather than carry an undefined into the object.
    covers: hasProp(updatedIssue, "covers")
      ? updatedIssue.covers
      : Array.isArray(existing.covers)
        ? existing.covers
        : [],
```

In `compactTracker` (riga 844-862), dentro `blockIssues`, subito dopo `depends_on: []`:

```javascript
    // A block summarises closed issues; it covers no revision of its own. The revisions the
    // originals declared leave with them, whole, into the archive.
    covers: [],
```

- [ ] **Step 7: Aggiornare intestazione e `--help` dello script**

In cima al file, nel blocco che descrive la struttura di una issue (riga 44-55), aggiungere la
riga dopo `depends_on`:

```javascript
//     "covers": ["<git-ref>"],
```

e, dopo il paragrafo su `depends_on` (riga 63-70), aggiungere:

```javascript
// covers: the git revisions this issue declares it covers. Always stored as an array ([] when
// absent). General, not documentation-specific: any issue may declare a revision, and the docs
// gate only asks that SOMEBODY names it. Validation is deliberately loose — non-empty strings, no
// duplicates — because a reference that means nothing fails to resolve and is reported as such by
// scripts/docs-gate.mjs, which is a mistake you can see rather than one that passes.
```

In `showHelp()`, nella riga di `--upgrade` (riga 931-938), sostituire la parentesi delle
migrazioni:

```javascript
    "                fields with their default (0->1 materializes depends_on: [] where missing,",
    "                1->2 does the same with covers: []); never touches or removes an existing",
    "                value. Idempotent: a file already at SCHEMA_VERSION returns migrated: 0 and",
```

e nella lista dei campi accettati (riga 958-966), dopo la riga di `depends_on`:

```javascript
    "  covers       : array of git references this issue covers; absent reads as [], [] clears it",
    "                 non-empty strings, no duplicates — no further check: harness is not a git",
    "                 library, and a reference that does not resolve is reported by docs-gate.mjs",
```

Infine, nella riga 958, aggiungere `covers` all'elenco dei campi ammessi:

```javascript
    "Allowed input fields for --insert/--update: title, description, status, tier, depends_on, covers, validation",
```

- [ ] **Step 8: Lanciare la suite intera**

Run: `npm run test`
Expected: PASS, tutta.

- [ ] **Step 9: Documentare `covers` in `references/issues.md`**

Sei modifiche, tutte nello stesso file.

**(a)** In `## schema_version` (riga 23), la versione corrente:

```markdown
versione dello schema descritto in questa pagina. Lo script conosce la propria versione tramite
la costante `SCHEMA_VERSION` (oggi `2`).
```

**(b)** In `## --init` (riga 90-94), il seed e la nota:

```markdown
```json
{ "schema_version": 2, "last_updated": "<datetime>", "issues": [] }
```

`schema_version` vale la costante `SCHEMA_VERSION` dello script (oggi `2`).
```

**(c)** In `## --upgrade` (riga 109), la frase sulle migrazioni:

```markdown
`SCHEMA_VERSION`. La migrazione `0 → 1` materializza `depends_on: []` dove la chiave manca; la
`1 → 2` fa lo stesso con `covers: []`.
```

**(d)** In `## --compact`, nel paragrafo sulla issue blocco (riga 205-209), aggiungere `covers`
all'elenco dei campi con cui il blocco nasce:

```markdown
**La issue blocco** viene inserita con `status: "done"`, `validation.state: "pass"`,
`depends_on: []`, `covers: []` e `tier: null`. I suoi `validation.criteria` sono l'evidenza della
```

**(e)** Nello schema (riga 259-271), aggiungere la riga dopo `depends_on`:

```json
  "covers": ["<git-ref>"],
```

e, dopo il blocco che descrive `depends_on` (dopo la riga 304), aggiungere:

> **Attenzione al rimando.** Il testo qui sotto nomina il gate **senza link markdown**, ed è
> deliberato: `references/docs-gate.md` nasce in Task 4, e un link a un file che non esiste
> ancora farebbe fallire il test `cross-links between reference files resolve too`. Task 4 Step 5
> lo trasforma nel link vero. Non anticiparlo.

```markdown
**`covers`** dichiara quali revisioni git quella issue copre. È **generale, non specifico della
documentazione**: qualunque issue può dichiarare di coprire una revisione, e il gate documentale
(`docs-gate.mjs`) chiede soltanto che *qualcuno* la nomini. È sempre un array —
assente vale `[]`, `[]` esplicito ripulisce — e `null` **non** è ammesso, per lo stesso motivo di
`depends_on`: "nessuna revisione" ha già una grafia, e una seconda obbligherebbe a indovinare
quale delle due è memorizzata. Nessun tetto al numero di elementi.

La validazione è **volutamente lasca**: stringhe non vuote, niente duplicati, e nient'altro.
Harness non è una libreria git e non prova a riconoscere uno SHA valido — un riferimento sbagliato
semplicemente non risolve, e il gate lo **riporta come irrisolto** invece di ignorarlo. Una
validazione stretta rifiuterebbe tag e riferimenti simbolici legittimi per difendere da un errore
che si vede comunque.

**Quando si scrive.** All'`--insert`, mai dopo. Una issue non può registrare il **proprio**
commit: quello nasce dopo il `pass` del verificatore, e servirebbe un update post-commit, cioè un
altro passo dimenticabile. Una issue docs invece nasce **dopo** il commit di codice che deve
documentare: quello SHA esiste già nel momento in cui la issue si apre. È questo che rende il
campo praticabile invece che teorico.
```

**(f)** Nella tabella dei campi accettati in input (dopo la riga 377):

```markdown
| `covers` | array | opzionale | opzionale | riferimenti git che la issue copre; assente vale `[]`, `[]` ripulisce; stringhe non vuote, niente duplicati; `null` non è ammesso |
```

- [ ] **Step 10: Rilanciare la suite**

Run: `npm run test`
Expected: PASS, tutta.

Il test da guardare per primo se qualcosa è rosso è `cross-links between reference files resolve
too`: fallisce se il rimando dello Step 9(e) è stato scritto come link markdown invece che come
semplice menzione. `references/docs-gate.md` non esiste ancora — nasce in Task 4, che allo Step 5
chiude il rimando.

- [ ] **Step 11: Portare la issue a `in_review` — nessun commit**

```powershell
$env:HARNESS_ROLE='worker'
node "${env:CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id-covers> --issue-data '{"status":"in_review"}'
```

---

### Task 2: La parte che decide di `docs-gate.mjs`

Il cuore dello script: quali file contano come codice, quali revisioni sono dichiarate, quali
commit restano scoperti, e come si stampa. **Nessun git, nessun filesystem, nessun processo** —
tutto provabile con oggetti in memoria, come `buildSnapshot` di `status-cli.mjs`.

Alla fine di questo task il file **non è ancora lanciabile**: è un modulo di funzioni pure con i
suoi test. Il guscio arriva in Task 3.

**Files:**
- Create: `scripts/docs-gate.mjs`
- Create: `test/plugin-docs-gate.test.mjs`

**Interfaces:**
- Consumes: il campo `covers` di Task 1 — `declaredRefs()` lo legge, e tratta la chiave assente
  come `[]`.
- Produces, tutte esportate e importate dai test:
  - `globToRegExp(glob: string): RegExp`
  - `isCodeFile(file: string, include: string[], exclude: string[]): boolean`
  - `declaredRefs(issues: object[]): string[]`
  - `buildGateReport({ commits, covered, include, exclude }): { scanned, code, uncovered }` dove
    `commits` è `{ sha, subject, files: string[] }[]`, `covered` un `Set<string>` o un array di
    SHA interi, e `code`/`uncovered` sono `{ sha, subject, files, covered }[]`
  - `renderGateReport(report, { project, window, unresolved }): string`
  - `shortSha(sha: string): string`
  - `WIDTH: 80`, `SUBJECT_MAX: 45`

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `test/plugin-docs-gate.test.mjs`:

```javascript
// The decision of the docs gate is a function of data in memory: which files count as code, which
// revisions are declared, which commits are left uncovered. No git, no repository, no process —
// exactly the split status-cli.mjs already uses for buildSnapshot, and for the same reason: the
// part worth getting wrong is provable with objects.

import test from "node:test";
import assert from "node:assert/strict";
import {
  globToRegExp,
  isCodeFile,
  declaredRefs,
  buildGateReport,
  renderGateReport,
  WIDTH,
} from "../scripts/docs-gate.mjs";

const INCLUDE = ["**/*.mjs", "**/*.ts"];
const EXCLUDE = ["docs/**", "test/**", "**/*.md", "issues.json"];

function commit(sha, files, subject = `commit ${sha}`) {
  return { sha, subject, files };
}

test("**/ matches zero directories as well as many", () => {
  // The whole point of the shipped default `**/*.mjs`: a script at the root counts as code too.
  const re = globToRegExp("**/*.mjs");
  assert.ok(re.test("index.mjs"));
  assert.ok(re.test("scripts/docs-gate.mjs"));
  assert.ok(re.test("a/b/c/deep.mjs"));
  assert.ok(!re.test("index.js"));
});

test("a trailing ** matches everything under a directory, and * never crosses a separator", () => {
  assert.ok(globToRegExp("docs/**").test("docs/superpowers/specs/x.md"));
  assert.ok(!globToRegExp("docs/**").test("scripts/x.md"));
  assert.ok(globToRegExp("*.json").test("issues.json"));
  assert.ok(!globToRegExp("*.json").test("nested/issues.json"));
});

test("a glob's literal characters are escaped, not read as a regexp", () => {
  // Without escaping, `issues.json` would also match `issuesXjson` — quietly, and only on the one
  // file the default exclude list exists to protect.
  assert.ok(globToRegExp("issues.json").test("issues.json"));
  assert.ok(!globToRegExp("issues.json").test("issuesXjson"));
});

test("exclude wins over include", () => {
  // The shipped defaults only work this way round: `**/*.mjs` sweeps in every script, and
  // `test/**` has to be able to take the tests back out.
  assert.ok(isCodeFile("scripts/docs-gate.mjs", INCLUDE, EXCLUDE));
  assert.ok(!isCodeFile("test/plugin-docs-gate.test.mjs", INCLUDE, EXCLUDE));
  assert.ok(!isCodeFile("README.md", INCLUDE, EXCLUDE));
  assert.ok(!isCodeFile("issues.json", INCLUDE, EXCLUDE));
});

test("declaredRefs collects covers from issues of EVERY status", () => {
  // Coverage means an issue naming the commit EXISTS, not that it is closed. The gate is a
  // tracked reminder, not a veto: filtering by status here would quietly turn it into one.
  const refs = declaredRefs([
    { id: "a", status: "backlog", covers: ["aaa1111"] },
    { id: "b", status: "blocked", covers: ["bbb2222"] },
    { id: "c", status: "done", covers: ["ccc3333"] },
  ]);
  assert.deepEqual(refs, ["aaa1111", "bbb2222", "ccc3333"]);
});

test("declaredRefs treats a missing covers key as [], and drops duplicates and blanks", () => {
  // A tracker still at schema_version 1 has no covers key at all and must simply read as "no
  // declared revisions" — never as a crash.
  const refs = declaredRefs([
    { id: "a", status: "done" },
    { id: "b", status: "done", covers: null },
    { id: "c", status: "done", covers: ["aaa1111", "  ", "aaa1111"] },
  ]);
  assert.deepEqual(refs, ["aaa1111"]);
});

test("a commit touching no code file is not in the report at all", () => {
  const report = buildGateReport({
    commits: [commit("sha1", ["README.md", "docs/spec.md"])],
    covered: new Set(),
    include: INCLUDE,
    exclude: EXCLUDE,
  });
  assert.equal(report.scanned, 1, "it was still scanned");
  assert.equal(report.code.length, 0, "but it is not a code commit");
  assert.equal(report.uncovered.length, 0);
});

test("a code commit nobody names is uncovered; one an issue names is not", () => {
  const report = buildGateReport({
    commits: [
      commit("sha1", ["scripts/a.mjs", "README.md"]),
      commit("sha2", ["scripts/b.mjs"]),
    ],
    covered: new Set(["sha2"]),
    include: INCLUDE,
    exclude: EXCLUDE,
  });
  assert.equal(report.code.length, 2);
  assert.deepEqual(
    report.uncovered.map((entry) => entry.sha),
    ["sha1"]
  );
  assert.deepEqual(
    report.code.find((entry) => entry.sha === "sha1").files,
    ["scripts/a.mjs"],
    "only the code files of the commit are reported, not every file it touched"
  );
});

test("covered may be passed as a plain array", () => {
  const report = buildGateReport({
    commits: [commit("sha1", ["a.mjs"])],
    covered: ["sha1"],
    include: INCLUDE,
    exclude: EXCLUDE,
  });
  assert.equal(report.uncovered.length, 0);
});

test("the rendered report states the three counts, agreeing in number", () => {
  const report = buildGateReport({
    commits: [commit("aaaaaaaabbbb", ["a.mjs"], "feat: something"), commit("ccccccccdddd", ["b.md"])],
    covered: new Set(),
    include: INCLUDE,
    exclude: EXCLUDE,
  });
  const rendered = renderGateReport(report, { project: "harness", window: "finestra da aaaaaaaa" });
  const lines = rendered.split("\n");

  assert.equal(lines[0], " harness · gate documentale");
  assert.equal(lines[1], " finestra da aaaaaaaa", "the window gets its own line, or the header overflows");
  assert.ok(
    lines.some(
      (line) =>
        line.includes("2 commit nella finestra") &&
        // Singular: "1 toccano" reads as a bug in the count, on the line read first.
        line.includes("1 tocca codice") &&
        line.includes("1 non coperto")
    ),
    `the counts line is missing or does not agree in number:\n${rendered}`
  );
  assert.ok(
    lines.some((line) => line.includes("aaaaaaaa") && line.includes("feat: something")),
    "the uncovered commit must appear with its short sha and its subject"
  );
});

test("no line overflows 80 columns, with the window label the script actually builds", () => {
  // The regression this exists for: rendered with a short synthetic window, everything fits and
  // the check passes; rendered with the real label — 55 columns on its own — the header ran to 93
  // and nothing noticed. Both the project name and the window here are the real shapes.
  const report = buildGateReport({
    commits: [
      commit("aaaaaaaabbbb", ["a.mjs"], "fix: canonicalise the board's project dir before watching it"),
      commit("ccccccccdddd", ["b.mjs"], "feat: alert lines and empty states in the snapshot render"),
    ],
    covered: new Set(),
    include: INCLUDE,
    exclude: EXCLUDE,
  });
  const rendered = renderGateReport(report, {
    project: "activitymanager",
    window: "finestra da 3a612087 · più vecchia revisione dichiarata",
    unresolved: ["deadbeefdeadbeef", "v1.2.0-rc1"],
  });
  for (const line of rendered.split("\n")) {
    assert.ok(line.length <= WIDTH, `line longer than ${WIDTH} columns: ${JSON.stringify(line)}`);
  }
});

test("nothing uncovered is an explicit empty state, not an empty section", () => {
  const report = buildGateReport({
    commits: [commit("sha1", ["a.mjs"])],
    covered: new Set(["sha1"]),
    include: INCLUDE,
    exclude: EXCLUDE,
  });
  const rendered = renderGateReport(report, { project: "harness", window: "finestra da sha1" });
  assert.match(rendered, /nessun commit di codice scoperto/);
});

test("an unresolved reference becomes an alert line above the bar, wrapped and never truncated", () => {
  const report = buildGateReport({ commits: [], covered: new Set(), include: INCLUDE, exclude: EXCLUDE });
  const rendered = renderGateReport(report, {
    project: "harness",
    window: "finestra da aaaaaaaa",
    unresolved: ["deadbee", "notarevision", "another-one-that-is-long", "and-a-fourth-one-here"],
  });
  const lines = rendered.split("\n");

  const bar = lines.findIndex((line) => line.startsWith("═"));
  const alert = lines.findIndex((line) => line.startsWith(" !"));
  assert.ok(alert !== -1 && alert < bar, "the alert must sit above the bar: it is read first");

  for (const ref of ["deadbee", "notarevision", "another-one-that-is-long", "and-a-fourth-one-here"]) {
    assert.ok(rendered.includes(ref), `the unresolved reference ${ref} must survive verbatim`);
  }
  for (const line of lines) {
    assert.ok(line.length <= WIDTH, `line longer than ${WIDTH} columns: ${JSON.stringify(line)}`);
  }
});
```

- [ ] **Step 2: Lanciare i test e verificare che falliscano**

Run: `node --test test/plugin-docs-gate.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/docs-gate.mjs'`.

- [ ] **Step 3: Scrivere il modulo**

Creare `scripts/docs-gate.mjs` con esattamente questo contenuto:

```javascript
#!/usr/bin/env node
// Cumulative check on the documentation gate: which commits touched code without any issue naming
// them in `covers`.
//
// Usage:
//   node docs-gate.mjs [--project-dir <path>] [--since <rev>] [--help]
//
// STDOUT IS TEXT, NOT JSON — the same deliberate break status-cli.mjs makes. This talks to a
// person reading a code block in the session: it has no automated consumers and must not acquire
// any. Nothing is ever written to stderr.
//
// The check is CUMULATIVE, never pointwise, and that is the whole design. A gate that answers
// about HEAD, run by hand after fifteen commits, says the right thing about the wrong commit —
// which is exactly how the manual instruction it replaces failed. Whoever remembers it once at the
// end of the day gets all fifteen commits back, not the last one: forgetting costs a delay, not a
// loss.
//
// Autonomous like every other script in this plugin: it resolves the project, reads
// .harness/config.json and issues.json on its own, and imports nothing from its neighbours. The
// pure functions below are exported so the tests can prove the decision without a fake repository
// and without a process, the way status-cli.mjs exports buildSnapshot.

// Fixed 80 columns, no colour, no ANSI, no isTTY: the surface this exists for is
// `/harness:docs-gate`, where stdout is a pipe to the agent and a colour branch would never run.
export const WIDTH = 80;
export const SUBJECT_MAX = 45;

// The docsGate globs are matched against repository-relative paths with forward slashes, which is
// what `git log --name-only` prints on every platform. The supported subset is the one the shipped
// defaults use: `**/` for zero or more directories, `**` for anything at all, `*` for anything but
// a separator, `?` for one character, and literals. No brace expansion and no character classes —
// a glob syntax nobody can predict is worse than one that is small and written down here.
export function globToRegExp(glob) {
  let source = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*" && glob[i + 2] === "/") {
      // Zero or more, not one or more: `**/*.mjs` must also match a file sitting at the root.
      source += "(?:[^/]*/)*";
      i += 3;
    } else if (ch === "*" && glob[i + 1] === "*") {
      source += ".*";
      i += 2;
    } else if (ch === "*") {
      source += "[^/]*";
      i += 1;
    } else if (ch === "?") {
      source += "[^/]";
      i += 1;
    } else {
      // Escaped, so a literal dot in `issues.json` cannot also match `issuesXjson`.
      source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesAny(file, globs) {
  return globs.some((glob) => globToRegExp(glob).test(file));
}

// Exclude wins over include, which is the only reading that makes the shipped defaults work:
// `**/*.mjs` sweeps in every script and `test/**` has to be able to take the tests back out.
export function isCodeFile(file, include, exclude) {
  if (matchesAny(file, exclude)) {
    return false;
  }
  return matchesAny(file, include);
}

// Every reference every issue declares, WHATEVER its status. Coverage means an issue naming the
// commit exists, not that it is closed: the gate is a tracked reminder and not a veto, and
// filtering by status here would quietly turn it into one.
//
// A missing `covers` key reads as [] — a tracker still at schema_version 1 has none at all, and
// must simply come out as "no declared revisions" rather than as a crash.
export function declaredRefs(issues) {
  const refs = [];
  for (const issue of issues) {
    const declared = Array.isArray(issue?.covers) ? issue.covers : [];
    for (const entry of declared) {
      if (typeof entry !== "string") {
        continue;
      }
      const ref = entry.trim();
      if (ref !== "" && !refs.includes(ref)) {
        refs.push(ref);
      }
    }
  }
  return refs;
}

// The whole decision, as a function of data in memory.
//
// `commits` is the window as git hands it back, newest first: { sha, subject, files }.
// `covered` is the set of RESOLVED full shas the tracker declares — resolution needs git and so it
// happens in the shell below, which is exactly why it arrives here already done.
export function buildGateReport({ commits, covered, include, exclude }) {
  const coveredSet = covered instanceof Set ? covered : new Set(covered);
  const code = [];
  for (const commit of commits) {
    const files = (commit.files ?? []).filter((file) => isCodeFile(file, include, exclude));
    if (files.length === 0) {
      continue;
    }
    code.push({
      sha: commit.sha,
      subject: commit.subject,
      files,
      covered: coveredSet.has(commit.sha),
    });
  }
  return {
    scanned: commits.length,
    code,
    uncovered: code.filter((entry) => !entry.covered),
  };
}

export function shortSha(sha) {
  return String(sha ?? "").slice(0, 8);
}

// A subject is one line or it is not a table. Whitespace is collapsed first, so a newline smuggled
// into a commit message cannot add a row to the output.
function truncate(text, max) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3)}...`;
}

const RULE = ` ${"─".repeat(WIDTH - 1)}`;

// An alert is data, and data must not run off the row. An unresolved reference is wrapped, never
// truncated: it is the one string the reader has to copy back out.
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

function uncoveredRow(entry) {
  return (
    `  ${shortSha(entry.sha).padEnd(8)}  ` +
    `${truncate(entry.subject, SUBJECT_MAX).padEnd(SUBJECT_MAX)}  ${entry.files.length} file`
  );
}

export function renderGateReport(report, { project, window, unresolved = [] }) {
  const alerts = [];
  if (unresolved.length > 0) {
    const verb =
      unresolved.length === 1
        ? "riferimento dichiarato non risolve"
        : "riferimenti dichiarati non risolvono";
    alerts.push(`${unresolved.length} ${verb}: ${unresolved.join(" ")}`);
  }

  // Italian agreement, on the line a person reads first: a plural verb on a single item reads as
  // a bug in the count itself.
  const touching =
    report.code.length === 1 ? "1 tocca codice" : `${report.code.length} toccano codice`;
  const missing =
    report.uncovered.length === 1
      ? "1 non coperto"
      : `${report.uncovered.length} non coperti`;

  return [
    // Two lines, not one. Folded together they run to 93 columns on an ordinary project name —
    // the window label alone is 55 of them — and the whole point of a fixed width is that it
    // holds without anyone checking.
    ` ${project} · gate documentale`,
    ` ${window}`,
    ...alertLines(alerts),
    "═".repeat(WIDTH),
    ` ${report.scanned} commit nella finestra · ${touching} · ${missing}`,
    "",
    " NON COPERTI",
    RULE,
    ...(report.uncovered.length > 0
      ? report.uncovered.map(uncoveredRow)
      : ["  nessun commit di codice scoperto"]),
    RULE,
    " coperto = una issue lo dichiara in covers, in qualunque stato",
  ].join("\n");
}
```

- [ ] **Step 4: Lanciare i test del file e verificare che passino**

Run: `node --test test/plugin-docs-gate.test.mjs`
Expected: PASS, tutti.

- [ ] **Step 5: Lanciare la suite intera**

Run: `npm run test`
Expected: PASS. Il test `every CLI script the plugin ships is named where an agent will read it`
**non esiste ancora** — nasce in Task 6, dopo che Task 4 avrà dato allo script una reference che lo
nomina. Non anticiparlo qui: fallirebbe.

- [ ] **Step 6: Portare la issue a `in_review` — nessun commit**

```powershell
$env:HARNESS_ROLE='worker'
node "${env:CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id-gate-core> --issue-data '{"status":"in_review"}'
```

---

### Task 3: Il guscio di `docs-gate.mjs` — config, git, finestra, codici d'uscita

Quello che Task 2 non poteva provare senza un repository: da dove parte la finestra, come si
risolvono i riferimenti, cosa succede quando non c'è niente da cui partire.

**Files:**
- Modify: `scripts/docs-gate.mjs` — import in cima, e tutto il guscio in fondo
- Modify: `test/plugin-docs-gate.test.mjs` — un blocco end-to-end in fondo

**Interfaces:**
- Consumes: da Task 2 `declaredRefs`, `buildGateReport`, `renderGateReport`, `shortSha`.
- Produces: lo script lanciabile. `main()` non gira quando il modulo è importato — stessa guardia
  di `status-cli.mjs`. Esporta in più `parseLog(stdout: string): {sha, subject, files}[]`.

- [ ] **Step 1: Scrivere i test che falliscono**

In fondo a `test/plugin-docs-gate.test.mjs`, aggiungere gli import mancanti in cima al file:

```javascript
import { parseLog } from "../scripts/docs-gate.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
```

> `parseLog` va aggiunto alla lista di import già presente da Task 2, non importato una seconda
> volta.

E in fondo al file:

```javascript
// ---------------------------------------------------------------------------
// The shell: everything that needs a real repository. One temporary git repo per test, built with
// a fixed clock — the window autocalibrates on committer date, and two commits made inside the
// same second would make "the oldest" a coin toss.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "docs-gate.mjs");

function sh(cmd, args, cwd, env = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(
    result.status,
    0,
    `${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`
  );
  return result;
}

let minute = 0;

function gitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-gate-"));
  sh("git", ["init", "-q", "-b", "main"], dir);
  sh("git", ["config", "user.email", "test@example.com"], dir);
  sh("git", ["config", "user.name", "Test"], dir);
  return dir;
}

function makeCommit(dir, files, subject) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  sh("git", ["add", "-A"], dir);
  minute += 1;
  const when = `2026-01-01T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
    minute % 60
  ).padStart(2, "0")}:00Z`;
  sh("git", ["commit", "-q", "-m", subject], dir, {
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_DATE: when,
  });
  return sh("git", ["rev-parse", "HEAD"], dir).stdout.trim();
}

// Written AFTER the commits on purpose: the tracker and the config are the gate's input, not part
// of the history it reads.
function writeHarness(dir, { issues = [], docsGate } = {}) {
  mkdirSync(path.join(dir, ".harness"), { recursive: true });
  writeFileSync(
    path.join(dir, ".harness", "config.json"),
    JSON.stringify({ verify: "npm test", ...(docsGate === undefined ? {} : { docsGate }) }, null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(dir, "issues.json"),
    JSON.stringify({ schema_version: 2, last_updated: "2026-01-01T00:00:00Z", issues }, null, 2),
    "utf8"
  );
}

function issue(covers, status = "backlog") {
  return { id: "11111111-1111-1111-1111-111111111111", status, covers };
}

function runGate(dir, args = []) {
  return spawnSync(process.execPath, [SCRIPT, "--project-dir", dir, ...args], {
    encoding: "utf8",
  });
}

test("parseLog splits records without any quoting", () => {
  const stdout = "\u001fsha1\u001ffeat: one\n\nscripts/a.mjs\nREADME.md\n\u001fsha2\u001ffix: two\n\ndocs/b.md\n";
  assert.deepEqual(parseLog(stdout), [
    { sha: "sha1", subject: "feat: one", files: ["scripts/a.mjs", "README.md"] },
    { sha: "sha2", subject: "fix: two", files: ["docs/b.md"] },
  ]);
});

test("the window starts at the oldest declared revision, and the report is exit 0", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    makeCommit(dir, { "b.mjs": "2" }, "feat: second");
    makeCommit(dir, { "README.md": "3" }, "docs: third");
    writeHarness(dir, { issues: [issue([first])] });

    const result = runGate(dir);
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.stderr, "", "nothing is ever written to stderr");
    assert.match(result.stdout, new RegExp(`finestra da ${first.slice(0, 8)}`));
    // Two commits after the start: the .mjs one is code and uncovered, the .md one is not code.
    assert.match(result.stdout, /2 commit nella finestra/);
    assert.match(result.stdout, /1 tocca codice/);
    assert.match(result.stdout, /1 non coperto/);
    assert.match(result.stdout, /feat: second/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finding uncovered commits is still exit 0: a finding is not a failure", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    makeCommit(dir, { "b.mjs": "2" }, "feat: uncovered");
    writeHarness(dir, { issues: [issue([first])] });

    // A different exit code for "I found uncovered commits" would be handy in CI and would break
    // the contract every other script of this plugin keeps, where 1 means the request was not
    // carried out. Whoever wants a CI gate reads the output.
    assert.equal(runGate(dir).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a short sha in covers resolves to the same revision as the long one", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    const second = makeCommit(dir, { "b.mjs": "2" }, "feat: second");
    writeHarness(dir, { issues: [issue([first]), issue([second.slice(0, 7)])] });

    const result = runGate(dir);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /0 non coperti/);
    assert.match(result.stdout, /nessun commit di codice scoperto/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a covers entry that does not resolve is reported, not silently dropped", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    makeCommit(dir, { "b.mjs": "2" }, "feat: second");
    writeHarness(dir, { issues: [issue([first, "deadbeefdeadbeef"])] });

    const result = runGate(dir);
    assert.equal(result.status, 0, "an unresolved reference is a finding, not an error");
    assert.match(result.stdout, /deadbeefdeadbeef/);
    assert.match(result.stdout, /non risolve/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("coverage counts an issue in backlog: the gate is a reminder, not a veto", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    const second = makeCommit(dir, { "b.mjs": "2" }, "feat: second");
    writeHarness(dir, { issues: [issue([first]), issue([second], "backlog")] });

    assert.match(runGate(dir).stdout, /0 non coperti/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no declared revision and no --since: it stops and asks, exit 1", () => {
  const dir = gitRepo();
  try {
    makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    writeHarness(dir, { issues: [] });

    const result = runGate(dir);
    // A guessed starting point here does not produce an error: it produces a plausible, useless
    // list, which is worse.
    assert.equal(result.status, 1);
    assert.match(result.stdout, /--since/);
    assert.equal(result.stderr, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--since gives an explicit window even with an empty tracker", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    makeCommit(dir, { "b.mjs": "2" }, "feat: second");
    writeHarness(dir, { issues: [] });

    const result = runGate(dir, ["--since", first]);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /--since/);
    assert.match(result.stdout, /1 non coperto/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a --since that does not resolve is exit 1", () => {
  const dir = gitRepo();
  try {
    makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    writeHarness(dir, { issues: [] });

    const result = runGate(dir, ["--since", "not-a-revision"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /not-a-revision/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docsGate.enabled false is declared and the script stops, exit 0", () => {
  const dir = gitRepo();
  try {
    makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    writeHarness(dir, { issues: [], docsGate: { enabled: false } });

    const result = runGate(dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /disabilitato/);
    assert.doesNotMatch(result.stdout, /NON COPERTI/, "a disabled gate reports nothing else");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a partial docsGate is completed with the defaults, not left half empty", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    makeCommit(dir, { "b.mjs": "2" }, "feat: second");
    // Only `exclude` is given: `include` must still come from the defaults, or the gate would
    // report itself as active while matching no file at all.
    writeHarness(dir, { issues: [issue([first])], docsGate: { exclude: ["docs/**"] } });

    assert.match(runGate(dir).stdout, /1 non coperto/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing .harness/config.json is exit 1: the globs are the project's decision", () => {
  const dir = gitRepo();
  try {
    makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    const result = runGate(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /config\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a directory that is not a git repository is exit 1", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-nogit-"));
  try {
    writeHarness(dir, { issues: [] });
    const result = runGate(dir);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "", "git's own noise must never reach stderr through this script");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown flag stops instead of answering a different question", () => {
  const dir = gitRepo();
  try {
    writeHarness(dir, { issues: [] });
    const result = runGate(dir, ["--all"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /--project-dir/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--help exits 0 and needs no project at all", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--since/);
  assert.equal(result.stderr, "");
});
```

- [ ] **Step 2: Lanciare i test e verificare che falliscano**

Run: `node --test test/plugin-docs-gate.test.mjs`
Expected: FAIL — `parseLog` non è esportato e lo script non ha nessun `main()`.

- [ ] **Step 3: Aggiungere gli import in cima al modulo**

In `scripts/docs-gate.mjs`, subito **dopo** il blocco di commento iniziale e **prima** di
`export const WIDTH`:

```javascript
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
```

- [ ] **Step 4: Scrivere il guscio**

In fondo a `scripts/docs-gate.mjs`, dopo `renderGateReport`:

```javascript
// A copy of harness-config.mjs's DEFAULT_DOCS_GATE, not an import: this script is autonomous by
// design, and one script reaching into another's constant is the coupling that autonomy exists to
// avoid. It only ever applies to the fields a hand-written config.json omits — `--init` always
// writes all three, so on a project configured through the plugin this is dead weight that costs
// nothing and covers the case where it is not.
const DEFAULT_DOCS_GATE = {
  enabled: true,
  include: [
    "**/*.mjs",
    "**/*.js",
    "**/*.cjs",
    "**/*.ts",
    "**/*.tsx",
    "**/*.jsx",
    "**/*.py",
    "**/*.go",
    "**/*.cs",
    "**/*.java",
    "**/*.rb",
    "**/*.rs",
    "**/*.php",
  ],
  exclude: ["docs/**", "test/**", "tests/**", "**/*.md", "issues.json"],
};

// Unit separator: it cannot occur in a commit subject or in a path, so it separates the fields of
// a log record without any quoting to undo.
//
// Written as an escape, never as the literal byte: an invisible control character in a source
// file survives no diff review and no copy-paste through a terminal.
const SEP = "\u001f";

const USAGE = [
  "Usage:",
  "  node docs-gate.mjs [--project-dir <path>] [--since <rev>] [--help]",
  "",
  "Prints which commits touched code without any issue naming them in 'covers'. Cumulative, not",
  "pointwise: it answers over a window of history, not about HEAD.",
  "Output is text, not JSON, and nothing is ever written to stderr.",
  "",
  "--project-dir  directory holding issues.json and .harness/config.json (default: the current one)",
  "--since <rev>  start the window at this revision instead of the oldest declared one",
  "",
  "The window starts at the oldest revision any issue declares in 'covers'. When no issue declares",
  "anything, the script stops and asks for an explicit --since instead of guessing a starting",
  "point: a wrong default here does not produce an error, it produces a plausible useless list.",
  "",
  "Exit codes: 0 on a printed report, including one that found uncovered commits, and on a gate",
  "disabled in config.json; 1 when the request could not be carried out at all — missing project,",
  "missing or unreadable .harness/config.json, unreadable issues.json, no window and no --since,",
  "a --since that does not resolve, no git repository, an unknown flag.",
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

// Every git call goes through here, so "git is not installed" is reported once, as a sentence,
// instead of surfacing as an unhandled spawn error.
function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) {
    fail(`git non è disponibile: ${result.error.message}`);
  }
  return result;
}

// The gate reads which files count as code from .harness/config.json. A missing config is not a
// case to guess through: which globs are code is the project's decision, and inventing it silently
// is the thing references/config.md forbids.
function readDocsGate(projectDir) {
  const configPath = path.join(projectDir, ".harness", "config.json");
  if (!existsSync(configPath)) {
    fail(
      `Nessuna configurazione harness in '${projectDir}': manca '.harness/config.json'. ` +
        "Il gate legge da lì quali file contano come codice, e indovinarlo non è una cosa che harness fa."
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    fail(`'${configPath}' non è un JSON valido: la configurazione non è leggibile.`);
  }
  // Field by field, exactly as harness-config.mjs merges on --init: a partial docsGate must never
  // end up active with an empty include, which would report itself as a working gate matching
  // nothing.
  return { ...DEFAULT_DOCS_GATE, ...(parsed.docsGate ?? {}) };
}

function readIssues(projectDir) {
  const trackerPath = path.join(projectDir, "issues.json");
  if (!existsSync(trackerPath)) {
    // Same reading as everywhere else in harness: a project without issues.json is an empty
    // tracker, not an error. It declares no revision, so the window question comes up next.
    return [];
  }
  let data;
  try {
    data = JSON.parse(readFileSync(trackerPath, "utf8"));
  } catch {
    fail(`'${trackerPath}' non è un JSON valido: il tracker non è leggibile.`);
  }
  return Array.isArray(data.issues) ? data.issues : [];
}

// Every declared reference goes through rev-parse, so a short sha and a long one are the same
// revision and a tag is the commit it points at. A reference that does not resolve is REPORTED,
// never silently dropped: that is the difference between a wrong datum you can see and one that
// passes.
function resolveRefs(refs, cwd) {
  const resolved = new Map();
  const unresolved = [];
  for (const ref of refs) {
    const result = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
    const sha = result.stdout.trim();
    if (result.status !== 0 || sha === "") {
      unresolved.push(ref);
      continue;
    }
    resolved.set(ref, sha);
  }
  return { resolved, unresolved };
}

// Oldest by committer date, in one process: --no-walk asks git about exactly these revisions
// instead of walking all the history behind them.
function oldestCommit(shas, cwd) {
  if (shas.length === 0) {
    // Guarded, not left to git: `git log --no-walk` with no revision quietly falls back to HEAD,
    // which would turn "nothing is declared" into a window of exactly one commit.
    return null;
  }
  const result = git(["log", "--no-walk", `--format=%H${SEP}%ct`, ...shas], cwd);
  if (result.status !== 0) {
    fail(`git log --no-walk è fallito: ${result.stdout.trim() || "nessun output"}`);
  }
  let oldest = null;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    const [sha, stamp] = line.split(SEP);
    const when = Number.parseInt(stamp, 10);
    if (oldest === null || when < oldest.when) {
      oldest = { sha, when };
    }
  }
  return oldest === null ? null : oldest.sha;
}

// Exported for the tests: the parsing is where a format string and a stream of file names can
// quietly disagree, and it deserves a check that costs no repository.
export function parseLog(stdout) {
  const commits = [];
  let current = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(SEP)) {
      const [, sha, subject] = line.split(SEP);
      current = { sha, subject: subject ?? "", files: [] };
      commits.push(current);
      continue;
    }
    if (current === null || line.trim() === "") {
      continue;
    }
    current.files.push(line.trim());
  }
  return commits;
}

// The window is what came AFTER the starting revision: that commit is covered by definition — it
// is the one an issue names — so `start..HEAD` loses nothing and avoids the `^` that has no
// meaning on a root commit.
//
// Merges are skipped: --name-only prints nothing for them anyway, so counting them would only
// inflate the scanned figure with rows that can never be code.
function readWindow(startSha, cwd) {
  const result = git(
    [
      // Paths stay literal UTF-8 instead of being octal-escaped by git's default quoting, or a
      // non-ASCII filename would never match a glob.
      "-c",
      "core.quotePath=false",
      "log",
      "--no-merges",
      "--name-only",
      `--format=${SEP}%H${SEP}%s`,
      `${startSha}..HEAD`,
    ],
    cwd
  );
  if (result.status !== 0) {
    fail(`git log è fallito: ${result.stdout.trim() || "nessun output"}`);
  }
  return parseLog(result.stdout);
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      options: {
        "project-dir": { type: "string" },
        since: { type: "string" },
        help: { type: "boolean", default: false },
      },
    }));
  } catch (error) {
    // strict on purpose, like status-cli.mjs: an invented flag must stop here. A report that looks
    // right but answers a different question is worse than no report.
    fail(
      `${error.message.replace(/\.?$/, ".")} docs-gate.mjs accetta solo --project-dir, --since e --help.`
    );
  }

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const projectDir = resolveProjectDir(values["project-dir"]);
  const project = path.basename(projectDir);

  const docsGate = readDocsGate(projectDir);
  if (docsGate.enabled === false) {
    process.stdout.write(
      ` ${project} · gate documentale disabilitato in .harness/config.json\n`
    );
    return;
  }

  if (git(["rev-parse", "--is-inside-work-tree"], projectDir).status !== 0) {
    fail(
      `'${projectDir}' non è un repository git: il gate legge la storia dei commit, e senza git non ha niente da leggere.`
    );
  }

  const { resolved, unresolved } = resolveRefs(declaredRefs(readIssues(projectDir)), projectDir);

  let startSha;
  let window;
  if (values.since) {
    const start = git(["rev-parse", "--verify", "--quiet", `${values.since}^{commit}`], projectDir);
    startSha = start.stdout.trim();
    if (start.status !== 0 || startSha === "") {
      fail(`--since '${values.since}' non è una revisione di questo repository.`);
    }
    window = `finestra da ${shortSha(startSha)} · --since`;
  } else {
    startSha = oldestCommit([...new Set(resolved.values())], projectDir);
    if (startSha === null) {
      // Harness only knows the period in which it was used: a window of "all the history" on a
      // repository that predates it by years produces thousands of rows.
      fail(
        "Nessuna issue dichiara una revisione in 'covers': non c'è un punto di partenza da cui " +
          "calcolare la finestra. Rilancia con --since <rev> esplicito — un default indovinato qui " +
          "non produce un errore, produce un elenco plausibile e inutile, che è peggio."
      );
    }
    window = `finestra da ${shortSha(startSha)} · più vecchia revisione dichiarata`;
  }

  const report = buildGateReport({
    commits: readWindow(startSha, projectDir),
    covered: new Set(resolved.values()),
    include: docsGate.include,
    exclude: docsGate.exclude,
  });

  process.stdout.write(`${renderGateReport(report, { project, window, unresolved })}\n`);
}

// The pure functions above are imported by the tests; main() must not run then.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
```

- [ ] **Step 5: Lanciare la suite intera**

Run: `npm run test`
Expected: PASS, tutta.

- [ ] **Step 6: Portare la issue a `in_review` — nessun commit**

```powershell
$env:HARNESS_ROLE='worker'
node "${env:CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id-gate-shell> --issue-data '{"status":"in_review"}'
```

---

### Task 4: `references/docs-gate.md` e il comando che ci rimanda

Il contratto sta nella reference, non nel comando: è la stessa divisione che `references/status.md`
ha già con `/harness:status`, ed è l'unica che raggiunge anche i lettori che non sono l'utente —
un subagent non ha `/harness:docs-gate` fra le cose che può invocare, legge `SKILL.md` e da lì
segue i link.

**Files:**
- Create: `skills/harness/references/docs-gate.md`
- Create: `commands/docs-gate.md`
- Modify: `test/plugin-commands.test.mjs:16` (`COMMANDS`)
- Modify: `README.md` (tabella dei comandi)
- Modify: `skills/harness/references/issues.md` (chiude il rimando lasciato aperto in Task 1)

**Interfaces:**
- Consumes: lo script lanciabile di Task 3, coi suoi codici d'uscita.
- Produces: `references/docs-gate.md`, che Task 6 linkerà da `SKILL.md` — è il link che rende la
  reference non orfana per il test esistente.

- [ ] **Step 1: Aggiungere il comando alla lista e vedere fallire**

In `test/plugin-commands.test.mjs`, riga 16:

```javascript
const COMMANDS = ["board", "compact", "docs-gate", "issue", "status", "verify"];
```

Run: `node --test test/plugin-commands.test.mjs`
Expected: FAIL su `the plugin ships exactly the documented commands` e su `commands/docs-gate.md
must exist`.

- [ ] **Step 2: Scrivere la reference**

Creare `skills/harness/references/docs-gate.md`:

```markdown
# Gate documentale

Dopo un commit che tocca codice va aperta una issue docs. Lo prescrive
[SKILL.md](../SKILL.md) — e in `SKILL.md` è un'istruzione che qualcuno deve **ricordarsi** di
eseguire. Sul primo progetto che ha usato harness per un lavoro lungo ha retto una volta su tre, e
il risultato misurabile è un `ARCHITECTURE.md` che descriveva un framework di due versioni prima e
una pipeline di test che non esiste.

`docs-gate.mjs` non impedisce di dimenticarsene. Rende il dimenticarsene **recuperabile**:

> quali commit hanno toccato codice senza che nessuna issue li nomini.

`$SCRIPTS` = `${CLAUDE_PLUGIN_ROOT}/scripts`.

```bash
node "$SCRIPTS/docs-gate.mjs" [--project-dir <path>] [--since <rev>] [--help]
```

**Non scrive niente. Nessun flag lo fa scrivere.** Le issue che mancano le apre chi legge
l'output, con `--insert`, dichiarando in `covers` la revisione coperta ([issues.md](issues.md)).

Non c'è nessuna configurazione nuova: `docsGate.include` / `docsGate.exclude` in
`.harness/config.json` esistono già e servono già esattamente a questo ([config.md](config.md)).
Con `docsGate.enabled: false` lo script lo dichiara in una riga e si ferma.

## Cumulativo, mai puntuale

È il vincolo da cui nasce tutto il resto. Un controllo su `HEAD`, lanciato a mano dopo quindici
commit, direbbe la cosa giusta **sul commit sbagliato**.

I numeri che lo impongono vengono dal progetto in cui il gate è saltato: tredici sessioni, 82
commit, 41 riepiloghi del tracker. Il riepilogo gira ai **confini** — clock-in, clock-out, fine di
un blocco — e *dentro* le sessioni lunghe collassa: in una finestra ci sono undici commit
consecutivi senza un solo `status`, in un'altra quindici. E quella finestra di undici commit è
esattamente il tratto di lavoro la cui issue docs non è mai nata.

La conclusione non è «serve un rito migliore»: è che **nessun rito è affidabile durante il
lavoro**. Quindi il controllo risponde su una finestra di storia, non sull'ultimo commit — e chi
se ne ricorda una volta a fine giornata recupera tutti e quindici i commit, non l'ultimo.

**Cosa questo compra, e cosa no.** Un comando dedicato **non** difende dal dimenticarsene: è la
stessa forma dell'istruzione che è già fallita. Quello che lo rende comunque utile è la
cumulatività: il costo del dimenticarsene diventa un **ritardo, non una perdita**, ed è questo —
non la puntualità — il difetto che si stava riparando.

## La finestra, e come si autocalibra

La finestra parte dal **più vecchio commit nominato da una issue** in `covers`, e arriva a `HEAD`.
Quel commit è coperto per definizione — è quello che una issue nomina — quindi la finestra è ciò
che gli è venuto dopo.

Perché non «tutta la storia»: harness conosce solo il periodo in cui è stato usato, e su un
repository che lo precede di anni una finestra totale produrrebbe migliaia di righe.

**Al primo uso, quando nessuna issue nomina niente, lo script si ferma e chiede `--since <rev>`
esplicito.** Non indovina un punto di partenza: un default sbagliato qui non produce un errore,
produce un elenco plausibile e inutile, che è peggio. Vale anche per un tracker ancora a
`schema_version: 1`, dove il campo `covers` non c'è: zero revisioni dichiarate, quindi `--since`,
che è il comportamento corretto.

I **merge** non entrano nella finestra: `--name-only` non stampa file per un merge, e contarli
gonfierebbe il conteggio con righe che non possono mai essere codice.

## I riferimenti si risolvono, non si confrontano come stringhe

Ogni riferimento dichiarato passa per `git rev-parse`, così **uno SHA corto e uno lungo sono la
stessa revisione** e un tag è il commit che punta.

Un riferimento che **non risolve** viene riportato in un'allerta, non silenziosamente ignorato: è
la differenza fra un dato sbagliato che si vede e uno che passa. Non è un errore e non cambia il
codice d'uscita — è un dato del report come gli altri.

## Copertura significa «esiste», non «chiusa»

Una issue in `backlog` che nomina quel commit **basta** a considerarlo coperto. Il gate è un
promemoria tracciato, non un veto — è scritto così in [SKILL.md](../SKILL.md), e stringere qui lo
trasformerebbe in un blocco.

## Il canale è stdout, e il formato è testo

**Stdout porta tutto, anche gli errori. Su stderr non finisce mai niente**, nemmeno il rumore di
git. **L'output è testo, mai JSON**: come `status-cli.mjs` ([status.md](status.md)), questo
comando parla a un umano che legge un blocco di codice, non ha consumatori automatici e non deve
acquisirne.

## Come si legge l'output

```
 harness · gate documentale
 finestra da a1b2c3d4 · più vecchia revisione dichiarata
 ! 1 riferimento dichiarato non risolve: deadbeef
════════════════════════════════════════════════════════════════════════════════
 12 commit nella finestra · 7 toccano codice · 3 non coperti

 NON COPERTI
 ───────────────────────────────────────────────────────────────────────────────
  4f2a1b8c  feat: alert lines and empty states             3 file
  9c31e07d  feat: header, proportional bar and legend      5 file
  a47813e7  fix: canonicalise the board's project dir      2 file
 ───────────────────────────────────────────────────────────────────────────────
 coperto = una issue lo dichiara in covers, in qualunque stato
```

Larghezza fissa **80 colonne**, niente colore e niente ANSI: l'output finisce in un blocco
markdown reso dalla sessione, e le distinzioni le portano allineamento e icone.

- **intestazione, due righe** — progetto sulla prima, finestra sulla seconda col motivo per cui
  parte da lì: `--since` oppure `più vecchia revisione dichiarata`. Sono due righe e non una
  perché insieme sfondano le 80 colonne su un nome di progetto qualsiasi.
- **allerte** — righe con `!`, **sopra la barra** perché sono la prima cosa da leggere. Vanno a
  capo, non si troncano: il riferimento irrisolto è la stringa che va copiata fuori.
- **conteggi** — `<n> commit nella finestra` è tutto ciò che è stato guardato; `<n> toccano
  codice` è il sottoinsieme che `docsGate` seleziona; `<n> non coperti` è il lavoro da fare.
  Al singolare la riga concorda — `1 tocca codice · 1 non coperto` — perché un verbo plurale su
  un elemento solo si legge come un errore nel conteggio.
- **NON COPERTI** — sha corto a 8 caratteri, soggetto troncato a 45, e quanti **file di codice**
  quel commit ha toccato (non quanti file in tutto). Solo gli scoperti: elencare anche i coperti
  produrrebbe una lista che nessuno legge.
- **stato vuoto** — `nessun commit di codice scoperto` è il risultato buono, e si scrive perché
  una sezione vuota si legge come un output rotto.

## Codici d'uscita

| caso | uscita |
|---|---|
| report stampato, **anche con commit scoperti** | 0 |
| `--help` | 0 |
| `docsGate.enabled: false` | 0, una riga |
| nessuna revisione dichiarata e nessun `--since` | 1, una riga che chiede `--since` |
| `--since` che non risolve | 1, una riga |
| `--project-dir` inesistente | 1, una riga |
| `.harness/config.json` mancante o illeggibile | 1, una riga |
| `issues.json` illeggibile | 1, una riga |
| la directory non è un repository git, o git non c'è | 1, una riga |
| flag sconosciuto | 1, una riga |

**Trovare commit scoperti non è un fallimento, ed esce 0.** Un codice d'uscita diverso sarebbe
comodo in CI e romperebbe il contratto che ogni altro script del plugin rispetta, dove `1`
significa *la richiesta non è stata eseguita*. Chi vuole un gate di CI legge l'output.

Un `.harness/config.json` mancante esce 1 invece di ripiegare su un default: quali file contano
come codice è una decisione del progetto, e indovinarla in silenzio è la cosa che
[config.md](config.md) vieta. Un `docsGate` **parziale** dentro un config che esiste viene invece
completato campo per campo con i default, come fa già `harness-config.mjs` alla scrittura.

## Le due superfici

**Dentro la sessione** — `/harness:docs-gate`. L'agente lancia lo script e ne ristampa l'output
verbatim in un blocco di codice.

**Da un terminale esterno** — `node <path-plugin>/scripts/docs-gate.mjs`, stesso identico testo.
```

- [ ] **Step 3: Scrivere il comando**

Creare `commands/docs-gate.md`:

```markdown
---
description: Elenca i commit che hanno toccato codice senza che nessuna issue li dichiari in covers. Senza argomenti usa la finestra autocalibrata sul progetto corrente.
argument-hint: "[--since <rev>] [--project-dir <path>]"
allowed-tools: Bash
---

Controllo cumulativo del gate documentale sul progetto corrente. Il contratto completo — come si
autocalibra la finestra, cosa conta come coperto, come si leggono le righe, canali e codici
d'uscita — è in `${CLAUDE_PLUGIN_ROOT}/skills/harness/references/docs-gate.md`: leggilo quando
l'output non ti torna, non prima.

Argomenti: `$ARGUMENTS` (nessun argomento = finestra autocalibrata sul progetto corrente).

## Cosa fare

1. Lancia lo script:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-gate.mjs" [--since <rev>] [--project-dir <path>]
   ```

   Non ci sono altri flag e non ci sono sottocomandi.

2. **Ristampa l'output verbatim, dentro un blocco di codice.** Non riformattarlo, non convertirlo
   in tabella markdown, non accorciare i soggetti già troncati: l'allineamento è già fatto a 80
   colonne.

3. Se ci sono commit scoperti, **proponi le issue docs da aprire**, una per commit o una per
   gruppo coerente, e aspetta conferma. Ogni issue proposta dichiara in `covers` lo SHA che copre
   — è quello che la rende coperta al giro dopo. Si aprono con `/harness:issue` o direttamente con
   `--insert` (`skills/harness/references/issues.md`).

   Non aprirle da solo senza mostrarle: il gate è un promemoria, e cosa merita una issue lo decide
   la bussola in `SKILL.md`.

## Uscita diversa da zero

**Trovare commit scoperti esce 0**: è il risultato, non un errore. Lo script esce 1 solo quando
non ha potuto rispondere — fra i casi, il più frequente al primo uso:

- *nessuna issue dichiara una revisione in `covers`* → non c'è una finestra da cui partire.
  Rilancia con `--since <rev>` esplicito, scegliendo il punto da cui ha senso guardare (per
  esempio il primo commit da quando il progetto usa harness). Non inventare un default.
- `--since` che non risolve, `.harness/config.json` mancante, directory non git, flag sconosciuto
  → riporta la riga così com'è e fermati.

**Tutto esce su stdout, errori compresi: su stderr non finisce mai niente**, e l'output è testo,
mai JSON.
```

- [ ] **Step 4: Documentare il comando nel README**

In `README.md`, nella tabella dei comandi, inserire in ordine alfabetico dopo la riga di
`/harness:compact`:

```markdown
| `/harness:docs-gate` | Lists the commits that touched code without any issue declaring them in `covers` | Uses the window autocalibrated on the current project |
```

- [ ] **Step 5: Chiudere il rimando lasciato aperto in Task 1**

In `skills/harness/references/issues.md`, nel blocco su `covers` scritto in Task 1 Step 9(e),
sostituire il rimando testuale col link vero, adesso che il file esiste:

```markdown
documentazione**: qualunque issue può dichiarare di coprire una revisione, e il gate documentale
([docs-gate.md](docs-gate.md)) chiede soltanto che *qualcuno* la nomini. È sempre un array —
```

- [ ] **Step 6: Lanciare la suite intera**

Run: `npm run test`
Expected: PASS. In particolare devono passare, sul comando nuovo: `every command carries a
description and an argument hint`, `every command says what it does without arguments` (la
description contiene «Senza argomenti», il corpo contiene «nessun argomento»), `commands invoke the
plugin's scripts through the plugin root`, `every plugin path a command names resolves to a real
file`, `commands point at the skill instead of restating it` (linka
`skills/harness/references/docs-gate.md`, corpo sotto i 4000 caratteri), e `the README documents
the commands under the names the plugin ships`.

`every reference file is reachable from SKILL.md` **fallirebbe** su `docs-gate.md`, perché il link
da `SKILL.md` arriva in Task 6. Aggiungerlo qui anticiperebbe Task 6 su un file che quel task
riscrive: invece, in questo Step, aggiungere in `SKILL.md` la **sola voce di indice**, che è
esattamente ciò che il test chiede e che Task 6 non tocca:

```markdown
- [references/docs-gate.md](references/docs-gate.md) — gate documentale: finestra, copertura,
  come si legge l'output.
```

va inserita nel capitolo `## Reference`, dopo la voce di `references/config.md`.

- [ ] **Step 7: Portare la issue a `in_review` — nessun commit**

```powershell
$env:HARNESS_ROLE='worker'
node "${env:CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id-docs-gate-ref> --issue-data '{"status":"in_review"}'
```

---

### Task 5: `references/sweep.md` e il comando che ci rimanda

Il setaccio dei documenti: raccoglie le occasioni scritte da qualche parte e mai diventate issue,
le verifica, propone, chiede conferma, e solo dopo scrive. **Nessuno script**: è tutto giudizio, e
usa `--get-all` e `--insert` che esistono già.

Il procedimento vive nella reference, non nel comando, e non è un gusto editoriale: una prima
stesura della spec lo metteva dentro `commands/sweep.md`, e avrebbe fatto fallire il test
`commands point at the skill instead of restating it`, perché non ci sarebbe stata nessuna
reference da linkare. Non era una convenzione nuova: era quella in vigore, violata.

**Files:**
- Create: `skills/harness/references/sweep.md`
- Create: `commands/sweep.md`
- Modify: `test/plugin-commands.test.mjs:16` (`COMMANDS`)
- Modify: `README.md` (tabella dei comandi)
- Modify: `skills/harness/SKILL.md` (la sola voce di indice, come in Task 4)

**Interfaces:**
- Consumes: la bussola *costoso e invisibile* di `SKILL.md`, già in piedi da P1 — il setaccio la
  linka, non la riscrive.
- Produces: `references/sweep.md`, che Task 6 nominerà nel capitolo sugli strumenti.

- [ ] **Step 1: Aggiungere il comando alla lista e vedere fallire**

In `test/plugin-commands.test.mjs`, riga 16:

```javascript
const COMMANDS = ["board", "compact", "docs-gate", "issue", "status", "sweep", "verify"];
```

Run: `node --test test/plugin-commands.test.mjs`
Expected: FAIL su `commands/sweep.md must exist`.

- [ ] **Step 2: Scrivere la reference**

Creare `skills/harness/references/sweep.md`:

```markdown
# Setaccio dei documenti

Il lavoro **incontra** un'occasione — un difetto visto di sfuggita, una decisione che andava
scritta, un rischio — la annota dove sta lavorando, e la rimanda. Funziona finché qualcuno
rilegge. A fine progetto nessuno rilegge.

Il setaccio è il giro che rilegge. Su un progetto reale, un audit manuale dell'intero corpus —
quattro spec, quattro piani, tre referti di smoke, tre audit, nove ADR e un registro del debito —
ha recuperato circa **venticinque occasioni** scritte da qualche parte e mai arrivate al tracker.
Fra queste due difetti vivi con tanto di file e riga, una voce di debito che una spec aveva
*deciso* di scrivere e non era stata scritta, e una segnalazione di sicurezza fatta a voce.

**Non c'è nessuno script.** Il setaccio è tutto giudizio: raccoglie, verifica, propone, chiede
conferma, e solo dopo scrive. Usa `--get-all` e `--insert`, che esistono già
([issues.md](issues.md)); non serve nessuna primitiva nuova.

## Quando si lancia

**Su richiesta, mai da solo.** Resta on-demand di proposito: la verifica contro il codice del
punto 2 costa un agente, e farla a ogni clock-out sarebbe un controllo che costa più di ciò che
controlla — lo stesso errore che la bussola in [SKILL.md](../SKILL.md) esiste per evitare.

Il momento buono è la fine di un tratto di lavoro lungo, o l'ingresso in un progetto di cui non si
conosce la storia scritta.

## 1. Cosa legge

**I percorsi passati come argomento.** Se non ce ne sono, propone quelli che trova e **li fa
confermare**: harness non sa come un progetto organizza i propri documenti e non lo indovina.
Tipicamente sono spec, piani, ADR, registri del debito, referti di test o di audit, note di
release — tutto ciò che qualcuno ha scritto durante il lavoro e nessuno rilegge.

Il corpus va nominato per esteso prima di leggerlo: un setaccio che ha guardato metà dei documenti
e non lo dice produce un elenco che sembra completo.

## 2. Cosa fa su ogni occasione

Due controlli, **entrambi prima di proporla**:

- **la incrocia col tracker, in tutti gli stati.** Non solo `backlog`: un'occasione già tracciata
  e chiusa non è un'occasione, e riproporla insegna a non fidarsi dell'elenco.
- **la verifica contro il codice.** È il passo che nell'audit reale ha eliminato le occasioni già
  risolte da un tratto di lavoro successivo. Senza, il setaccio propone lavoro già fatto, e chi lo
  legge smette di fidarsene al secondo giro.

Un'occasione che il codice smentisce non si propone: si **riporta come risolta**, così chi legge
sa che il documento che la conteneva è vecchio.

## 3. Cosa promuove

**Solo ciò che passa la bussola** di [SKILL.md](../SKILL.md): se un errore lì sarebbe *costoso **e**
invisibile*. Nell'audit reale sono state **8 occasioni su 25**.

Le issue proposte si mostrano tutte insieme, con il documento e il punto da cui vengono, e si
aprono **solo dopo conferma esplicita**. Ognuna porta i propri `validation.criteria`: se un
criterio eseguibile non si riesce a scrivere, il problema non è la issue — è che non si sa ancora
come si riconosce il fallimento, e va capito prima di aprirla.

## 4. Cosa fa delle altre

Le **riporta in sessione, e si ferma lì.**

Harness non crea documenti nel progetto, nemmeno quando sarebbe comodo: se quelle occasioni
meritano un registro, lo scrive un'altra skill — quelle di documentazione presenti nell'ambiente,
che harness propone e non invoca. La proprietà che chiude il cerchio è che quel registro, una
volta scritto, entra nel corpus che il **setaccio successivo** legge: niente si perde, e harness
non allarga la propria superficie.

Metterle nel tracker come issue di `backlog` sarebbe la scorciatoia ovvia, e contraddice
direttamente la bussola: non sono costose-e-invisibili, e riempirebbero il riepilogo di righe che
nessuno prenderà — esattamente il difetto contro cui la bussola esiste.

## Cosa il setaccio non è

- **Non è un controllo del gate documentale.** Quello guarda i commit e ha il proprio script
  ([docs-gate.md](docs-gate.md)). Il setaccio guarda i documenti, e i due si incontrano solo nel
  fatto che entrambi finiscono in issue.
- **Non è automatico e non entra nel clock-out.**
- **Non riscrive i documenti che legge.** Li legge e basta.
```

- [ ] **Step 3: Scrivere il comando**

Creare `commands/sweep.md`:

```markdown
---
description: Setaccia i documenti del progetto per le occasioni che hanno scoperto e mai tracciato, le verifica e propone le issue che meritano di nascere. Senza argomenti propone il corpus da leggere e lo fa confermare.
argument-hint: "[percorsi o glob dei documenti da setacciare]"
allowed-tools: Bash, Read, Glob, Grep, Write
---

Setaccio dei documenti del progetto corrente. Il procedimento completo — cosa legge, i due
controlli su ogni occasione, cosa promuove e cosa fa delle altre — è in
`${CLAUDE_PLUGIN_ROOT}/skills/harness/references/sweep.md`: **leggilo prima di cominciare**, non è
un contratto di output da consultare a posteriori.

Non c'è nessuno script: si usano `--get-all` e `--insert` di
`${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs`.

Argomenti: `$ARGUMENTS` — percorsi o glob dei documenti da setacciare. Nessun argomento: proponi
il corpus che trovi (spec, piani, ADR, registri, referti) e **fallo confermare** prima di leggerlo.

## Cosa fare

1. **Fissa il corpus** e dillo per esteso. Un setaccio che ha letto metà dei documenti senza
   dichiararlo produce un elenco che sembra completo.
2. **Raccogli le occasioni** — quello che i documenti dicono andrebbe fatto e che non risulta
   fatto.
3. **Incrocia col tracker in tutti gli stati**, non solo `backlog`, e **verifica ogni occasione
   contro il codice**: quelle già risolte da un lavoro successivo non si propongono, si riportano
   come risolte.
4. **Promuovi solo ciò che passa la bussola** di `SKILL.md` — costoso **e** invisibile. Mostra le
   issue proposte, coi `validation.criteria`, e **aspetta conferma esplicita** prima di
   `--insert`.
5. **Riporta le non promosse in sessione** e fermati lì: harness non crea documenti nel progetto.
   Se meritano un registro, proponi le skill di documentazione presenti nell'ambiente.

## Cosa non fare

Non aprire issue senza conferma, non riscrivere i documenti che leggi, e non promuovere tutto: la
proporzione dell'audit reale che ha originato questo comando è stata 8 occasioni su 25.
```

- [ ] **Step 4: Documentare il comando nel README**

In `README.md`, nella tabella dei comandi, inserire in ordine alfabetico dopo la riga di
`/harness:status`:

```markdown
| `/harness:sweep` | Sweeps the project's documents for what they found and never tracked, and proposes the issues worth opening | Proposes the corpus to read and asks you to confirm it |
```

- [ ] **Step 5: Aggiungere la voce di indice in `SKILL.md`**

Nel capitolo `## Reference`, dopo la voce di `references/status.md`:

```markdown
- [references/sweep.md](references/sweep.md) — setaccio dei documenti: cosa legge, cosa promuove,
  cosa fa delle occasioni che non promuove.
```

- [ ] **Step 6: Lanciare la suite intera**

Run: `npm run test`
Expected: PASS, tutta — compresi `every reference file is reachable from SKILL.md` e `cross-links
between reference files resolve too` (`sweep.md` linka `issues.md` e `docs-gate.md`, entrambi
esistenti).

- [ ] **Step 7: Portare la issue a `in_review` — nessun commit**

```powershell
$env:HARNESS_ROLE='worker'
node "${env:CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id-sweep> --issue-data '{"status":"in_review"}'
```

---

### Task 6: `SKILL.md`, e l'invariante contro lo script orfano

Il capitolo del gate descrive oggi un controllo a occhio. Diventa due cose: la issue docs si apre
**dichiarando in `covers` la revisione che copre**, e `docs-gate.mjs` è come ci si accorge che è
saltato.

Più l'asimmetria che manca: `test/plugin-skill.test.mjs` impedisce la reference orfana, ma niente
impedisce lo **script orfano**. Che oggi tutti e cinque siano nominati è una disciplina, non un
invariante — e senza, `docs-gate.mjs` potrebbe finire invisibile proprio a chi legge la skill.

**Files:**
- Modify: `skills/harness/SKILL.md` — capitolo `## Dopo il commit: gate documentale` (`:280-288`),
  più una riga sul setaccio
- Modify: `test/plugin-skill.test.mjs` — un test in fondo

**Interfaces:**
- Consumes: `references/docs-gate.md` (Task 4) e `references/sweep.md` (Task 5), già linkate
  dall'indice; `scripts/docs-gate.mjs` lanciabile (Task 3); il campo `covers` (Task 1).
- Produces: niente che i task successivi consumino.

- [ ] **Step 1: Scrivere il test che fallisce**

In fondo a `test/plugin-skill.test.mjs`:

```javascript
test("the docs gate names the field and the script, not just the duty", () => {
  const content = readSkill();
  const start = content.indexOf("## Dopo il commit: gate documentale");
  const end = content.indexOf("## Clock out");
  assert.ok(start !== -1 && end > start, "the docs gate chapter moved: fix this test, not the skill");
  const chapter = content.slice(start, end);

  // A duty with no field to write and no way to notice it was skipped is the instruction that
  // already failed twice out of three times on the only project that ran it.
  assert.match(chapter, /covers/, "the docs issue must declare the revision it covers");
  assert.match(
    chapter,
    /docs-gate\.mjs/,
    "the chapter prescribes running the script, so it must name it directly, like status-cli.mjs"
  );
});

test("every CLI script the plugin ships is named where an agent will read it", () => {
  // The mirror image of the orphan-reference test above. A subagent, or an agent loading this
  // skill from outside, has no slash commands: it reads SKILL.md and follows the links into
  // references/. A script named nowhere in that corpus exists for nobody.
  const corpus = [
    readSkill(),
    ...readdirSync(referencesDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => readFileSync(path.join(referencesDir, f), "utf8")),
  ].join("\n");

  for (const file of readdirSync(path.join(rootDir, "scripts")).filter((f) => f.endsWith(".mjs"))) {
    assert.ok(
      corpus.includes(file),
      `scripts/${file} exists but neither SKILL.md nor any reference names it: an agent that reads the skill will never learn it is there`
    );
  }
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `node --test test/plugin-skill.test.mjs`
Expected: FAIL su `the docs issue must declare the revision it covers`. Il test dello script
orfano invece **passa già**: tutti e sei gli script sono nominati (`docs-gate.mjs` da
`references/docs-gate.md`, scritta in Task 4). È il punto — è una disciplina rispettata che
diventa un invariante.

- [ ] **Step 3: Riscrivere il capitolo del gate**

In `skills/harness/SKILL.md`, sostituire interamente il capitolo alle righe 280-288:

```markdown
## Dopo il commit: gate documentale

Subito dopo ogni commit, controlla i file che conteneva. Se il commit tocca **file di
codice** (secondo `docsGate.include`/`exclude` in `.harness/config.json`), apri una issue
docs con `--insert`, **dichiarando in `covers` la revisione che copre**: quello SHA esiste già —
la issue docs nasce dopo il commit che deve documentare — e senza di lui il commit resta scoperto
anche se la issue c'è. La issue verrà lavorata poi col workflow normale: clock-in, verifica
indipendente, gate sul commit come qualsiasi altra.

Non blocca mai il commit: è un promemoria tracciato, non un veto. Nel modello plugin questo
controllo lo fai tu, non un hook `post-commit` — e per questo è saltabile.

**Come ci si accorge che è saltato**, che è la parte che regge quando il promemoria non ha retto:

```bash
node "$SCRIPTS/docs-gate.mjs"
```

Elenca i commit che hanno toccato codice senza che nessuna issue li nomini, **su una finestra di
storia e non sull'ultimo commit**: chi se ne ricorda una volta a fine giornata recupera tutti i
commit scoperti, non l'ultimo. Il costo del dimenticarsene diventa un ritardo, non una perdita.
Contratto in [references/docs-gate.md](references/docs-gate.md).
```

- [ ] **Step 4: Aggiungere la riga sul setaccio**

Sempre in `skills/harness/SKILL.md`, **in fondo al capitolo appena riscritto**, come paragrafo
separato:

```markdown
Il gate guarda i commit. Per quello che i **documenti** del progetto hanno scoperto e mai
tracciato — un difetto annotato in un referto, una decisione scritta e mai eseguita — c'è il
setaccio, [references/sweep.md](references/sweep.md): si lancia su richiesta, non a cadenza fissa,
e propone solo ciò che passa la bussola qui sopra.
```

- [ ] **Step 5: Lanciare la suite intera**

Run: `npm run test`
Expected: PASS. Controllare in particolare `every reference link in SKILL.md resolves to a file
that exists` e `every reference file is reachable from SKILL.md`: le due reference nuove sono
linkate sia dall'indice (Task 4 e 5) sia dal capitolo (qui), e il doppio link non è un problema
per nessuno dei due test.

- [ ] **Step 6: Portare la issue a `in_review` — nessun commit**

```powershell
$env:HARNESS_ROLE='worker'
node "${env:CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id-skill> --issue-data '{"status":"in_review"}'
```

---

### Task 7: Il retrofit di `/harness:issue` e `/harness:compact`

I due comandi hanno **adesso** il difetto che §5 della spec descrive: il giudizio che sta sopra le
primitive — i criteri di qualità di una issue, il raggruppamento in blocchi da far confermare —
vive nei comandi, e un agente che arriva dalla skill impara l'esistenza della primitiva senza
quella del giudizio. `references/issues.md:214` lo dice già a metà: «il giro che `--compact` non fa
— leggere le `done`, proporre i blocchi, farli confermare — è il comando `/harness:compact`».
Nomina il giro e non lo descrive.

È in scope qui perché la correzione è la stessa di Task 4 e 5, e farla due volte a distanza di
tempo costa il doppio.

**Files:**
- Modify: `skills/harness/references/issues.md` — una sezione nuova dopo `## Comandi`, e il
  paragrafo finale di `## --compact`
- Modify: `commands/issue.md` — la sezione `new` si accorcia e rimanda
- Modify: `commands/compact.md` — i passi 2 e 3 si accorciano e rimandano

**Interfaces:**
- Consumes: `references/issues.md` come lasciata da Task 1 (che ci ha aggiunto `covers`). **Non
  iniziare finché Task 1 non è chiuso**: stesso file.
- Produces: niente che altri task consumino.

> **Vincolo da non violare.** Due test esistenti misurano il *contenuto* di questi comandi e
> devono restare verdi:
> - `the compact command projects id and title when it reads the done issues` esige che
>   `commands/compact.md` **conservi** la riga con `--get-all --status done` passata per
>   `| node -e`, con `.title` nella proiezione, e una menzione di `--page`. La meccanica resta nel
>   comando: si sposta il **giudizio**, non l'invocazione.
> - `the issue command cannot close an issue` esige che `commands/issue.md` non contenga nessun
>   payload `done`/`pass` e continui a nominare `harness:verify`.

- [ ] **Step 1: Spostare il giudizio sull'apertura di una issue dentro `issues.md`**

In `skills/harness/references/issues.md`, subito **dopo** il capitolo `## Comandi` (dopo la riga
83, «Un `"validation": null` **esplicito** azzera la validazione; ometterlo la lascia invariata.»)
e **prima** di `## --init`, inserire:

```markdown
## Aprire una issue: cosa decide chi la apre

La CLI valida la **forma** del payload. Quello che rende una issue utile invece che ben formata
sta qui, e vale per chiunque chiami `--insert`: il comando `/harness:issue` come un agente che è
arrivato a questa pagina e chiama la primitiva direttamente. Scritto solo nel comando, questo giro
sarebbe invisibile al secondo, che è il lettore più frequente.

- **I criteri sono la parte che conta.** Si scrivono pensando a chi li leggerà: un altro agente,
  che non ha visto la conversazione e ha gli accessi del worker e nient'altro. Le due regole per
  scriverli sono in «Regole che la CLI non può misurare», più sotto.
- **Se la issue non merita criteri**, `validation` può essere `null` — ma solo nei quattro casi
  della verifica leggera elencati in [SKILL.md](../SKILL.md), e con la riga di motivazione che
  quel capitolo richiede nella `description`. Fuori da quei casi i criteri sono obbligatori.
- **Il `tier` si propone dicendo perché**, così chi dispatcha legge una decisione invece di
  rifarla. Omesso vale `standard`: è un default, non un dato mancante da riempire.
- **Il payload si mostra e si fa confermare prima di scriverlo.** Una issue sbagliata non rompe
  niente, e per questo resta: la si corregge quando è ancora testo in sessione, non dopo che è
  entrata nel tracker.
- **`LIMIT_EXCEEDED` non si risolve comprimendo il testo:** vedi «Cosa fare quando la CLI risponde
  `LIMIT_EXCEEDED`», più sotto.

Prima ancora: **se il lavoro meriti una issue** lo decide la bussola in [SKILL.md](../SKILL.md).
Questa pagina descrive come si scrive una issue, non se vada scritta.
```

- [ ] **Step 2: Descrivere in `issues.md` il giro che `--compact` non fa**

Sempre in `skills/harness/references/issues.md`, sostituire il paragrafo alle righe 214-215:

```markdown
Il giro che `--compact` **non** fa — leggere le `done`, proporre i blocchi, farli confermare — è
il comando `/harness:compact`, che poi chiama questa primitiva col payload confermato.
```

con:

```markdown
### Il giro che `--compact` non fa

La primitiva riceve i blocchi già decisi. Deciderli è il giro qui sotto, che `/harness:compact`
esegue e che **un agente arrivato da questa pagina deve poter eseguire lo stesso**: nominare il
giro senza descriverlo lo rendeva invisibile a metà dei suoi lettori.

1. **Leggere le `done` proiettando `id` e `title`.** `--get-all` restituisce l'oggetto issue
   intero — su questo repository 162.5KB per 88 issue — di cui il raggruppamento usa due campi.
   Senza proiezione il giro si strozza proprio sui tracker grandi, cioè dove compattare serve di
   più. L'elenco è paginato: `totalCount` dice se restano pagine da scorrere con `--page`, e la
   proiezione toglie campi, non issue.
2. **Raggruppare per argomento**, non per ordine cronologico e non un blocco per issue: sapere che
   due issue chiuse parlano dello stesso argomento è il giudizio che la primitiva non fa, ed è
   l'unica cosa che questo giro aggiunge. Meno di due issue `done` → non c'è niente da compattare.
3. **Far confermare il raggruppamento, esplicitamente, prima di chiamare la primitiva.** Un blocco
   scritto è un archivio da disfare a mano: si corregge la proposta finché non va bene, e si
   procede solo dopo un sì.
4. **Chiamare `--compact` col payload confermato**, passato con `--issue-data-file` per non dover
   gestire l'escaping delle quote nella shell.
```

- [ ] **Step 3: Accorciare `commands/issue.md`**

Sostituire la sezione `## `new <descrizione libera>` → creare` (righe 44-65) con:

```markdown
## `new <descrizione libera>` → creare

Trasforma la descrizione dell'utente in `title`, `description` e `validation.criteria`. **Cosa
rende una issue buona invece che ben formata** — criteri, verifica leggera, `tier`, conferma prima
di scrivere — è in `references/issues.md`, sezione "Aprire una issue": leggila, non è opzionale.

Scrivi il payload **su file** e passalo con `--issue-data-file` (nessun escaping di quote da
gestire nella shell), con `"status":"backlog"` e
`"validation":{"criteria":["...","..."],"state":"unknown"}`. L'id della issue creata si legge da
`.data.id` della risposta, non dal testo del messaggio.

Una issue docs che documenta un commit già fatto dichiara quel commit in `"covers":["<sha>"]`: è
ciò che la rende visibile al gate (`/harness:docs-gate`).
```

- [ ] **Step 4: Accorciare `commands/compact.md`**

Sostituire le sezioni `## 2. Proponi i blocchi` e `## 3. Aspetta conferma esplicita` (righe 36-48)
con:

```markdown
## 2. Proponi i blocchi, e falli confermare

Il giro — come si raggruppa, perché non un blocco per issue, e perché la conferma è esplicita — è
in `${CLAUDE_PLUGIN_ROOT}/skills/harness/references/issues.md`, sezione "Il giro che `--compact`
non fa". Per ogni blocco proposto mostra `title`, `description` e la lista `id` (accorciato) +
`title` delle issue che copre, tenendo conto di `$ARGUMENTS` se l'utente ha dato indicazioni.

**Non chiamare la primitiva finché l'utente non conferma il raggruppamento mostrato.**
```

Il paragrafo esplicativo del passo 1 («**Proietta id e titolo prima che l'output arrivi in
contesto.** …») si accorcia a una riga, ma **la riga del comando con la proiezione, la menzione di
`--page` e i rami d'errore del passo 5 restano dove sono**: sono meccanica, non giudizio, e due
test li misurano.

```markdown
**Proietta id e titolo prima che l'output arrivi in contesto**, e scorri tutte le pagine con
`--page <n>` se `totalCount` supera quanto mostrato: il perché è in `references/issues.md`.
```

- [ ] **Step 5: Lanciare la suite intera**

Run: `npm run test`
Expected: PASS. Controllare esplicitamente questi quattro:

```bash
node --test test/plugin-commands.test.mjs
```

- `the compact command projects id and title when it reads the done issues` — la riga con
  `--get-all --status done | node -e ... .title` e la menzione di `--page` sono ancora nel comando;
- `the compact command waits for confirmation before calling the primitive` — «conferma»,
  `--issue-data-file`, `INVALID_DEPENDENCY`, `FORBIDDEN_ROLE` sono ancora nel corpo;
- `the issue command cannot close an issue` — nessun `done`/`pass`, `harness:verify` ancora citato;
- `commands point at the skill instead of restating it` — entrambi linkano ancora
  `skills/harness/references/issues.md` e sono più corti di prima, non più lunghi.

- [ ] **Step 6: Portare la issue a `in_review` — nessun commit**

```powershell
$env:HARNESS_ROLE='worker'
node "${env:CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id-retrofit> --issue-data '{"status":"in_review"}'
```

---

## Dopo i sette task

Ogni issue passa dall'agent `harness-verifier`, che la chiude `done`/`pass` oppure
`blocked`/`fail`. **Solo dopo il `pass`** si committa, una issue alla volta.

**Il gate documentale di questo repository scatta su questi commit**, e non è un dettaglio: i
task 1, 2 e 3 toccano `scripts/*.mjs`, che `docsGate.include` seleziona e nessun `exclude`
esclude. Sono **i primi commit che il gate nuovo dovrà vedere coperti**, ed è il primo posto in cui
harness lo applica a sé stesso. Le issue docs che ne nascono dichiarano in `covers` lo SHA che
coprono.

**Il tracker di questo repository non ha `schema_version`** (legge come `0`): il campo `covers`
non esiste su nessuna delle sue issue, e il gate lanciato qui risponderà «nessuna revisione
dichiarata, passa `--since`». È il comportamento corretto, non un difetto da aggirare. Per usarlo
sul serio ci sono due strade, entrambe legittime:

- lanciarlo con `--since <rev>` scegliendo il punto da cui ha senso guardare;
- oppure portare il tracker allo schema 2 con `node scripts/issue-manager.mjs --upgrade` — che è
  una **modifica reale ai dati** e va fatta dalla CLI, mai a mano (`CLAUDE.md`), e vale la pena
  farla in un commit dedicato invece che dentro uno dei sette.

**I componenti nuovi diventano invocabili solo dopo un riavvio della sessione di Claude Code**
(`CLAUDE.md`): `/harness:docs-gate` e `/harness:sweep` non esistono nella sessione che li scrive.
Provarli davvero — non solo `npm test` — è la regola di questo repository, e va fatto in una
sessione successiva prima di considerare il lavoro rilasciato.

## Self-review

**Copertura della spec.**

| spec | dove |
|---|---|
| §1 lo script, autonomo, tre letture, una domanda | Task 2 (decisione) + Task 3 (guscio) |
| §1.1 cumulativo mai puntuale | Task 3 (`start..HEAD`), documentato in Task 4 |
| §1.2 finestra autocalibrata, `--since` al primo uso | Task 3 Step 4 (`oldestCommit`, il `fail` senza revisioni) + test |
| §1.3 riferimenti risolti, irrisolti riportati | Task 3 (`resolveRefs`) + Task 2 (allerta nel render) |
| §1.4 copertura = esiste, non chiusa | Task 2 (`declaredRefs` non filtra per stato) + test e2e |
| §1.5 canale, testo, uscite | Task 3 (`fail`, `USAGE`) + Task 4 (tabella) |
| §2 il campo `covers` | Task 1 |
| §2.1 scrivibile senza un passo in più | Task 1 Step 9(e), paragrafo «Quando si scrive» |
| §2.2 forma: generale, assente = `[]`, lasca, senza tetto | Task 1 Step 4 + test |
| §2.3 migrazione `1 → 2`, non automatica, tracker a 1 continua a funzionare | Task 1 Step 3 + test |
| §3 reference che possiede il contratto, comando sottile | Task 4 |
| §4 il setaccio, senza script | Task 5 |
| §5.1/5.2 la convenzione, e l'asimmetria che manca | Task 6 (test dello script orfano) |
| §5.3 cosa cambia in `SKILL.md` | Task 6 |
| §5.4 retrofit dei due comandi | Task 7 |
| §6 fuori scope | nessun task: P3, board, automazione del setaccio |
| §7 come si verifica: tre superfici + test dello script orfano | Task 1 (schema), Task 2 (funzione pura), Task 3 (end-to-end), Task 6 (orfano) |

**Nessun placeholder.** Ogni passo che modifica un file porta il testo esatto, vecchio e nuovo;
ogni passo che crea un file ne porta il contenuto intero. Gli unici segnaposto sono `<id-covers>`,
`<id-gate-core>`, `<id-gate-shell>`, `<id-docs-gate-ref>`, `<id-sweep>`, `<id-skill>`,
`<id-retrofit>`, che sono gli id delle issue e si leggono dal tracker.

**Coerenza dei nomi e dei tipi.** `covers` si chiama così nello schema (Task 1), in `declaredRefs`
(Task 2), nel render (`coperto = una issue lo dichiara in covers`), nella reference e in
`SKILL.md`. `buildGateReport` restituisce `{ scanned, code, uncovered }` in Task 2 e Task 3 lo
consuma con quelle chiavi. `renderGateReport(report, { project, window, unresolved })` ha la stessa
firma nei test di Task 2 e nella chiamata di Task 3. `SEP` è definito una volta sola, in Task 3, ed
è la stessa costante che `parseLog` usa e che il test di `parseLog` scrive a mano come `"\u001f"`.

**Il codice di Task 2 e Task 3 è stato eseguito, non solo scritto.** Il modulo e la sua suite sono
stati materializzati da questo documento in una cartella temporanea e lanciati: **28 test verdi**,
inclusi quelli end-to-end su repository git veri. Le quattro assunzioni su git sono state
verificate a mano una per una — `rev-parse --verify --quiet <ref>^{commit}` (0 + sha, 1 + vuoto),
il formato di `log --name-only` con un `--format` custom, `--no-walk` con timestamp, e il caso che
ha giustificato un guard: **`git log --no-walk` senza revisioni ripiega su `HEAD` in silenzio**,
quindi `oldestCommit([])` deve uscire prima di chiamarlo o «nessuna revisione dichiarata»
diventerebbe una finestra di un commit.

**Quattro trappole già disinnescate, che senza il piano si scoprirebbero a metà lavoro.**

1. `SCHEMA_VERSION 1 → 2` rompe **tre** aspettative esistenti in
   `test/plugin-issue-manager.test.mjs` (`migrated: 2` in due punti, il set di chiavi dopo
   l'upgrade): Task 1 Step 1 le cambia insieme ai test nuovi, non dopo.
2. `cross-links between reference files resolve too` **fallirebbe** se Task 1 linkasse
   `docs-gate.md` prima che Task 4 lo crei: Task 1 Step 10 scrive il rimando senza link, Task 4
   Step 5 lo chiude.
3. `every reference file is reachable from SKILL.md` **fallirebbe** alla fine di Task 4 e di Task 5
   se l'indice non fosse aggiornato subito: entrambi i task aggiungono la propria voce di indice
   nel task stesso, e Task 6 aggiunge i link dal corpo senza toccarla.
4. **L'intestazione del report sfondava le 80 colonne** — 93 su un nome di progetto ordinario,
   perché l'etichetta della finestra da sola ne occupa 56 — e il test di larghezza *passava lo
   stesso*, perché la renderizzava con un'etichetta corta e sintetica. Trovato eseguendo lo
   script, non leggendolo. Da qui due cose nel piano: l'intestazione è su **due righe**, e il test
   di larghezza usa il nome e l'etichetta **veri**, non un segnaposto. È la lezione generale sui
   test di formato: misurare l'output con dati più piccoli di quelli reali è non misurarlo.
