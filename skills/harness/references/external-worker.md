# Worker esterno

Delega **opt-in** di una issue a una sessione AI esterna (una CLI in un processo separato)
invece che a un subagent interno. Se `externalWorker.enabled` è `false` in
`.harness/config.json` — il default — questa reference non serve: non leggerla, non costa
token.

## Quando conviene

Lavoro meccanico e ben delimitato che un'altra CLI può svolgere a costo minore, mentre
l'orchestratore resta libero. Non conviene per lavoro ambiguo: il costo di riformulare i
vincoli in un prompt supera il risparmio.

## Pattern di delega one-shot

1. L'orchestratore scrive il prompt del worker **in un file**. Sempre su file, mai inline:
   elimina ogni problema di quoting. Su Windows usa il **path assoluto completo**, non la
   forma abbreviata 8.3 (`DIEGO_~1`), che alcune CLI non risolvono. `scripts/harness-worker.mjs`
   risolve comunque il path ricevuto alla propria forma lunga (`fs.realpathSync.native`) prima di
   sostituirlo nel comando, ma partire già da un path lungo evita l'unica dipendenza extra: che il
   file esista quando lo script lo risolve.
2. Lancia il runner del plugin:

   ```text
   node scripts/harness-worker.mjs --run --issue-id <issueId> --prompt-file <promptFile> [--project-dir <path>]
   ```

   Il runner, non l'orchestratore:
   - legge `externalWorker` da `.harness/config.json` del `--project-dir` (default: cwd);
   - risolve il template `command` sostituendo il placeholder `{promptFile}` con il path lungo
     assoluto del prompt file;
   - imposta `HARNESS_ROLE=worker` nell'environment del processo figlio;
   - scrive il log in `.harness/runs/<issueId>-<timestamp>.log`, con la riga di comando
     risolta in testa, l'output combinato stdout+stderr del figlio, e l'exit code in coda;
   - propaga l'exit code del figlio come proprio exit code (unica eccezione al contratto
     standard "exit 0 su ok:true": qui l'exit code segnala l'esito del worker, non del runner —
     vedi sotto).
3. Gli aggiornamenti della issue da parte del worker usano `--issue-data-file`, mai
   `--issue-data` inline.

### Output e contratto

Come gli altri script del plugin, stdout è sempre una riga di JSON
(`{"ok":true,"data":...}` / `{"ok":false,"error":"...","code":"..."}`), stderr resta vuoto,
`--help` è testo semplice. `--run` è l'unica eccezione all'exit code 0/1 standard: una volta che
il processo figlio è stato lanciato, l'exit code dello script diventa quello del figlio (0-255),
non un fisso 0/1 — `data.exitCode` porta lo stesso valore anche per chi legge solo stdout.
`ok:false` resta riservato ai casi in cui il run non è nemmeno partito (config assente/invalida,
argomenti mancanti, prompt file inesistente, o l'avvio del processo che solleva un'eccezione).

Comandi disponibili:

```text
node scripts/harness-worker.mjs --check [--project-dir <path>]
node scripts/harness-worker.mjs --run --issue-id <id> --prompt-file <path> [--project-dir <path>]
node scripts/harness-worker.mjs --help
```

Codici di errore: `CONFIG_NOT_FOUND` (nessun `.harness/config.json`), `INVALID_JSON` (config non
parsabile), `WORKER_DISABLED` (`externalWorker` assente o `enabled` non `true`),
`INVALID_COMMAND` (`command` assente o privo del placeholder `{promptFile}`), `MISSING_ARGS`
(`--run` senza `--issue-id`/`--prompt-file`), `FILE_NOT_FOUND` (project dir o prompt file
inesistenti), `SPAWN_ERROR` (il processo figlio non è nemmeno partito), `CHECK_FAILED` (il
preflight ha eseguito il comando ma l'esito non è quello atteso), `UNKNOWN_COMMAND` (nessuna
flag riconosciuta).

## Configurazione

```json
"externalWorker": {
  "enabled": false,
  "command": "<comando con il placeholder {promptFile}>"
}
```

`command` è un template con un unico placeholder **obbligatorio**, `{promptFile}`. Esempi da
adattare alla CLI realmente installata:

```text
copilot --yolo --model auto -p {promptFile}
codex exec --file {promptFile}
ollama launch claude --model <model> -- -p {promptFile} --dangerously-skip-permissions
```

Il preflight è **CLI-agnostico**:

```text
node scripts/harness-worker.mjs --check [--project-dir <path>]
```

Scrive un prompt di smoke test (`Reply exactly READY. Use no tools.`) su un file temporaneo,
sostituisce il placeholder, esegue il comando e valida l'esito senza dipendere dalla CLI
specifica: passa se il comando esce con `0` oppure se `READY` compare nell'output combinato
stdout+stderr. Nessun codice per-adapter. Il file temporaneo viene rimosso a fine check, che
riesca o fallisca.

## Guard e permessi

`HARNESS_ROLE=worker` attiva il guard tecnico di `issue-manager.mjs`: qualunque update che
tenti `status = done` o `validation.state = pass` viene rifiutato con `FORBIDDEN_ROLE`. Il
worker arriva al massimo a `in_review` / `unknown`. La self-validation diventa impossibile,
non solo vietata a parole.

Nel modello plugin **non** esiste più l'hook `pre-commit` che bloccava i commit del worker:
il divieto di committare resta scritto nel prompt e nelle regole della skill.

Perché il runner sia lanciabile senza approvazione a ogni issue serve una allow rule nelle
settings di Claude Code. Attenzione: quella regola autorizza **l'intera catena**, comprese le
eventuali flag di bypass dentro `command` — il classifier vede la stringa del runner, non
ispeziona il comando configurato. Cambiare `externalWorker.command` cambia quindi cosa si è
di fatto autorizzato, **senza** che venga chiesta una nuova conferma. Rivedi il blocco
`externalWorker` sia quando concedi la regola sia a ogni sua modifica.

Metti la allow rule in `.claude/settings.local.json` (non committato), non in
`.claude/settings.json`: un permission-bypass non deve viaggiare col repository.

## Template di prompt

Da riempire con `{issueId}` e `{repoRoot}` prima di scriverlo su file:

```text
Lavora esclusivamente sulla issue {issueId} nel repository {repoRoot}.

Vincoli rigidi:
- Sviluppa SOLO la issue {issueId}, nessun'altra.
- NON eseguire git commit, in nessun caso.
- NON impostare status=done né validation.state=pass: al massimo status=in_review,
  validation.state=unknown.
- NON modificare file fuori dallo scope della issue.
- A fine lavoro, stampa un riassunto degli artefatti prodotti (file modificati, comandi
  eseguiti) e fermati.
```

Seconda linea di difesa scritta nel prompt, **in aggiunta** al guard tecnico, non in
sostituzione.

## Nota ambiente

Se la CLI del worker legge `ANTHROPIC_API_KEY` dall'environment, questa **precede** il login
interattivo e può cambiare quale credenziale è attiva. Verificalo prima di lanciare.

## Rapporto con la regola 1-WIP

Il "subagent per issue" richiesto dalla regola 1-WIP può essere un worker esterno. La
**verifica indipendente resta un agente distinto**: worker ≠ verificatore ≠ orchestratore, e
commit solo dopo il `pass`. Harness non prescrive *come* si istanzia un subagent, quindi
nessun invariante viene contraddetto.
