---
description: Stampa un'istantanea del tracker — conteggi, cosa è in corso, cosa si può prendere adesso. Senza argomenti mostra il progetto corrente.
argument-hint: "[--project-dir <path>]"
allowed-tools: Bash
---

Istantanea del tracker del progetto corrente, in una schermata sola. Il contratto del tracker
che questo comando legge — schema, stati, `depends_on` — è in
`${CLAUDE_PLUGIN_ROOT}/skills/harness/references/issues.md`: qui non serve, il comando non
scrive niente.

Argomenti: `$ARGUMENTS` (nessun argomento = progetto corrente).

## Cosa fare

1. Lancia lo script:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/status-cli.mjs" [--project-dir <path>]
   ```

   `--project-dir` serve solo se la cwd non è la radice del progetto.

2. **Ristampa l'output verbatim, dentro un blocco di codice**, e basta.

   Non riformattarlo, non convertirlo in tabella markdown, non riordinare le sezioni, non
   accorciare i titoli già troncati, non tradurre le etichette. L'allineamento è già fatto a 80
   colonne: rifarlo consuma contesto e rende ogni invocazione diversa dalla precedente.

3. Aggiungi al massimo **una riga** tua, e solo se dice qualcosa che l'output non dice già —
   per esempio quale issue proponi di prendere fra le lavorabili. Il riepilogo parla da sé.

## Come si legge

Le icone della barra sono le stesse delle righe: `#` done, `+` in_progress, `~` in_review,
`!` blocked, `o` backlog. Il tier è `$` economy, `$$` standard, `$$$` reasoning, `-` non
dichiarato, e la legenda è in fondo all'output.

Le righe che iniziano con `!`, sopra la barra, sono le sole cose che le sezioni non possono
mostrare da sé: un ciclo nei `depends_on`, dipendenze che puntano a id inesistenti, un backlog
in cui nessuna issue è lavorabile. Le issue `blocked` non stanno lì: stanno in `IN CORSO`.

## Uscita diversa da zero

Lo script esce 1 e stampa una riga sola quando la directory di progetto non esiste, quando
`issues.json` non è un JSON valido, o quando un flag non esiste. Riporta quella riga così com'è
e fermati: non ritentare con flag inventati, lo script dichiara solo `--project-dir` e `--help`.

Un progetto senza `issues.json` **non** è un errore: esce 0 e stampa `tracker vuoto`.
