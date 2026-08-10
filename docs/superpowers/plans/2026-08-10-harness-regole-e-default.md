# Regole e default di harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare in harness tre regole che il primo consumer esterno ha dovuto riscoprire da sé — quando un lavoro diventa una issue, che un criterio deve stare nella portata di chi lo verifica, e che il board non è un passo obbligatorio del clock-in.

**Architecture:** Modifica **solo documentale**. Si toccano `skills/harness/SKILL.md` e tre file in `skills/harness/references/`. Nessuno script, nessun campo di schema, nessun comando. Ogni cambiamento è preceduto da un'asserzione di contenuto in `test/plugin-skill.test.mjs`, che è il modo in cui questo repository prova già la propria documentazione.

**Tech Stack:** Markdown; Node.js `node:test` + `node:assert/strict` per le asserzioni strutturali; `npm run test` come gate.

## Global Constraints

- **Doc-only.** Nessun file sotto `scripts/`, `commands/` o `agents/` viene toccato. Se un passo sembra chiederlo, il passo è sbagliato.
- **La spec di riferimento è** `docs/superpowers/specs/2026-08-10-harness-regole-e-default-design.md`. In caso di divergenza fra questo piano e la spec, vince la spec.
- **Lingua italiana**, registro dei file circostanti. Le righe si mandano a capo intorno a **95 colonne**, come i paragrafi vicini. **Non riformattare i paragrafi che non stai modificando**: un reflow di massa rende il diff illeggibile e nasconde la modifica vera.
- **Line ending preservati.** Il repository ha un `.gitattributes`; non convertire i fine riga di un file che stai modificando.
- **Workflow harness su sé stesso** (`CLAUDE.md`): questo repository è il primo consumer di harness. Ogni task **finisce a `in_review`, non con un commit**. Il commit avviene solo dopo il `pass` del verificatore indipendente, un commit per issue.
- **`issues.json` non si modifica a mano**, mai, nemmeno un campo: si passa sempre da `node scripts/issue-manager.mjs`.
- **Lavorando inline** il ruolo va dichiarato: `$env:HARNESS_ROLE='worker'; node ...` su PowerShell, `HARNESS_ROLE=worker node ...` in bash.
- **Il gate è `npm run test`** e dev'essere verde alla fine di ogni task.

## File Structure

| File | Cosa cambia | Task |
|---|---|---|
| `test/plugin-skill.test.mjs` | tre test nuovi, uno per deliverable. Nessun test esistente viene modificato | 1, 2, 3 |
| `skills/harness/SKILL.md` | premessa riscritta, capitolo nuovo `Cosa diventa una issue`, raccordo in `Verifica leggera` | 1 |
| `skills/harness/SKILL.md` | `Clock in` perde il passo del board e si rinumera; `Clock out` diventa condizionale | 3 |
| `skills/harness/references/issues.md` | una regola in più fra quelle che la CLI non può misurare | 2 |
| `skills/harness/references/verification.md` | capitolo nuovo sulle prove fuori portata | 2 |
| `skills/harness/references/board.md` | ciclo di vita corretto, sezione nuova che motiva il default | 3 |

**Perché i test stanno tutti nello stesso file:** `test/plugin-skill.test.mjs` è già il file che asserisce sul contenuto della skill e delle sue reference — ha un test che verifica che nessun documento rimandi ai macchinari rimossi in v1. Le asserzioni nuove sono la stessa specie e non giustificano un file nuovo.

**Task 1 e Task 3 toccano entrambi `SKILL.md`.** Vanno in sequenza, mai in parallelo: sono la stessa catena di dipendenza. Task 2 non tocca `SKILL.md` e può procedere in parallelo.

---

### Task 1: La bussola — cosa diventa una issue

**Files:**
- Modify: `test/plugin-skill.test.mjs` (aggiungere un test in fondo)
- Modify: `skills/harness/SKILL.md:8-10` (premessa), fra `:175` e `:177` (capitolo nuovo), `:177-181` (raccordo)

**Interfaces:**
- Consumes: niente da task precedenti.
- Produces: il capitolo `## Cosa diventa una issue` in `SKILL.md`, collocato **fra** `## Tier: quanto costa il lavoro di una issue` e `## Verifica leggera: issue che nascono senza criteri`. Task 3 non lo tocca ma non deve spostarlo.

- [ ] **Step 1: Scrivere il test che fallisce**

In fondo a `test/plugin-skill.test.mjs`, aggiungere:

```javascript
test("the skill says which work becomes an issue at all", () => {
  const content = readSkill();

  assert.match(
    content,
    /^## Cosa diventa una issue$/m,
    "the compass needs its own chapter: a rule folded into another one is a rule nobody finds"
  );
  assert.match(
    content,
    /costoso e invisibile/,
    "the compass must state both halves; either one alone opens issues that are not worth an agent"
  );

  // The old premise contradicted the compass outright, and a reader who stops at the opening
  // paragraph would follow the premise.
  assert.ok(
    !content.includes("ogni pezzo di lavoro è una issue tracciata"),
    "the opening still claims every piece of work is an issue"
  );

  // Order matters: "does this enter the tracker" comes before "how much ceremony does it get".
  const compass = content.indexOf("## Cosa diventa una issue");
  const light = content.indexOf("## Verifica leggera");
  assert.ok(
    compass < light,
    "the compass must precede the light-verification chapter, which presupposes an issue already decided"
  );
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `node --test test/plugin-skill.test.mjs`
Expected: FAIL su `the compass needs its own chapter` — il capitolo non esiste ancora.

- [ ] **Step 3: Riscrivere la premessa**

In `skills/harness/SKILL.md`, sostituire il paragrafo alle righe 8-10:

```markdown
Harness impone un modo di lavorare, non una libreria: ogni pezzo di lavoro è una issue
tracciata, ogni issue viene verificata da un agente **diverso** da chi l'ha svolta, e si
committa solo dopo quella verifica.
```

con:

```markdown
Harness impone un modo di lavorare, non una libreria: il lavoro che vale la pena far guardare a
qualcun altro è una issue tracciata — quale sia, lo dice il capitolo «Cosa diventa una issue» —,
ogni issue viene verificata da un agente **diverso** da chi l'ha svolta, e si committa solo dopo
quella verifica.
```

Le altre due clausole non si toccano: sono invarianti, questa non lo era mai stata.

- [ ] **Step 4: Inserire il capitolo nuovo**

In `skills/harness/SKILL.md`, fra la fine del capitolo `## Tier` (riga 175, l'ultimo paragrafo che comincia con «Il tier è un **hint**») e l'inizio di `## Verifica leggera` (riga 177), inserire:

```markdown
## Cosa diventa una issue

Non tutto il lavoro è una issue. La domanda è una sola:

> Se qui venisse commesso un errore, sarebbe **costoso e invisibile**?

Servono entrambe le cose. Un errore costoso ma **rumoroso** non ha bisogno di uno sguardo
indipendente: il comando `verify` lo urla al primo tentativo. Un errore invisibile ma innocuo non
vale il prezzo. È l'intersezione a giustificare una issue.

**Il prezzo, detto in numeri.** Una issue è un giro di verificatore, cioè un agente intero. È
l'unità di costo di harness, ed è ciò che rende la domanda decidibile invece che filosofica: una
issue per ogni passo di un piano vuol dire che il controllo costa più della cosa controllata, e
si vede contando gli agenti.

**Sotto il tracker c'è un livello a grana fine**, fatto di passi da pochi minuti, ognuno con la
propria verifica svolta *inline dallo stesso agente che lavora* — e che costa quasi niente
proprio perché non cambia agente. Harness **non prescrive come lo produci**: un piano scritto,
una lista di todo, o niente di scritto. Prescrive una cosa sola, che il tracker non è quel
livello e non deve inseguirlo. La corrispondenza fra issue e passi non è uno a uno, e non deve
esserlo.

**Per il lavoro che emerge a metà**, nell'ordine:

1. rientra in qualcosa di già previsto → è un passo in più lì dentro, nessuna issue;
2. è nuovo, ma il suo errore sarebbe **rumoroso** → è un passo nuovo, nessuna issue;
3. il suo errore sarebbe **costoso e invisibile** → è una issue, **e serve un criterio eseguibile
   che renda visibile il fallimento**. Se non riesci a scriverlo, il problema non è la issue: è
   che non sai ancora come si riconosce il fallimento, e va capito prima;
4. cambia una decisione già presa e scritta → prima il documento, poi la issue.

Il punto 3 è il più utile dei quattro, perché trasforma un giudizio in una prova di scrittura: la
bussola chiede di stimare quanto un errore sarebbe invisibile, il criterio chiede di renderlo
visibile. Se il secondo non si scrive, la stima era ottimistica.

**Cosa questa regola non dice.** Non dice quanto lavoro sta dentro una issue. Una issue larga è
una finestra più larga fra due verifiche: se il tratto va storto a metà, se ne accorge il
verificatore alla fine e non prima. È un rischio che si accetta guardandolo — mitigato dalle
verifiche del livello sotto, che restano — non un difetto da correggere spezzettando, che
riporterebbe a una issue per passo.
```

- [ ] **Step 5: Aggiungere il raccordo in «Verifica leggera»**

Sempre in `skills/harness/SKILL.md`, subito **sotto** il titolo `## Verifica leggera: issue che nascono senza criteri` e **sopra** il paragrafo che comincia con «Su una issue banale i criteri di accettazione sono rumore», inserire una riga:

```markdown
Quanto segue si applica **dopo** che la bussola qui sopra ha detto sì: sono issue vere, che
meritavano di entrare nel tracker.
```

- [ ] **Step 6: Lanciare la suite intera**

Run: `npm run test`
Expected: PASS. In particolare devono restare verdi i test esistenti `every reference link in SKILL.md resolves to a file that exists` e `every reference file is reachable from SKILL.md` — il capitolo nuovo non aggiunge né rimuove link a reference.

- [ ] **Step 7: Portare la issue a `in_review` — nessun commit**

```powershell
$env:HARNESS_ROLE='worker'
node "${env:CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id-bussola> --issue-data '{"status":"in_review","validation":{"criteria":"<cosa è stato fatto e con quale esito>","state":"unknown"}}'
```

Poi fermarsi. La chiusura spetta all'agent `harness-verifier`, e il commit avviene **solo** dopo il suo `pass`.

---

### Task 2: Il criterio deve stare nella portata del verificatore

**Files:**
- Modify: `test/plugin-skill.test.mjs` (aggiungere un test in fondo)
- Modify: `skills/harness/references/issues.md:346-354` (blocco «Regole che la CLI non può misurare»)
- Modify: `skills/harness/references/verification.md` (capitolo nuovo dopo `## Cosa rende una verifica reale`)

**Interfaces:**
- Consumes: niente. Non tocca `SKILL.md`, quindi è una catena indipendente da Task 1 e Task 3.
- Produces: il capitolo `## Quando la prova sta fuori dalla portata dell'agent` in `verification.md`, a cui `issues.md` rimanda con un link relativo `verification.md`.

- [ ] **Step 1: Scrivere il test che fallisce**

In fondo a `test/plugin-skill.test.mjs`, aggiungere:

```javascript
test("a criterion must be checkable with the verifier's own access", () => {
  const issues = readFileSync(path.join(referencesDir, "issues.md"), "utf8");
  const verification = readFileSync(path.join(referencesDir, "verification.md"), "utf8");

  // "verifiable by another agent" was never the whole rule: that agent has the worker's
  // environment and nothing more.
  assert.match(
    issues,
    /accessi che il verificatore ha/,
    "issues.md must tie a criterion's verifiability to the verifier's access, not only to its wording"
  );

  assert.match(
    verification,
    /^## Quando la prova sta fuori dalla portata dell'agent$/m,
    "verification.md must say what happens when the proof cannot be collected at all"
  );

  // All four are mandatory: dropping "what we proceed on meanwhile" is what turns a request
  // into a stall, and dropping "why not from here" is what turns it into lazy delegation.
  for (const voice of [
    "Cosa lanciare",
    "Cosa serve indietro",
    "Su cosa si prosegue intanto",
    "Perché non si può fare da qui",
  ]) {
    assert.ok(
      verification.includes(voice),
      `the out-of-reach request must ask "${voice}"`
    );
  }

  // The escape hatch exists, and its whole point is who holds the pen.
  assert.match(
    verification,
    /firma il committente/,
    "verification.md must say the reformulation is signed by the committente, never by the worker"
  );
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `node --test test/plugin-skill.test.mjs`
Expected: FAIL su `issues.md must tie a criterion's verifiability to the verifier's access`.

- [ ] **Step 3: Aggiungere la regola in `issues.md`**

In `skills/harness/references/issues.md`, nel blocco «Regole che la CLI non può misurare», **subito dopo** il bullet esistente:

```markdown
- ogni criterio è una cosa verificabile da un altro agente che non ha visto la conversazione:
  "funziona bene" non lo è, "il comando X esce 0 e stampa Y" sì;
```

inserire:

```markdown
- e dev'essere controllabile **con gli accessi che il verificatore ha**: il suo ambiente è quello
  del worker, non di più. Un criterio che chiede di guardare un server irraggiungibile, una
  console web o un ambiente in linea non è verificabile — ed è un criterio scritto male, non un
  verificatore limitato. Si riformula su un artefatto che entra nel repository:
  [verification.md](verification.md);
```

- [ ] **Step 4: Aggiungere il capitolo in `verification.md`**

In `skills/harness/references/verification.md`, fra la fine di `## Cosa rende una verifica reale` (riga 74) e l'inizio di `## Perché non c'è più un hook` (riga 76), inserire:

```markdown
## Quando la prova sta fuori dalla portata dell'agent

**Quando scatta.** La prova è *impossibile* da raccogliere dall'ambiente di lavoro — non
soltanto scomoda. Se è scomoda, si fa. La distinzione va tenuta ferma: è l'unica cosa che
impedisce a questa regola di diventare una scorciatoia per delegare a una persona lavoro che
l'agente poteva svolgere.

**In scrittura: il criterio nomina l'artefatto, non l'azione.** Non «il job X esce verde», ma
«esiste `<path>` con esito verde su …, per la revisione `<sha>`». Chi verifica legge un file che
ha già in mano, e non gli serve nessun accesso che non ha.

Harness non prescrive né il formato dell'artefatto né la cartella dove vive: quelle le decide il
progetto. Prescrive tre proprietà:

| proprietà | perché |
|---|---|
| **committato** | un artefatto fuori dal repository non è raggiungibile dal verificatore più della cosa che sostituisce |
| **dichiara su quale revisione è stato misurato** | una misura fatta altrove misura ciò che era stato spinto, non ciò che sta nel working tree; senza la revisione l'artefatto non dice se ha misurato la cosa che si crede |
| **porta le righe decisive verbatim, più un puntatore alla fonte** | il log intero è rumore, ma senza le righe e senza la fonte l'artefatto è il racconto di qualcuno |

**La richiesta a chi può eseguirla ha quattro voci, tutte obbligatorie:**

1. **Cosa lanciare** — comandi esatti e copiabili, o nome del job e parametri.
2. **Cosa serve indietro** — quale output, e quanto: tutto, o da un certo punto in poi.
3. **Su cosa si prosegue intanto** — l'assunzione con cui il lavoro continua mentre la risposta
   non c'è, scritta, così che un esito contrario dica subito che cosa cade.
4. **Perché non si può fare da qui** — una riga. Se non è scrivibile, la richiesta non va fatta:
   significa che era eseguibile senza disturbare nessuno.

**Il lavoro non si ferma ad aspettare.** Si chiede appena la necessità è nota e si prosegue su
tutto ciò che non ne dipende. L'eccezione è una sola: quando l'assunzione è così portante che
proseguire significherebbe rifare tutto in caso di esito contrario.

**La valvola, per i criteri fuori portata già scritti.** La regola qui sopra previene; questa
gestisce i casi in cui non ha funzionato.

- Il worker dichiara l'impossibilità e si ferma. **Non riformula il criterio.**
- Il verificatore **blocca** la issue. È la condotta giusta, non un incidente: un verificatore
  che passa oltre un criterio che non ha potuto controllare è un verificatore che non serve.
- La riformulazione la **firma il committente**, mai il worker a cui gioverebbe, e la firma resta
  nella `description` della issue.

È l'**eccezione disciplinata** al divieto — scritto in [SKILL.md](../SKILL.md) — di declassare a
posteriori i criteri, non una contraddizione: stessa logica e stesso motivo, cioè che chi trae
vantaggio da un criterio più debole non è chi può indebolirlo. Cambia solo chi tiene la penna.
```

- [ ] **Step 5: Lanciare la suite intera**

Run: `npm run test`
Expected: PASS. In particolare `cross-links between reference files resolve too` deve restare verde: il link `[verification.md](verification.md)` aggiunto in `issues.md` punta a un file che esiste.

- [ ] **Step 6: Portare la issue a `in_review` — nessun commit**

```powershell
$env:HARNESS_ROLE='worker'
node "${env:CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id-portata> --issue-data '{"status":"in_review","validation":{"criteria":"<cosa è stato fatto e con quale esito>","state":"unknown"}}'
```

---

### Task 3: Il board esce dal clock-in

**Files:**
- Modify: `test/plugin-skill.test.mjs` (aggiungere un test in fondo)
- Modify: `skills/harness/SKILL.md:29-31` (passo 4 di `Clock in`), `:32-41` (rinumerazione), `:245-248` (`Clock out`)
- Modify: `skills/harness/references/board.md:52-53` e `:64` (ciclo di vita), più una sezione nuova

**Interfaces:**
- Consumes: `SKILL.md` come lasciato da Task 1. **Non iniziare finché Task 1 non è chiuso**: toccano lo stesso file.
- Produces: un `Clock in` a cinque passi invece di sei.

- [ ] **Step 1: Scrivere il test che fallisce**

In fondo a `test/plugin-skill.test.mjs`, aggiungere:

```javascript
test("the board is a tool you ask for, not a clock-in step", () => {
  const content = readSkill();
  const board = readFileSync(path.join(referencesDir, "board.md"), "utf8");

  // Slice out the clock-in chapter and assert the board is not in it. Grepping the whole
  // skill would match the reference index at the bottom, which must keep linking board.md.
  const start = content.indexOf("## Clock in");
  const end = content.indexOf("## Regola 1-WIP");
  assert.ok(start !== -1 && end > start, "the Clock in chapter moved: fix this test, not the skill");
  const clockIn = content.slice(start, end);

  assert.ok(
    !/board/i.test(clockIn),
    "clock-in still starts the board: the only consumer that ran it forbade it in writing"
  );
  assert.match(
    clockIn,
    /status-cli\.mjs/,
    "the tracker summary must stay the clock-in step that survives"
  );

  assert.ok(
    !board.includes("al clock-in, automaticamente"),
    "board.md still declares an automatic start"
  );
  assert.match(
    board,
    /^## Perché non parte da solo$/m,
    "board.md must record why the default changed, or it will be changed back"
  );
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `node --test test/plugin-skill.test.mjs`
Expected: FAIL su `clock-in still starts the board`.

- [ ] **Step 3: Togliere il passo 4 da `Clock in` e rinumerare**

In `skills/harness/SKILL.md`, eliminare interamente il passo 4:

```markdown
4. **Board** — avvia il board delle issue e stampa l'URL una volta sola (vedi
   [references/board.md](references/board.md)). Non aprire il browser da solo.
```

e rinumerare i due passi successivi: `5. **Stato del tracker**` diventa `4.`, `6. **Scelta del lavoro**` diventa `5.`.

Il passo dello stato del tracker guadagna una frase finale, che ne spiega il perché ora che è l'unico:

```markdown
   È l'unico passo di visibilità del clock-in: è testo, sta nella sessione, e non dipende da un
   processo che deve sopravvivere fra un turno e l'altro.
```

**Attenzione:** il capitolo `## Reference` in fondo alla skill continua a linkare `references/board.md`. Non toccarlo — il test esistente `every reference file is reachable from SKILL.md` fallirebbe.

- [ ] **Step 4: Rendere condizionale il `Clock out`**

In `skills/harness/SKILL.md`, capitolo `## Clock out`, sostituire:

```markdown
Per ogni issue lavorata: lavoro concluso → `in_review` → verifica indipendente → `pass` →
commit dedicato. Poi ferma il board server avviato al clock-in.
```

con:

```markdown
Per ogni issue lavorata: lavoro concluso → `in_review` → verifica indipendente → `pass` →
commit dedicato. Se durante la sessione hai avviato il board, fermalo adesso col `pid` della
riga di avvio.
```

- [ ] **Step 5: Correggere il ciclo di vita in `board.md`**

In `skills/harness/references/board.md`, capitolo `## Ciclo di vita`, sostituire la riga 52-53:

```markdown
- **Avvio** — al clock-in, automaticamente. Il server ascolta su `127.0.0.1` su una porta
  libera scelta a runtime.
```

con:

```markdown
- **Avvio** — **su richiesta, mai di iniziativa propria** (vedi «Perché non parte da solo» più
  sotto). Il server ascolta su `127.0.0.1` su una porta libera scelta a runtime.
```

e la riga 64:

```markdown
- **Stop** — al clock-out. Non lasciare processi orfani a fine sessione.
```

con:

```markdown
- **Stop** — a fine sessione, se l'hai avviato. Non lasciare processi orfani.
```

- [ ] **Step 6: Aggiungere la sezione che motiva il default**

Sempre in `skills/harness/references/board.md`, **subito prima** di `## Cosa non fa` (riga 104), inserire:

```markdown
## Perché non parte da solo

Fino al 2026-08-10 il clock-in prescriveva di avviarlo. Il primo progetto che ha usato harness
per un lavoro lungo ha fatto l'opposto, per iscritto, e con una misura.

In una sessione il processo del board è morto **tre volte** — dopo circa 50, 25 e 16 minuti.
Durate diverse, quindi non un timeout da configurare. Ogni volta ha lasciato in piedi un URL
annunciato come attivo e già morto. In una sessione successiva ha retto 55 minuti, fermato
deliberatamente al clock-out: **l'instabilità non è sistematica**, il che è la cosa peggiore,
perché non se ne può diffidare sempre.

Da cui le due regole che restano:

- **non avviarlo di iniziativa propria.** Se qualcuno lo chiede, avvialo e dillo.
- **non annunciare come attivo un URL che non sai vivo.** Un URL morto spacciato per vivo è
  peggio di nessun board: manda a sbattere chi si fida.

Il riepilogo testuale (`status-cli.mjs`, [status.md](status.md)) resta la fonte che non dipende
da nessun processo, ed è per questo che è lui, e non il board, il passo del clock-in.
```

- [ ] **Step 7: Lanciare la suite intera**

Run: `npm run test`
Expected: PASS. Controllare in particolare che `every reference file is reachable from SKILL.md` sia verde — `board.md` dev'essere ancora linkato dal capitolo `## Reference`.

- [ ] **Step 8: Portare la issue a `in_review` — nessun commit**

```powershell
$env:HARNESS_ROLE='worker'
node "${env:CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id-board> --issue-data '{"status":"in_review","validation":{"criteria":"<cosa è stato fatto e con quale esito>","state":"unknown"}}'
```

---

## Dopo i tre task

Ogni issue passa dall'agent `harness-verifier`, che la chiude `done`/`pass` oppure `blocked`/`fail`. **Solo dopo il `pass`** si committa, una issue alla volta.

Il gate documentale di questo repository non scatta su questi commit: `docsGate.exclude` contiene `**/*.md`, e questa è una modifica interamente markdown. È il comportamento voluto, non una svista da correggere.

## Self-review

**Copertura della spec.** §1.1 premessa → Task 1 Step 3. §1.2 collocazione → Task 1 Step 4 più l'asserzione d'ordine nel test. §1.3 contenuto → Task 1 Step 4. §1.4 raccordo → Task 1 Step 5. §2.1 regola in `issues.md` → Task 2 Step 3. §2.2 capitolo in `verification.md`, tre proprietà, quattro voci, valvola → Task 2 Step 4. §3 board → Task 3 Steps 3-6. §5 «come si verifica» → i tre test più `npm run test` a ogni task.

**Nessun placeholder:** ogni passo che modifica un file porta il testo esatto, vecchio e nuovo. Gli unici segnaposto sono `<id-bussola>`, `<id-portata>`, `<id-board>`, che sono gli id delle issue e si leggono dal tracker.

**Coerenza dei nomi:** il capitolo si chiama `Cosa diventa una issue` nel test (Task 1 Step 1), nella premessa (Step 3), nel titolo inserito (Step 4) e nel raccordo (Step 5). Il capitolo di `verification.md` si chiama `Quando la prova sta fuori dalla portata dell'agent` sia nel test sia nell'inserimento. La sezione di `board.md` si chiama `Perché non parte da solo` nel test, nel rimando del ciclo di vita e nel titolo.
