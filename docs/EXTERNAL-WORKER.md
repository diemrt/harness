# EXTERNAL-WORKER.md

Questo documento è `managed`: viene mantenuto sincronizzato da `harness update` e **non va
modificato a mano**. Descrive la delega opt-in di una issue a un *worker* AI esterno (una
sessione CLI in un terminale separato). Se `externalWorker.enabled` è `false` in
`init.config.json` (default), questa doc non serve: nessun costo di contesto per i progetti
che non usano la feature.

## 1. Quando e perché

A volte conviene delegare lo sviluppo di una issue a una sessione AI lanciata in un
terminale separato (es. `ollama launch claude`, `codex`, `copilot`, ...) invece che a un
subagent interno. Attivazione:

```bash
node init.mjs worker on      # externalWorker.enabled = true
node init.mjs worker check   # preflight: verifica che il comando configurato risponda
```

`worker off` disattiva di nuovo la feature.

## 2. Pattern di delega one-shot

1. L'orchestratore scrive il prompt del worker in un file (il prompt è **sempre
   file-based**, mai passato inline: evita ogni problema di quoting).
2. Lancia:

   ```bash
   node init.mjs worker run --issue <issueId> --prompt <promptFile>
   ```

   Lo script, non l'orchestratore, si occupa di tutto il resto: crea `.harness/runs/` se
   manca (git-ignored: convenzione di log per non far finire i temporanei in un commit),
   imposta `HARNESS_ROLE=worker` nell'environment del processo figlio, stampa a video e
   scrive in testa a `.harness/runs/<issueId>-<timestamp>.log` la riga di comando risolta
   (placeholder `{promptFile}` sostituito), appende l'output del worker allo stesso log e
   propaga l'exit code del processo figlio.
3. Gli aggiornamenti della issue da parte del worker usano `--issue-data-file`, non
   `--issue-data` inline:

   ```bash
   node issue-manager.mjs --update --issue-id <id> --issue-data-file <path-al-json>
   ```

   Robusto: nessun quoting di JSON dentro la shell del worker.

## 3. Prerequisito: permessi per la delega autonoma

Perché `worker run` sia lanciabile senza approvazione interattiva a ogni issue, serve una
allow rule nelle settings di Claude Code, es. `Bash(node init.mjs worker run:*)`. Senza,
ogni lancio richiede conferma manuale e la delega non è autonoma.

Quella regola non autorizza solo `worker run`: autorizza l'intera catena, incluse le
eventuali flag di bypass dei permessi presenti nel `command` configurato (es.
`--dangerously-skip-permissions` negli esempi in §4). Il classifier dei permessi vede solo
la stringa `node init.mjs worker run`, **non** ispeziona `externalWorker.command` né il
comando che lo script risolve ed esegue.

Conseguenza diretta: modificare `externalWorker.command` cambia cosa si è di fatto
autorizzato, senza che venga richiesta una nuova conferma — la allow rule resta la stessa
stringa, il comando dietro può cambiare arbitrariamente. Rivedere il blocco `externalWorker`
sia al momento di concedere la regola sia a ogni sua modifica successiva.

Per non far viaggiare un permission-bypass insieme al repository, mettere la allow rule nel
file di settings locale e non committato (`.claude/settings.local.json`, già in
`.gitignore`) piuttosto che in `.claude/settings.json` (vedi anche [GIT.md](/docs/GIT.md)
§5 sui file di configurazione).

## 4. Config e placeholder

Blocco `externalWorker` in `init.config.json`:

```json
"externalWorker": {
  "enabled": false,
  "command": "<comando con il placeholder {promptFile}>"
}
```

- `enabled` — stato della feature (toggle via `worker on|off`).
- `command` — command template. Unico placeholder supportato, **obbligatorio**:
  `{promptFile}`, sostituito con il path del file che contiene il prompt.

Esempi di `command` da copiare e adattare:

```text
ollama launch claude --model <model> -- -p {promptFile} --dangerously-skip-permissions
```

```text
codex exec --file {promptFile}
```

```text
copilot -p {promptFile}
```

Gli esempi codex/copilot sono illustrativi: vanno adattati alla sintassi reale della CLI
installata. Il preflight `node init.mjs worker check` è **CLI-agnostico**: scrive un prompt
di smoke test su file, sostituisce `{promptFile}`, esegue il `command` e valida `exit 0` e/o
un output contenente `READY` — funziona con qualunque template, senza codice per-adapter.

## 5. `HARNESS_ROLE=worker` e i guard

Lanciare il worker con `HARNESS_ROLE=worker` nell'environment attiva due guard tecnici (non
solo disciplina di prompt):

- **`issue-manager.mjs`** rifiuta con `exit 1` e codice errore `FORBIDDEN_ROLE` qualunque
  update che tenti `status = done` o `validation.state = pass`. Il worker può arrivare al
  massimo a `status = in_review` / `validation.state = unknown`: la self-validation diventa
  tecnicamente impossibile, non solo vietata a parole.
- **`hooks/pre-commit.mjs`** blocca **ogni** commit quando `HARNESS_ROLE=worker` è impostato.

`node init.mjs worker run` imposta sempre la variabile nell'environment del processo
figlio: il guard non dipende dalla disciplina di chi lancia.

## 6. Template di prompt worker

Da riempire con `{issueId}` e `{repoRoot}` prima di scriverlo nel file passato al worker:

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

Questi vincoli sono una seconda linea di difesa scritta nel prompt, in aggiunta (non in
sostituzione) ai guard tecnici della sezione 5.

## 7. Nota ambiente

Se la CLI del worker legge `ANTHROPIC_API_KEY` dall'environment, questa **precede** il
login interattivo (es. claude.ai) e può alterare il comportamento della sessione: verificare
quale credenziale è effettivamente attiva prima di lanciare il worker.

## 8. Nota anti-conflitto con la regola 1-WIP

Quando `externalWorker.enabled` è `true`, il "subagent per issue" richiesto dalla regola
1-WIP (vedi [AGENTS-RULES.md](/docs/AGENTS-RULES.md)) può essere un worker esterno lanciato
con questo pattern. La **verifica indipendente resta comunque un agente distinto**:
l'invariante **worker ≠ verificatore ≠ orchestratore**, con commit solo dopo il `pass` del
verificatore, non cambia. L'harness non prescrive *come* si istanzia un subagent, quindi
nessuna regola invariante viene contraddetta.
