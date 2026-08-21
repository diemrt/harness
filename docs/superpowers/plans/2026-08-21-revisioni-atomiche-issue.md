# Revisioni atomiche e compare-and-set delle issue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedire lost update sulle issue facendo nominare a ogni mutazione lo stato letto, serializzando read–compare–validate–write e migrando senza perdita i tracker precedenti.

**Architecture:** `issue-manager.mjs` resta l'unico orchestratore e writer logico: normalizza `revision`, valida il CAS e racchiude tutte le mutazioni in un lock transazionale di progetto. Il nuovo `tracker-lock.mjs` gestisce esclusivamente proprietà, attesa e recupero del lock; `issue-store.mjs` continua a occuparsi soltanto del codec Markdown e delle sostituzioni atomiche del singolo file. Le skill, il worker esterno e il verificatore rileggono l'issue e passano la revisione osservata, senza merge automatici ciechi.

**Tech Stack:** Node.js >=18, moduli ES, `node:fs`, `node:crypto`, `node:test`, Markdown/YAML frontmatter, PowerShell e shell POSIX per gli esempi operativi.

**Spec:** `docs/superpowers/specs/2026-08-21-revisioni-atomiche-issue-design.md`

## Global Constraints

- Il tracker resta Markdown e `scripts/issue-manager.mjs` resta il solo writer delle issue.
- Il CAS copre `--update`, `--delete` e ogni issue consumata da `--compact`; `--insert`, `--init` e `--upgrade` usano il lock senza revisione attesa.
- Il flag `--expected-revision` con un intero positivo è obbligatorio per update/delete; compact usa `{ id, expected_revision }` e rifiuta il vecchio `issue_ids`.
- `revision` è automatico, intero positivo e monotono: baseline `1`, prima mutazione riuscita `2`, nessuna accettazione nei payload insert/update.
- `SCHEMA_VERSION` passa da `4` a `5`; letture di record senza campo espongono `revision: 1` senza riscrivere byte.
- Il lock è `.harness/issue-manager.lock`, ritenta ogni 50 ms per al massimo 5 secondi, non sottrae lock vivi e rilascia soltanto il proprio token.
- `REVISION_CONFLICT`, `INVALID_REVISION`, `MISSING_ARGS` e `TRACKER_BUSY` non scrivono alcun file.
- Le letture (`--get`, `--get-all`, `--dump`, status) restano lock-free.
- Il tracker reale in `.harness/issues/` non viene mai usato come fixture; ogni prova mutante usa directory temporanee.
- La verifica indipendente resta obbligatoria e il gate finale resta `npm run test`.
- I tre manifest passano insieme da `1.0.0` a `1.1.0`, soltanto nell'ultimo task.

---

## File Structure

- Create `scripts/tracker-lock.mjs`: acquisizione esclusiva, classificazione del proprietario, attesa, recupero del lock abbandonato e rilascio token-safe.
- Create `test/plugin-tracker-lock.test.mjs`: test focalizzati e portabili del ciclo di vita del lock.
- Modify `scripts/issue-store.mjs`: round-trip del campo `revision`; nessuna logica CAS o di lock.
- Modify `scripts/issue-manager.mjs`: schema 5, normalizzazione/validazione della revisione, migrazione, argomenti CLI, CAS e sezioni critiche delle mutazioni.
- Modify `scripts/harness-worker.mjs`: prompt del worker con obbligo di rilettura e revisione attesa.
- Modify `agents/harness-verifier.md`: chiusura dell'issue con revisione appena letta e gestione esplicita dei conflitti.
- Modify `skills/harness/SKILL.md`: regola operativa read–rebuild–CAS per ogni mutazione inline.
- Modify `skills/harness/references/issues.md`: schema 5, contratti di update/delete/compact/upgrade, output ed errori.
- Modify `skills/harness/references/verification.md`: chiusura del verificatore protetta da CAS.
- Modify `skills/harness/references/install-check.md`: avviso che schema 5 richiede plugin 1.1 e una nuova sessione prima di mutare il tracker.
- Modify `skills/issue/SKILL.md`: show/update e creazione dei payload con revisione osservata.
- Modify `skills/compact/SKILL.md`: proposta e conferma basate su coppie id/revisione.
- Modify `CONTRIBUTING.md`: nota di rilascio operativa per aggiornamento della copia installata e riavvio sessione.
- Modify `test/plugin-issue-store.test.mjs`: codec e campo revision.
- Modify `test/plugin-issue-manager.test.mjs`: schema, migrazione, CAS, compatibilità, assenza di scritture e concorrenza reale.
- Modify `test/plugin-worker.test.mjs`, `test/plugin-agent.test.mjs`, `test/plugin-skill.test.mjs`, `test/plugin-commands.test.mjs`: copertura dei chiamanti e della documentazione spedita.
- Modify `test/smoke.test.mjs`: presenza del nuovo modulo e coerenza delle versioni.
- Modify `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`: versione finale `1.1.0`.

### Task 1: Revision nel codec, nelle letture e nello schema 5

**Files:**
- Modify: `scripts/issue-store.mjs:106-304`
- Modify: `scripts/issue-manager.mjs:167-256, 344-376, 690-816, 1053-1205, 1582-1668`
- Test: `test/plugin-issue-store.test.mjs`
- Test: `test/plugin-issue-manager.test.mjs`

**Interfaces:**
- Consumes: gli oggetti issue correnti e la pipeline ordinata `MIGRATIONS`.
- Produces: `normalizeStoredRevision(issue): issue`, `validateRevision(value, fieldName): number`, schema `5`, letture sempre dotate di `revision`, nuove issue a revisione `1`.

- [ ] **Step 1: Estendere le fixture del codec e scrivere i test rossi di round-trip**

In `completeIssue()` inserire `revision: 1` immediatamente dopo `id: ID_ONE`, quindi verificare il round-trip e i valori invalidi presenti sul disco:

```js
test("serializeIssue/parseIssue round-trip revision", () => {
  const issue = completeIssue({ revision: 7 });
  assert.equal(parseIssue(serializeIssue(issue), "11111111.md").revision, 7);
});
```

- [ ] **Step 2: Scrivere i test rossi delle superfici di lettura e insert**

In `plugin-issue-manager.test.mjs` coprire `--insert`, `--get`, `--get-all` e `--dump`, compresa una issue Markdown senza campo:

```js
test("insert starts at revision 1 and every read surface exposes it", () => {
  const dir = tempProject();
  try {
    const inserted = assertOk(run(dir, ["--insert", "--issue-data", JSON.stringify(validIssue())]));
    assert.equal(inserted.revision, 1);
    assert.equal(assertOk(run(dir, ["--get", "--issue-id", inserted.id])).revision, 1);
    assert.equal(assertOk(run(dir, ["--get-all", "--status", "backlog"])).issues[0].revision, 1);
    assert.equal(assertOk(run(dir, ["--dump"])).issues[0].revision, 1);
  } finally {
    cleanup(dir);
  }
});
```

Salvare i byte prima e dopo la lettura del record senza `revision` e confrontarli con `assert.deepEqual(projectFiles(dir), before)`.

- [ ] **Step 3: Eseguire i test focalizzati e confermare il fallimento**

Run: `node --test test/plugin-issue-store.test.mjs test/plugin-issue-manager.test.mjs`

Expected: FAIL perché il codec e gli output non materializzano ancora `revision` e lo schema è ancora `4`.

- [ ] **Step 4: Implementare normalizzazione e validazione senza logica CAS**

In `issue-manager.mjs` definire interfacce uniche e riusarle in letture, insert e migrazione:

```js
function validateRevision(value, fieldName = "revision") {
  if (!Number.isInteger(value) || value < 1) {
    fail(`'${fieldName}' must be a positive integer.`, "INVALID_REVISION");
  }
  return value;
}

function normalizeStoredRevision(issue) {
  const revision = hasProp(issue, "revision") ? validateRevision(issue.revision) : 1;
  return { ...issue, revision };
}
```

Portare `SCHEMA_VERSION` a `5`, aggiungere la migrazione `to: 5` che materializza solo il campo assente, vietare `revision` tra i campi input e costruire insert con `revision: 1`. Normalizzare immediatamente i risultati di `readIssue`/`readAllIssues` nella superficie di `issue-manager`, lasciando `issue-store` agnostico rispetto alla baseline.

- [ ] **Step 5: Estendere upgrade Markdown e legacy**

Fare attraversare a entrambi i percorsi la stessa migrazione `4 -> 5`; preparare tutti i record serializzati in memoria, preservare revisioni presenti e timestamp, scrivere la config per ultima. Inferire schema effettivo `4` se almeno un record manca del campo, altrimenti `5`, quando la config Markdown non dichiara una versione.

- [ ] **Step 6: Eseguire test focalizzati e suite**

Run: `node --test test/plugin-issue-store.test.mjs test/plugin-issue-manager.test.mjs`

Expected: PASS, inclusi upgrade ripetuto byte-identico e lettura lock-free senza riscritture.

- [ ] **Step 7: Commit**

```bash
git add scripts/issue-store.mjs scripts/issue-manager.mjs test/plugin-issue-store.test.mjs test/plugin-issue-manager.test.mjs
git commit -m "feat: add issue revisions and schema 5"
```

### Task 2: Lock transazionale di progetto

**Files:**
- Create: `scripts/tracker-lock.mjs`
- Create: `test/plugin-tracker-lock.test.mjs`
- Modify: `test/smoke.test.mjs`

**Interfaces:**
- Consumes: una directory progetto e callback sincrona di mutazione.
- Produces: `withTrackerLock(projectDir, callback, options?): unknown`; errore esportato `TrackerLockError` con `code: "TRACKER_BUSY"`.

- [ ] **Step 1: Scrivere i test rossi del proprietario e del rilascio**

```js
test("withTrackerLock writes ownership and removes only its own token", () => {
  const dir = tempProject();
  const lockPath = path.join(dir, ".harness", "issue-manager.lock");
  withTrackerLock(dir, () => {
    const owner = JSON.parse(readFileSync(lockPath, "utf8"));
    assert.equal(owner.pid, process.pid);
    assert.equal(typeof owner.token, "string");
    assert.equal(typeof owner.created_at, "string");
  });
  assert.equal(existsSync(lockPath), false);
});
```

Aggiungere casi per callback che lancia, token sostituito prima del `finally`, lock vivo che scade, PID terminato, file vuoto recente e file vuoto oltre grazia.

- [ ] **Step 2: Eseguire il test e confermare il fallimento**

Run: `node --test test/plugin-tracker-lock.test.mjs`

Expected: FAIL con modulo `scripts/tracker-lock.mjs` non trovato.

- [ ] **Step 3: Implementare acquisizione esclusiva e classificazione portabile**

Usare `openSync(lockPath, "wx")`, `randomUUID()`, `process.kill(pid, 0)` e `Atomics.wait` per l'attesa sincrona. Trattare `ESRCH` come morto, `EPERM` come vivo, JSON parziale entro 5 secondi come vivo e oltre 5 secondi come abbandonato. Esporre opzioni temporali solo per test:

```js
export function withTrackerLock(projectDir, callback, options = {}) {
  const retryMs = options.retryMs ?? 50;
  const timeoutMs = options.timeoutMs ?? 5000;
  const graceMs = options.graceMs ?? 5000;
  const owner = acquire(projectDir, { retryMs, timeoutMs, graceMs, ...options });
  try {
    return callback();
  } finally {
    release(owner);
  }
}
```

Il rilascio rilegge il file e chiama `rmSync(owner.lockPath, { force: true })` soltanto quando il token coincide.

- [ ] **Step 4: Verificare attesa, recupero e cleanup**

Run: `node --test test/plugin-tracker-lock.test.mjs`

Expected: PASS su Windows e senza dipendenze native.

- [ ] **Step 5: Aggiornare il controllo strutturale e lanciare la suite**

Aggiungere `scripts/tracker-lock.mjs` alla lista dei componenti attesi in `test/smoke.test.mjs`.

Run: `npm run test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/tracker-lock.mjs test/plugin-tracker-lock.test.mjs test/smoke.test.mjs
git commit -m "feat: serialize tracker mutations with a lock"
```

### Task 3: CAS obbligatorio per update e delete

**Files:**
- Modify: `scripts/issue-manager.mjs:1446-1579, 1673-1878`
- Test: `test/plugin-issue-manager.test.mjs`

**Interfaces:**
- Consumes: `withTrackerLock`, `normalizeStoredRevision`, CLI `--expected-revision`.
- Produces: `updateIssue(issueId, issueData, expectedRevision, declaredUnchanged)`, `deleteIssue(issueId, expectedRevision)`; delete restituisce `{ id, deleted: true, revision: n + 1 }`.

- [ ] **Step 1: Scrivere test rossi di forma e protezione del token**

```js
test("update requires a positive expected revision and rejects revision in the patch", () => {
  const { dir, issue } = setupProject();
  try {
    assertFailure(run(dir, ["--update", "--issue-id", issue.id, "--issue-data", '{"title":"x"}']), "MISSING_ARGS");
    assertFailure(run(dir, ["--update", "--issue-id", issue.id, "--expected-revision", "0", "--issue-data", '{"title":"x"}']), "INVALID_REVISION");
    assertFailure(run(dir, ["--update", "--issue-id", issue.id, "--expected-revision", "1", "--issue-data", '{"revision":9}']), "INVALID_INPUT");
  } finally {
    cleanup(dir);
  }
});
```

Coprire anche delete mancante/invalida e disuguaglianza futura, non solo stantia.

- [ ] **Step 2: Scrivere test rossi di assenza di scritture e ordine degli errori**

Creare snapshot `projectFiles(dir)` prima di update/delete con revisione errata e verificare uguaglianza byte per byte. Preparare inoltre un payload stantio che fallirebbe anche un guard DAG o decomposizione e aspettarsi prima `REVISION_CONFLICT`.

- [ ] **Step 3: Eseguire i test CAS focalizzati e confermare il fallimento**

Run: `node --test --test-name-pattern="revision|stale|expected|delete" test/plugin-issue-manager.test.mjs`

Expected: FAIL perché gli argomenti non esistono e update/delete sono ancora last-write-wins.

- [ ] **Step 4: Parsare la revisione prima del lock e confrontarla sotto lock**

Aggiungere `expected-revision` alle opzioni `parseArgs`, distinguerne assenza e valore invalido, poi racchiudere l'intero flusso:

```js
function assertExpectedRevision(issue, expectedRevision) {
  const currentRevision = normalizeStoredRevision(issue).revision;
  if (currentRevision !== expectedRevision) {
    fail(
      `Issue '${issue.id}' revision conflict: expected ${expectedRevision}, current ${currentRevision}.`,
      "REVISION_CONFLICT"
    );
  }
  return currentRevision;
}
```

Update deve rileggere sotto lock, confrontare, applicare merge/guard sullo stato corrente, scrivere `revision: current + 1` e restituire l'oggetto completo. Delete confronta prima dei dipendenti e restituisce la revisione consumata incrementata.

- [ ] **Step 5: Mappare `TrackerLockError` nell'envelope CLI**

Nel confine `main()` convertire soltanto `TrackerLockError` in `writeFail(error.message, "TRACKER_BUSY")`; lasciare invariata la gestione degli errori di dominio esistenti. Accertarsi che ogni eccezione attraversi il `finally` del lock.

- [ ] **Step 6: Aggiornare help e contratto testuale della CLI**

Mostrare le due forme con il flag obbligatorio `--expected-revision`, il nuovo output delete e i quattro errori stabili. La lista dei campi automatici deve includere `revision`.

- [ ] **Step 7: Eseguire test focalizzati e suite**

Run: `node --test test/plugin-issue-manager.test.mjs test/plugin-tracker-lock.test.mjs`

Expected: PASS.

Run: `npm run test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/issue-manager.mjs test/plugin-issue-manager.test.mjs
git commit -m "feat: require compare-and-set for issue writes"
```

### Task 4: Compact atomica, init/insert/upgrade sotto lock e concorrenza reale

**Files:**
- Modify: `scripts/issue-manager.mjs:1005-1443, 1631-1668, 1780-1878`
- Modify: `test/plugin-issue-manager.test.mjs`

**Interfaces:**
- Consumes: `withTrackerLock` e riferimenti compact `{ id, expected_revision }`.
- Produces: compact all-or-nothing con `consumed: [{ id, revision }]`; tutte le mutazioni serializzate; blocchi e insert a revisione `1`.

- [ ] **Step 1: Scrivere i test rossi del nuovo payload compact**

```js
const compactPayload = {
  blocks: [{
    title: "Closed work",
    description: "Archived completed work.",
    issues: [{ id: first.id, expected_revision: 3 }],
  }],
};
```

Verificare rifiuto di `issue_ids`, revisione mancante/invalida, id duplicato e un solo riferimento stantio in un batch multi-issue. Sul conflitto confrontare l'intero albero prima/dopo: nessun archivio, blocco, rename o rimozione.

- [ ] **Step 2: Scrivere i test rossi del risultato e delle altre mutazioni**

Per compact riuscita aspettarsi `consumed` con `n + 1` e blocco a `revision: 1`. Aggiungere prove che init, insert e upgrade rispettino un lock vivo e restituiscano `TRACKER_BUSY`, senza richiedere `--expected-revision`.

- [ ] **Step 3: Scrivere il test rosso a due processi**

Avviare due `spawn()` reali sullo stesso tracker, stessa revisione e patch di checklist differenti. Raccogliere stdout/exit code e asserire:

```js
assert.deepEqual(results.map((r) => r.code).sort(), [0, 1]);
assert.equal(results.filter((r) => r.envelope.ok).length, 1);
assert.equal(results.find((r) => !r.envelope.ok).envelope.code, "REVISION_CONFLICT");
assert.equal(assertOk(run(dir, ["--get", "--issue-id", issue.id])).revision, 2);
```

Rileggere il vincitore, riapplicare soltanto la spunta persa con revisione `2`, aspettarsi revisione `3` e entrambe le spunte conservate.

- [ ] **Step 4: Eseguire i test focalizzati e confermare il fallimento**

Run: `node --test --test-name-pattern="compact|concurrent|lock" test/plugin-issue-manager.test.mjs`

Expected: FAIL sul vecchio `issue_ids`, sull'assenza di `consumed` e sulla corsa non serializzata.

- [ ] **Step 5: Rifattorizzare compact in prepare-then-write sotto un solo lock**

Validare la forma prima del lock. Sotto lock leggere tutti i bersagli, confrontare tutte le revisioni, eseguire guard di stato/DAG, serializzare archivio/blocchi/risposta in memoria e solo allora scrivere nell'ordine archivio → blocchi → rimozioni. La risposta aggiunge:

```js
consumed: selectedIssues.map((issue) => ({
  id: issue.id,
  revision: issue.revision + 1,
}))
```

- [ ] **Step 6: Racchiudere init, insert e upgrade nel lock**

Spostare classificazione storage e riletture decisive dentro la callback protetta, evitando snapshot globali calcolati prima dell'acquisizione. Insert genera identità e collision check sotto lock. Upgrade prepara e valida tutti i record prima del primo byte e mantiene config per ultima.

- [ ] **Step 7: Eseguire i test di concorrenza ripetutamente**

Run: `node --test --test-name-pattern="concurrent|TRACKER_BUSY|compact" test/plugin-issue-manager.test.mjs test/plugin-tracker-lock.test.mjs`

Expected: PASS per tre esecuzioni consecutive, con un solo vincitore nella corsa.

- [ ] **Step 8: Eseguire la suite e commit**

Run: `npm run test`

Expected: PASS.

```bash
git add scripts/issue-manager.mjs test/plugin-issue-manager.test.mjs
git commit -m "feat: make tracker mutations transactional"
```

### Task 5: Chiamanti agentici e documentazione del retry consapevole

**Files:**
- Modify: `scripts/harness-worker.mjs`
- Modify: `agents/harness-verifier.md`
- Modify: `skills/harness/SKILL.md`
- Modify: `skills/harness/references/issues.md`
- Modify: `skills/harness/references/verification.md`
- Modify: `skills/harness/references/install-check.md`
- Modify: `skills/issue/SKILL.md`
- Modify: `skills/compact/SKILL.md`
- Modify: `CONTRIBUTING.md`
- Modify: `test/plugin-worker.test.mjs`
- Modify: `test/plugin-agent.test.mjs`
- Modify: `test/plugin-skill.test.mjs`
- Modify: `test/plugin-commands.test.mjs`

**Interfaces:**
- Consumes: `revision` restituita da `--get`/`--dump` e nuovo contratto mutante.
- Produces: ogni esempio e prompt spedito legge, ricostruisce e passa `--expected-revision`; conflitto e lock occupato hanno procedure distinte.

- [ ] **Step 1: Scrivere test strutturali rossi per ogni chiamante**

In agent/skill tests estrarre i comandi `--update`, `--delete`, `--compact` e richiedere rispettivamente `--expected-revision` o `expected_revision`. Nel worker test verificare che il prompt dica di non ripetere lo stesso payload su `REVISION_CONFLICT`:

```js
assert.match(prompt, /--expected-revision/);
assert.match(prompt, /REVISION_CONFLICT/);
assert.match(prompt, /rilegg/i);
assert.doesNotMatch(prompt, /ripeti(?:re)? lo stesso payload/i);
```

- [ ] **Step 2: Eseguire i test e confermare il fallimento**

Run: `node --test test/plugin-worker.test.mjs test/plugin-agent.test.mjs test/plugin-skill.test.mjs test/plugin-commands.test.mjs`

Expected: FAIL perché gli esempi mutanti non passano ancora una revisione.

- [ ] **Step 3: Aggiornare la reference autorevole delle issue**

Documentare schema 5, baseline, campi automatici, CLI update/delete/compact, `consumed`, upgrade Markdown, inferenza di versione e tabella errori. Esplicitare la procedura:

1. rileggere l'issue;
2. ricostruire il cambiamento sullo stato corrente;
3. rieseguire i guard locali;
4. inviare il patch con la revisione appena letta.

Per `TRACKER_BUSY` prescrivere nuova lettura e retry, mai cancellazione manuale di un lock vivo.

In `install-check.md` e `CONTRIBUTING.md` specificare che una copia 1.0 non deve mutare uno storage schema 5: aggiornare il plugin alla 1.1, verificare la copia installata con `node scripts/install-check.mjs` e avviare una nuova sessione prima della prima mutazione.

- [ ] **Step 4: Aggiornare skill, worker e verificatore**

Ogni comando update/delete mostra `--expected-revision` valorizzato con `data.revision` della lettura appena eseguita. Compact conserva le revisioni dal dump usato per la proposta e, dopo conferma umana, rilegge: se una revisione è cambiata annulla la proposta invece di ricostruirla in silenzio. Il verificatore legge la revisione al punto 1 e rilegge prima della chiusura se altri aggiornamenti intermedi sono possibili.

- [ ] **Step 5: Aggiungere il test anti-regressione globale**

Scansionare `skills/`, `agents/` e i prompt prodotti da `harness-worker` affinché nessuna invocazione spedita di update/delete resti senza `--expected-revision` e nessun payload compact usi `issue_ids`.

- [ ] **Step 6: Eseguire test documentali e suite**

Run: `node --test test/plugin-worker.test.mjs test/plugin-agent.test.mjs test/plugin-skill.test.mjs test/plugin-commands.test.mjs`

Expected: PASS.

Run: `npm run test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/harness-worker.mjs agents/harness-verifier.md skills/harness/SKILL.md skills/harness/references/issues.md skills/harness/references/verification.md skills/harness/references/install-check.md skills/issue/SKILL.md skills/compact/SKILL.md CONTRIBUTING.md test/plugin-worker.test.mjs test/plugin-agent.test.mjs test/plugin-skill.test.mjs test/plugin-commands.test.mjs
git commit -m "docs: require revision-aware tracker mutations"
```

### Task 6: Versione 1.1.0 e gate finale

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `.codex-plugin/plugin.json`
- Modify: `test/smoke.test.mjs`

**Interfaces:**
- Consumes: implementazione e documentazione completate nei task precedenti.
- Produces: plugin coerente alla versione `1.1.0` e prova finale dell'intero contratto.

- [ ] **Step 1: Scrivere il test rosso di coerenza versione**

```js
test("all plugin manifests declare the same 1.1.0 release", () => {
  const claude = JSON.parse(readFileSync(path.join(rootDir, ".claude-plugin", "plugin.json")));
  const marketplace = JSON.parse(readFileSync(path.join(rootDir, ".claude-plugin", "marketplace.json")));
  const codex = JSON.parse(readFileSync(path.join(rootDir, ".codex-plugin", "plugin.json")));
  assert.deepEqual([claude.version, marketplace.plugins[0].version, codex.version], ["1.1.0", "1.1.0", "1.1.0"]);
});
```

- [ ] **Step 2: Eseguire il test e confermare il fallimento**

Run: `node --test test/smoke.test.mjs`

Expected: FAIL perché i manifest dichiarano ancora `1.0.0`.

- [ ] **Step 3: Aggiornare insieme i tre manifest**

Cambiare soltanto i tre valori `version` a `1.1.0`, senza introdurre una versione in `package.json`.

- [ ] **Step 4: Eseguire test focalizzati e gate configurato**

Run: `node --test test/smoke.test.mjs test/plugin-tracker-lock.test.mjs test/plugin-issue-store.test.mjs test/plugin-issue-manager.test.mjs test/plugin-worker.test.mjs test/plugin-agent.test.mjs test/plugin-skill.test.mjs test/plugin-commands.test.mjs`

Expected: PASS.

Run: `npm run test`

Expected: PASS, exit code `0`.

- [ ] **Step 5: Controllare scope e chiamanti residui**

Run: `rg -n -- '--update|--delete|--compact|issue_ids' scripts skills agents README.md CONTRIBUTING.md`

Expected: ogni update/delete operativo porta una revisione attesa; `issue_ids` compare soltanto in spiegazioni di incompatibilità o test di rifiuto; status e docs-gate continuano a ignorare la revisione.

Run: `git diff --check`

Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json .codex-plugin/plugin.json test/smoke.test.mjs
git commit -m "chore: prepare harness 1.1.0"
```

### Task 7: Handoff harness alla verifica indipendente

**Files:**
- Modify through CLI only: `.harness/issues/in_progress-3f964bf4.md`

**Interfaces:**
- Consumes: tutti i commit locali prodotti dai task 1-6 e revisione corrente della issue.
- Produces: task di esecuzione allineati, issue `in_review`/`unknown`, nessuna pubblicazione prima del verificatore.

- [ ] **Step 1: Eseguire il gate finale una seconda volta sullo stato da consegnare**

Run: `npm run test`

Expected: PASS, exit code `0`.

- [ ] **Step 2: Allineare i task dell'issue tramite la CLI**

Rileggere `3f964bf4-0c25-4fb1-99d7-1092ccb0138f`, preservare integralmente eventuali avanzamenti concorrenti e spuntare soltanto i task realmente completati. Passare la revisione restituita dalla lettura:

Eseguire `node scripts/issue-manager.mjs --get --issue-id 3f964bf4-0c25-4fb1-99d7-1092ccb0138f`, leggere `data.revision`, preparare con `apply_patch` un payload JSON contenente l'intero array `tasks` allineato e invocare:

```powershell
$env:HARNESS_ROLE='worker'
node scripts/issue-manager.mjs --update --issue-id 3f964bf4-0c25-4fb1-99d7-1092ccb0138f --expected-revision $currentIssueRevision --issue-data-file $alignedPayloadPath
```

Le variabili PowerShell devono essere valorizzate rispettivamente da `data.revision` dell'output precedente e dal path assoluto del payload appena creato; non riusare una lettura antecedente.

- [ ] **Step 3: Portare la issue a in_review senza auto-validazione**

Rileggere ancora, quindi inviare `{"status":"in_review"}` con la nuova revisione attesa. Lasciare `validation.state: "unknown"` e tutti i `validation.tasks` al verificatore.

- [ ] **Step 4: Richiedere un verificatore distinto**

Il verificatore controlla spec precedente al codice, CAS/assenza di scritture, concorrenza, upgrade, i tre manifest e `npm run test`; chiude `done/pass` oppure `blocked/fail`. Non pubblicare o fondere sul ramo condiviso prima del `pass`.
