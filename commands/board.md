---
description: Avvia il board live delle issue del progetto corrente e ne stampa l'URL una volta sola, oppure lo ferma. Senza argomenti avvia.
argument-hint: "[stop] [--port <n>]"
allowed-tools: Bash
---

Gestisci il board delle issue. Il contratto completo dello script — payload, ciclo di vita,
cosa il board non fa — è in `${CLAUDE_PLUGIN_ROOT}/skills/harness/references/board.md`:
leggilo solo se qui sotto non trovi quello che ti serve.

Argomenti: `$ARGUMENTS` (vuoto = avvia).

## Avvio (nessun argomento, oppure `start`)

Se il board di questo progetto è già stato avviato in questa sessione, **non rilanciarlo**:
ristampa l'URL che avevi e fermati.

1. Lancia il server **in background** — resta in esecuzione, in foreground bloccheresti la
   sessione:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board-server.mjs" [--project-dir <path>] [--port <n>]
   ```

   `--project-dir` serve solo se la cwd non è la radice del progetto; `--port` solo se
   l'utente ne ha chiesta una esplicita (altrimenti la sceglie il sistema operativo).
2. Leggi la riga JSON che il server stampa all'avvio:
   `{"ok":true,"data":{"url":...,"port":...,"pid":...,"projectDir":...}}`.
3. **Controlla `projectDir`.** Se non è il progetto su cui si sta lavorando, fermalo e
   rilancia con `--project-dir`: altrimenti mostri un board vuoto del progetto sbagliato,
   senza nessun errore.
4. Stampa `url` all'utente **una volta sola**. Non aprire il browser da solo.
5. Tieni `pid` e `port`: servono per lo stop.

Se `ok` è `false`, riporta `error` e `code` senza ritentare alla cieca: `PORT_IN_USE` → la
porta richiesta è occupata, riprova senza `--port`; `FILE_NOT_FOUND` → il `--project-dir`
passato non esiste; `UNKNOWN_ARGUMENT` → il flag che hai passato non esiste, lo script
dichiara solo `--project-dir` e `--port`. Non ci sono sottocomandi: rilancia con i soli flag
dichiarati, e ricorda che lo stop si fa col `pid` della riga di avvio, non con un flag.

## Stop (`stop`)

Termina il processo del board usando il `pid` della riga di avvio (`kill <pid>`; su Windows
`taskkill /PID <pid> /F`). Se il pid non è noto — sessione ripresa, board avviato altrove —
dillo e chiedi conferma prima di andare a caccia di processi Node: sceglierne uno a caso
significa fermare qualcos'altro.

Il board va fermato al clock-out: non lasciare processi orfani a fine sessione.
