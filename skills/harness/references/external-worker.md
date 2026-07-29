# Worker esterno

> **Stato:** contratto definito, runner in corso di migrazione nel plugin (issue "Portare il
> runner del worker esterno nel plugin"). Il pattern qui sotto è quello che il runner deve
> rispettare.

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
   forma abbreviata 8.3 (`DIEGO_~1`), che alcune CLI non risolvono.
2. Lancia il runner del plugin passando issue e prompt file. Il runner, non l'orchestratore:
   - risolve il template `command` sostituendo il placeholder `{promptFile}`;
   - imposta `HARNESS_ROLE=worker` nell'environment del processo figlio;
   - scrive il log in `.harness/runs/<issueId>-<timestamp>.log`, con la riga di comando
     risolta in testa;
   - propaga l'exit code del figlio.
3. Gli aggiornamenti della issue da parte del worker usano `--issue-data-file`, mai
   `--issue-data` inline.

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

Il preflight è **CLI-agnostico**: scrive un prompt di smoke test su file, sostituisce il
placeholder, esegue il comando e valida l'esito. Nessun codice per-adapter.

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
