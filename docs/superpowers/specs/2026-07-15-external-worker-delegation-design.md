# Design — Delega a worker esterni (external-worker delegation)

> Data: 2026-07-15 · Stato: approvato in brainstorming, in attesa di plan.
> Origine: [EXPERIMENT-20260715.md](/EXPERIMENT-20260715.md) (prova su `AllineatoreReitek`).
> Filosofia: **garanzie nel codice, non nella prosa**; costo-contesto zero per i progetti che
> non attivano la feature.

## 1. Problema

L'harness prescrive "avvia un subagent per issue" ma non dice *come* si istanzia. L'esperimento
del 2026-07-15 ha dimostrato che il ruolo di *worker* può essere svolto da una sessione AI in un
terminale separato (`ollama launch claude`, ma anche `codex`, `copilot`, …), lanciata one-shot e
osservata via log. La prova ha però evidenziato tre debiti:

1. La delega esterna non è **attivabile/disattivabile** in modo esplicito: è un pattern ricavato a
   mano ogni volta.
2. I vincoli sul worker (niente commit, niente auto-`pass`) vivono **solo nel prompt**: nessun
   enforcement tecnico, quindi nessuna garanzia contro la self-validation o il commit fuori ordine.
3. Documentare tutto questo dentro `AGENTS-RULES.md` — letto da **ogni** agente a **ogni** sessione
   — farebbe crescere il contesto base anche per i progetti che non useranno mai la feature,
   riducendo l'efficienza dell'harness (finestra di contesto ridotta degli agenti).

## 2. Obiettivi e non-obiettivi

**Obiettivi**
- Rendere la delega esterna **opt-in**, attivabile con un comando.
- Rendere il comando di lancio del worker **configurabile** (ollama / codex / copilot / altri) senza
  toccare codice dell'harness.
- Spostare i vincoli invarianti (no commit, no auto-`pass`) da "disciplina nel prompt" a **garanzie
  tecniche** applicate dal codice.
- Introdurre uno stato `in_review` che renda il passaggio worker→verificatore **esplicito e
  query-abile**.
- **Costo-contesto zero** per i progetti con feature disattivata (doc dedicata, caricata solo
  quando serve).

**Non-obiettivi**
- Non si costruisce un registry di adapter per CLI (ogni nuova CLI richiederebbe una modifica
  all'harness → esattamente il debito di manutenzione/bloat che vogliamo evitare).
- Non si automatizza l'orchestrazione end-to-end del worker: l'orchestratore (agente) resta chi
  costruisce il prompt, lancia il comando, legge il log e avvia la verifica indipendente.
- Non si tocca l'invariante fondamentale: **worker ≠ verificatore ≠ orchestratore**, commit solo
  dopo `pass` del verificatore.

## 3. Panoramica dell'architettura

Sei componenti, tutte autorate in `template/` e propagate alla radice via `npm run dev:sync`:

| # | Componente | File | Tipo |
|---|-----------|------|------|
| A | Toggle + preflight | `init.mjs`, `init.config.json` | codice + config |
| B | Stato `in_review` | `issue-manager.mjs`, `issues.html` | codice |
| C | Role guards | `issue-manager.mjs`, `hooks/pre-commit.mjs` | codice |
| D | Convenzione log | `.gitignore` | config |
| E | Doc gated | `docs/EXTERNAL-WORKER.md`, `docs/AGENTS-RULES.md` (+1 riga) | doc |
| F | Distribuzione / dogfood | `.harness-manifest.json`, `template/*`, `issues.json` | processo |

Il principio unificante: **il costo in contesto vive solo in E**, ed E è gated (caricato solo se la
feature è attiva). Tutto il resto è codice, che non pesa sulla finestra di contesto degli agenti.

## 4. Dettaglio dei componenti

### 4.A — Toggle e preflight (`init.mjs` + `init.config.json`)

`init.config.json` acquisisce un blocco opzionale:

```json
"externalWorker": {
  "enabled": false,
  "command": "ollama launch claude --model gemma4:31b-cloud -- -p {promptFile} --dangerously-skip-permissions",
  "model": "gemma4:31b-cloud"
}
```

- `enabled` (bool) — stato della feature. Default `false` (opt-in).
- `command` (string) — **command template** con placeholder. Placeholder supportati:
  - `{promptFile}` (**obbligatorio**) — path al file che contiene il prompt del worker. Il prompt è
    **sempre file-based**: elimina alla radice l'inferno di quoting a 3 livelli visto nell'esperimento
    (§5.6). Il template stesso non contiene quoting dinamico, solo una sostituzione di path.
  - `{model}` (opzionale) — comodità per non ripetere il modello; può anche essere hardcoded nel
    `command`.
- `model` (string, opzionale) — valore sostituito in `{model}` e usato dal preflight.

`init.mjs` acquisisce un **dispatcher di sottocomandi harness-generici**, valutato *prima* del
percorso task-runner esistente. Tre sottocomandi:

- `node init.mjs worker on` — imposta `externalWorker.enabled = true` in `init.config.json`.
- `node init.mjs worker off` — imposta `externalWorker.enabled = false`.
- `node init.mjs worker check` — **preflight generico e CLI-agnostico**: scrive un file di smoke
  prompt temporaneo (`"Reply exactly READY. Use no tools."`), sostituisce `{promptFile}`, esegue il
  `command` configurato e verifica `exit 0` e/o output contenente `READY`. Funziona per ollama,
  codex, copilot e qualsiasi altra CLI **senza codice per-adapter** (sostituisce il preflight
  ollama-specifico `ollama show` proposto in §6 dell'esperimento).

**Nota di identità:** questo introduce in `init.mjs` sottocomandi oltre al puro task-runner. È
accettabile perché `worker on|off|check` sono **harness-generici** (non specifici di uno stack), in
linea con il ruolo di `init.mjs` come entrypoint di setup/verifica dell'harness. I sottocomandi
vanno intercettati prima della ricerca del task in `config.tasks`, così `setup`/`build` restano
invariati.

`init.mjs` esegue già i comandi con `spawnSync(..., { shell: true })`: il `command` template gira
sullo stesso meccanismo, coerente col resto dello script.

### 4.B — Stato `in_review` (`issue-manager.mjs` + `issues.html`)

Oggi gli stati sono `backlog | in_progress | blocked | done` (`validateStatus`,
`issue-manager.mjs:104`). Si aggiunge `in_review`:

- `validateStatus`: array `validStatuses` += `"in_review"`.
- Aggiornare le **3 stringhe di help/usage** che elencano gli stati (righe ~29, ~251, ~278) e i
  commenti di schema.
- `issues.html`: rendere `in_review` (badge dedicato + filtro nella vista), coerente con gli altri
  stati.

**Semantica:** il worker, completato il lavoro, imposta `status = in_review` e
`validation.state = unknown`. Il verificatore indipendente poi porta a `done`/`pass` oppure
`blocked`/`fail`. Questo rende il passaggio worker→verificatore **esplicito e query-abile**,
sostituendo l'espediente dell'esperimento (`in_progress` + nota nella `criteria`).

### 4.C — Role guards (`issue-manager.mjs` + `hooks/pre-commit.mjs`)

Enforcement tecnico basato sulla variabile d'ambiente `HARNESS_ROLE`:

- **`issue-manager.mjs`** — se `process.env.HARNESS_ROLE === "worker"` e l'update tenta di impostare
  `validation.state = "pass"` **oppure** `status = "done"`, lo script rifiuta con `exit 1` e un
  messaggio/codice d'errore chiaro (es. `FORBIDDEN_ROLE`). La self-validation diventa **impossibile**,
  non solo "vietata a parole". Il worker può impostare al massimo `status = in_review` /
  `validation.state = unknown`.
- **`hooks/pre-commit.mjs`** — se `process.env.HARNESS_ROLE === "worker"`, l'hook **blocca il commit
  in modo assoluto** (`exit 1`, messaggio "i worker non possono committare"). Questo controllo va
  posto **prima** del bypass `HARNESS_DOCS_VERIFIED` (il guard worker non è bypassabile: è un
  invariante più forte del gate documentale).

**Limite noto (dichiarato apertamente):** il guard è efficace solo se l'orchestratore lancia il
worker con `HARNESS_ROLE=worker` **nel suo environment**. Per i worker esterni
(`ollama launch …`, `codex …`, `copilot …`) questo è **scriptabile e affidabile**: la riga di lancio
include la variabile. Per i subagent *interni* l'orchestratore deve ricordarsi di propagare la
variabile, cosa non sempre possibile via tool subagent. Il guard è quindi **strettamente migliore**,
non ermetico: garantisce l'invariante esattamente nel caso che questa feature abilita (worker
esterni), dove il lancio è programmatico.

### 4.D — Convenzione log (`.gitignore`)

Convenzione standard per i log dei worker: `.harness/runs/<issueId>-<timestamp>.log`. Aggiungere
`.harness/runs/` a `.gitignore` (in `template/` e alla radice). Così l'orchestratore sa sempre dove
leggere l'output del worker (risolve l'osservabilità del terminale separato via `tee`) e i temporanei
non finiscono mai in un commit.

### 4.E — Doc gated (`docs/EXTERNAL-WORKER.md` + 1 riga in `AGENTS-RULES.md`)

Questo è il fulcro per il problema del contesto (punto 3).

- Nuova doc **managed** `docs/EXTERNAL-WORKER.md`. Contenuto:
  - pattern di delega one-shot (invocazione, `tee` su `.harness/runs/`, `--issue-data-file` per gli
    update robusti);
  - descrizione dei placeholder (`{promptFile}`, `{model}`) e **3 esempi di `command`**
    (ollama / codex / copilot) da copiare e adattare;
  - ruolo di `HARNESS_ROLE=worker` e cosa i guard impediscono;
  - **template di prompt worker parametrico** (`{issueId}`, `{repoRoot}`) con i vincoli rigidi già
    scritti (no commit, no `pass`/`done`, no file fuori scope, stampa riassunto e fermati);
  - **nota anti-conflitto** con `AGENTS-RULES.md`: quando `externalWorker.enabled`, il "subagent per
    issue" della regola 1-WIP **può** essere un worker esterno; la **verifica indipendente resta un
    agente distinto** (worker ≠ verificatore ≠ orchestratore). Nessuna regola invariante viene
    contraddetta: l'harness non prescrive *come* si istanzia un subagent.
- `docs/AGENTS-RULES.md` acquisisce **una sola riga condizionale**, es.: *"Se
  `externalWorker.enabled` in `init.config.json`, leggi `docs/EXTERNAL-WORKER.md` per il pattern di
  delega a worker esterno."* I progetti con la feature disattivata **non caricano mai** la doc → il
  contesto base non cresce.

### 4.F — Distribuzione e dogfood

Coerente con le regole di sviluppo del repo (`CLAUDE.md`):

- Ogni file managed nuovo/modificato (`init.mjs`, `issue-manager.mjs`, `issues.html`,
  `hooks/pre-commit.mjs`, `docs/AGENTS-RULES.md`, `docs/EXTERNAL-WORKER.md`) va **autorato in
  `template/`**, poi propagato alla radice con `npm run dev:sync`.
- `docs/EXTERNAL-WORKER.md` è un **nuovo file managed**: va registrato nel manifest
  (`.harness-manifest.json`, rigenerato dal tooling dev) con `policy: "managed"`.
- `init.config.json` è **seeded-once**: root e `template/` sono contenuti separati. Il blocco
  `externalWorker` va aggiunto **a entrambi** come skeleton, ma restano file separati (non
  copiare a mano l'uno nell'altro).
- `npm run dev:check` deve uscire **pulito** (zero `updated`, zero `conflicts`) prima di ogni commit.
- **Mai `--force`** alla radice (protegge le issue reali in `issues.json`).
- Il lavoro va tracciato come **issue reali** in `issues.json` alla radice, sviluppate col normale
  workflow (clock-in, verifica indipendente, gate sul commit).

## 5. Flusso d'uso (dopo l'implementazione)

1. `node init.mjs worker on` → attiva la feature.
2. Utente edita `externalWorker.command` con la CLI desiderata (ollama/codex/copilot/…).
3. `node init.mjs worker check` → conferma che il worker risponde (`READY`).
4. L'orchestratore, per una issue: scrive il prompt in un file, lancia
   `<command>` con `HARNESS_ROLE=worker` nell'env, redirige `2>&1 | tee .harness/runs/<id>-<ts>.log`.
5. Il worker sviluppa la issue, aggiorna via `--issue-data-file` a `status=in_review`,
   `validation.state=unknown`. **Non può** impostare `pass`/`done` (guard) né committare (guard).
6. L'orchestratore avvia la **verifica indipendente** (subagent distinto), che esegue
   `node init.mjs build`, e porta la issue a `done`/`pass` o `blocked`/`fail`.
7. Commit dello snapshot per issue **solo dopo** il `pass` del verificatore (gate invariato).

## 6. Rischi e mitigazioni

| Rischio | Mitigazione |
|--------|-------------|
| Guard aggirabile se l'orchestratore non setta `HARNESS_ROLE` | Dichiarato apertamente in E; per i worker esterni il lancio è scriptato → variabile sempre presente. Il template di prompt include comunque i divieti come seconda linea. |
| `init.mjs` cambia identità (task-runner → +sottocomandi) | Sottocomandi harness-generici, non stack-specifici; intercettati prima del task-runner; `setup`/`build` invariati. |
| `command` template malformato / CLI non installata | `worker check` fallisce presto con messaggio chiaro, prima di un run reale. |
| Doc gated dimenticata quando la feature è on | La riga condizionale in `AGENTS-RULES.md` (letta sempre) punta alla doc; il flag guida la lettura. |
| Divergenza root/`template/` (managed) | `dev:check` in pre-commit + CI blocca il commit se root e `template/` divergono. |
| `ANTHROPIC_API_KEY` altera il comportamento della CLI worker | Documentato in `EXTERNAL-WORKER.md` tra le note ambiente (precede il login claude.ai). |

## 7. Criteri di completamento

- `node init.mjs worker on|off` scrive correttamente `externalWorker.enabled`.
- `node init.mjs worker check` valida una CLI accessibile (`READY`/exit 0) e fallisce chiaramente su
  una non accessibile — testato su almeno un `command` reale.
- `issue-manager.mjs` accetta `in_review` e **rifiuta** `pass`/`done` con `HARNESS_ROLE=worker`.
- `hooks/pre-commit.mjs` **blocca** il commit con `HARNESS_ROLE=worker`, prima del bypass docs.
- `issues.html` mostra e filtra `in_review`.
- `docs/EXTERNAL-WORKER.md` esiste, è managed nel manifest, e `AGENTS-RULES.md` ha la riga
  condizionale; i progetti con flag off non la caricano.
- `.harness/runs/` è in `.gitignore`.
- `npm run dev:check` esce pulito; feature completa dogfoodata su questo repo.

## 8. Riepilogo delle decisioni di brainstorming

- **Framing:** code-first, docs-thin — garanzie nel codice, prosa minima (possibile net-shrink).
- **Toggle:** CLI verb `node init.mjs worker on|off` che scrive il flag in `init.config.json`.
- **Enforcement:** tutti e quattro i guard — role guard in `issue-manager`, role guard in
  `pre-commit`, preflight modello (reso generico via `worker check`), convenzione log.
- **Stato `in_review`:** incluso, con rendering in `issues.html`.
- **Doc:** doc separata gated + 1 riga condizionale in `AGENTS-RULES.md` (costo-contesto zero se off).
- **Config comando:** command template string con `{promptFile}` file-based (+ `{model}` opzionale),
  nessun adapter registry.
