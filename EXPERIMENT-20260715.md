# EXPERIMENT-20260715 — Worker esterno via `ollama launch claude`

> Documento di esperimento. **Non** è una regola dell'harness: raccoglie in dettaglio una
> prova fatta il 2026-07-15 sul progetto consumer `AllineatoreReitek`, così da usarla come
> spunto per migliorare la libreria harness principale (`herness`) da cui derivano i
> template `AGENTS.md`, `AGENTS-RULES.md`, `init.mjs`, `issue-manager.mjs`, hook, ecc.

## 1. Obiettivo

Verificare se il ruolo di **subagent worker** previsto dall'harness
(`AGENTS-RULES.md` → "Avvia un subagent per issue") può essere svolto da una **sessione AI
in un terminale completamente separato**, lanciata con:

```
ollama launch claude --model minimax-m2.7:cloud
```

invece che dal tool subagent interno dell'agente orchestratore. Alla sessione esterna deve
essere passato un comando **atomico e chiaro** che le permetta di:

1. sviluppare una singola issue,
2. aggiornarne lo stato tramite `issue-manager.mjs`,

il tutto **rispettando gli invarianti** dell'harness (regola 1-WIP, verifica indipendente,
gate sul commit, nessuna auto-validazione).

## 2. Ambiente della prova

| Componente | Stato rilevato |
|------------|----------------|
| OS | Windows (PowerShell) |
| Repo consumer | `AllineatoreReitek` (.NET 10, console app) |
| `ollama` | Installato (`…\Programs\Ollama\ollama.exe`) |
| Integrazione Claude | `ollama launch claude` → Claude Code CLI **v2.1.210** già installato in `~\.local\bin\claude.exe` |
| Signin ollama | Attivo (modelli `*-cloud` risolvibili) |
| Modello richiesto | `minimax-m2.7:cloud` — metadati leggibili (`ollama show`), ma **inference bloccata da 403 subscription** |
| Modello usato | `gemma4:31b-cloud` (accessibile, capabilities: completion, tools, thinking) |

`ollama launch` supporta le integrazioni (`claude`, `chatgpt`, `copilot`, `codex`, …) e
inoltra gli argomenti dopo `--` alla CLI sottostante. Claude Code accetta `-p "<prompt>"`
(print/non-interattivo) → l'intera catena diventa **scriptabile**.

## 3. Meccanismo validato

### 3.1 Invocazione non-interattiva + cattura output

```powershell
ollama launch claude --model gemma4:31b-cloud -- -p "<PROMPT>" --dangerously-skip-permissions `
  2>&1 | Tee-Object -FilePath external-run.log
```

Punti chiave:

- `--` separa i flag di `ollama` dagli argomenti passati a Claude Code.
- `-p "<PROMPT>"` = print mode: la sessione esegue e **termina da sola** (niente REPL da
  osservare a mano).
- `--dangerously-skip-permissions`: **necessario** perché in print mode non esistono prompt
  di conferma interattivi; senza, il worker non può applicare edit né eseguire comandi Bash
  (es. `issue-manager.mjs`).
- `Tee-Object` (alias `tee`) scrive su file **e** su stdout → l'orchestratore che ha
  lanciato il processo può **rileggere il log** (`external-run.log`), risolvendo il problema
  dell'osservabilità di un terminale "separato".

### 3.2 Smoke test (no-op)

Prompt: *"Reply with exactly the word READY … Do not read/create/modify any file."*

- Con `minimax-m2.7:cloud` → `Failed to authenticate. API Error: 403 this model requires a
  subscription, upgrade for access`.
- Con `gemma4:31b-cloud` → output `READY`, exit code `0`. **Plumbing confermato.**

Warning ricorrente (non bloccante): *"claude.ai connectors are disabled because
`ANTHROPIC_API_KEY` or another auth source is set and takes precedence over your claude.ai
login"*. La variabile `ANTHROPIC_API_KEY` presente nell'ambiente ha precedenza sul login
claude.ai; non impedisce il flusso ollama-backed.

### 3.3 Run reale su issue

Issue target: `807429be-5423-435b-959e-04f02b592a51` —
*"docs(ARCHITECTURE): correggere il comando di testing inesistente in §4"* (la più atomica:
una riga). Nel file `docs/ARCHITECTURE.md` §4 era citato `\.init.ps1 quick-check`, comando
inesistente; andava sostituito con il flusso reale `node init.mjs setup` / `node init.mjs
build` (`dotnet build` + `dotnet test --no-build`).

**Prompt passato al worker** (sintesi, one-shot):

1. Ispeziona la issue con `node issue-manager.mjs --get --issue-id <guid>`.
2. Modifica **solo** l'ultima riga di §4 di `docs/ARCHITECTURE.md` col flusso reale.
3. Crea `worker-issue-update.json` con un JSON esatto (`status: in_progress`,
   `validation.state: unknown`, criteria = "lavoro completo, IN ATTESA DI VERIFICA
   INDIPENDENTE") — **file-based** per evitare l'inferno del quoting a 3 livelli
   (PowerShell → arg claude → shell del tool Bash).
4. Applica l'update con `node issue-manager.mjs --update --issue-id <guid> --issue-data-file
   worker-issue-update.json`.
5. **Vincoli rigidi**: niente `git commit`/`git add`; **non** impostare `state: pass` né
   `status: done`; non toccare altri file; stampare un riassunto e fermarsi.

**Risultato osservato (verificato dall'orchestratore, non fidandosi del self-report):**

- `git diff docs/ARCHITECTURE.md`: modificata **solo** la riga attesa. ✔
- Issue: `status=in_progress`, `validation.state=unknown`, criteria aggiornata "IN ATTESA DI
  VERIFICA INDIPENDENTE". ✔ (nessun auto-`pass`)
- `git log`: HEAD invariato → **nessun commit** creato dal worker. ✔
- File toccati: `docs/ARCHITECTURE.md`, `issues.json`, `worker-issue-update.json` — nessuna
  modifica fuori scope. ✔

### 3.4 Verifica indipendente + commit

Un **subagent dedicato distinto** (né worker né orchestratore) ha:

- riletto i `validation.criteria`,
- ispezionato il diff,
- eseguito il gate `node init.mjs build` → `dotnet build` OK (0 errori) + `dotnet test
  --no-build` → **96 test passati**,
- aggiornato la issue a `status=done`, `validation.state=pass` con evidenza.

Poi l'orchestratore ha ripulito gli artefatti temporanei (`external-run.log`,
`worker-issue-update.json`, `verify-update.json`) e ha committato lo snapshot della singola
issue. Il **pre-commit hook** (`hooks/pre-commit.mjs`) è scattato come previsto; valutato che
la modifica era essa stessa documentale e senza nuove funzionalità → nessuna issue docs
aggiuntiva → ricommit con `HARNESS_DOCS_VERIFIED=1`. Commit finale: `bf3c9b7`.

## 4. Conformità agli invarianti dell'harness

| Invariante (`AGENTS-RULES.md`) | Esito |
|-------------------------------|-------|
| Un subagent per issue | ✔ worker esterno = subagent |
| 1-WIP per catena di dipendenza | ✔ una sola issue lavorata |
| Verifica **indipendente** (mai auto-verifica) | ✔ worker ≠ verificatore ≠ orchestratore |
| Nessun `pass` auto-assegnato da chi fa il lavoro | ✔ worker lascia `state=unknown` |
| Commit **solo** dopo `pass` del verificatore | ✔ commit dopo il `pass` |
| Gate documentale pre-commit hook | ✔ valutato e bypass consapevole |

**Conclusione:** il modello "worker in terminale separato" è **compatibile** con l'harness,
a patto che il ruolo di *worker* e quello di *verifica indipendente* restino su agenti
distinti. L'harness non prescrive *come* si istanzia un subagent, quindi non c'è conflitto.

## 5. Rischi e limiti emersi

1. **Osservabilità.** Un terminale davvero separato/interattivo non è ispezionabile
   dall'orchestratore. Mitigazione obbligatoria: **one-shot `-p` + `tee` su file**. La
   modalità interattiva detached è sconsigliata (nessun feedback programmatico).
2. **Permessi.** `--dangerously-skip-permissions` è di fatto necessario per far editare/
   eseguire il worker in print mode: superficie di rischio ampia, contenuta **solo** dal
   prompt (vincoli "no commit", "no file fuori scope"). Non c'è enforcement tecnico.
3. **Concorrenza / 1-WIP.** Un worker autonomo che potesse committare in parallelo
   violerebbe l'ordine per catena. In questa prova il rischio è stato annullato negando il
   commit al worker.
4. **Self-validation.** Se il worker impostasse `pass`/`done` da solo, romperebbe
   l'invariante. Va vietato esplicitamente nel prompt (fatto), ma niente lo impedisce
   tecnicamente.
5. **Modello a pagamento.** `minimax-m2.7:cloud` → 403 subscription. La scelta del modello
   worker non è garantita: serve un fallback e un check di accessibilità *prima* del run.
6. **Quoting.** Passare JSON inline attraverso 3 livelli di shell è fragile. Il pattern
   **file-based** (`--issue-data-file`) è l'unico robusto.
7. **Costo/produttività.** Per un fix di una riga, orchestrare un worker esterno è più
   pesante del farlo inline. Il valore è il *meccanismo* (deleghe pesanti/parallele), non i
   task banali.
8. **Env leakage.** `ANTHROPIC_API_KEY` nell'ambiente altera il comportamento della CLI
   (precede il login claude.ai). Va gestita/documentata.

## 6. Spunti di miglioria per la libreria harness (`herness`)

Proposte concrete, ordinate per valore/sforzo:

1. **Documentare un "external worker adapter".** Aggiungere in `docs/` (o come sezione di
   `AGENTS-RULES.md`) un pattern ufficiale per delegare una issue a un worker esterno:
   invocazione one-shot, `tee` su log, `--issue-data-file`, divieti espliciti (no commit,
   no `pass`). Rende ripetibile ciò che qui è stato ricavato a mano.
2. **Template di prompt worker.** Fornire in `template/` un prompt parametrico
   (`{issueId}`, `{repoRoot}`) con i vincoli rigidi già scritti, per non riscriverli ogni
   volta e ridurre il rischio di dimenticare "no self-pass".
3. **Preflight di accessibilità modello.** Uno step (in `init.mjs` o script dedicato) che
   verifichi signin + accessibilità del modello worker (`ollama show` **e** un ping di
   inference) prima di lanciare il run, con fallback configurabile. Eviterebbe il 403 a
   metà flusso.
4. **Enforcement tecnico del gate, non solo prompt.** Il divieto di commit/`pass` del worker
   oggi vive solo nel prompt. Rafforzarlo lato harness:
   - un `pre-commit` che rifiuti commit provenienti da un contesto "worker" (es. via env
     `HARNESS_ROLE=worker`);
   - un guard in `issue-manager.mjs` che rifiuti `state:pass`/`status:done` se
     `HARNESS_ROLE=worker` è impostato, così l'auto-validazione è **impossibile**, non solo
     "vietata a parole".
5. **Ruoli espliciti.** Introdurre una variabile/nozione di ruolo (`worker`, `verifier`,
   `orchestrator`) che l'harness legge per applicare policy differenziate (chi può committare,
   chi può impostare `pass`). Formalizza l'invariante "worker ≠ verificatore".
6. **Cattura/aggregazione log standard.** Convenzione per i log dei worker (es.
   `.harness/runs/<issue>-<timestamp>.log`) già in `.gitignore`, così l'orchestratore sa
   sempre dove leggere e i temporanei non finiscono mai in commit.
7. **`issue-manager.mjs`: stato "in review".** Oggi gli stati sono
   `backlog|in_progress|blocked|done`. Manca uno stato che rappresenti "lavoro fatto, in
   attesa di verifica indipendente" (qui simulato con `in_progress` + nota nella criteria).
   Uno stato dedicato (es. `in_review`) renderebbe il flusso worker→verifier esplicito e
   query-abile.
8. **Nota su `ANTHROPIC_API_KEY`.** Documentare l'interazione con `ollama launch claude`
   (precede il login claude.ai) tra le note ambiente.

## 7. Comandi di riferimento (riepilogo copia-incolla)

```powershell
# Preflight modello worker
ollama list
ollama show gemma4:31b-cloud

# Smoke test plumbing
ollama launch claude --model gemma4:31b-cloud -- -p "Reply exactly READY. Do not use any tools." 2>&1 | Tee-Object external-run.log

# Run worker su issue (prompt lungo in una here-string $p)
ollama launch claude --model gemma4:31b-cloud -- -p $p --dangerously-skip-permissions 2>&1 | Tee-Object external-run.log

# Verifica indipendente (gate)
node init.mjs build   # dotnet build + dotnet test --no-build

# Update issue file-based (robusto rispetto al quoting)
node issue-manager.mjs --update --issue-id <guid> --issue-data-file <file>.json
```

## 8. Esito

Prova **riuscita**: il worker esterno via `ollama launch claude` è un modo praticabile e
compatibile con l'harness per svolgere una issue, purché (a) invocato one-shot con `tee`,
(b) privato del diritto di commit e di auto-`pass`, (c) affiancato da una verifica
indipendente separata. Le migliorie della §6 servono a trasformare questi vincoli da
"disciplina nel prompt" a **garanzie tecniche** della libreria harness.
