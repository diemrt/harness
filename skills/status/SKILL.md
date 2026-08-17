---
name: status
description: Stampa un'istantanea del tracker — conteggi, cosa è in corso, cosa si può prendere adesso. Senza argomenti mostra il progetto corrente.
argument-hint: "[--project-dir <path>]"
allowed-tools: Bash
---

Istantanea del tracker del progetto corrente, in una schermata sola. Il contratto completo —
come si legge ogni riga, icone, ordinamenti, casi vuoti, allerte, canali e codici d'uscita — è
in `${CLAUDE_PLUGIN_ROOT}/skills/harness/references/status.md`: leggilo quando l'output non ti
torna, non prima. Il workflow dentro cui questa operazione vive è in
`${CLAUDE_PLUGIN_ROOT}/skills/harness/SKILL.md`.

**Dove sta lo script.** Claude Code sostituisce `${CLAUDE_PLUGIN_ROOT}` da sé. Su un host che non
lo fa — Codex CLI, o chiunque stia leggendo questo file come documento — il valore si ricava dalla
**base directory annunciata per questa skill**: la radice del plugin è `<base della skill>/../..`,
quindi gli script stanno in `<base della skill>/../../scripts`. Se la base non ti è stata
annunciata, fermati e chiedila: non indovinarla e non riusare un path assoluto visto altrove, che
porta il numero di versione e continuerebbe a girare sulla copia sbagliata invece di fallire.

Argomenti: `$ARGUMENTS` (nessun argomento = progetto corrente).

## Cosa fare

1. Lancia lo script:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/status-cli.mjs" [--project-dir <path>]
   ```

   `--project-dir` serve solo se la cwd non è la radice del progetto; `--help` stampa l'uso.
   Non ci sono altri flag e non ci sono sottocomandi.

2. **Ristampa l'output verbatim, dentro un blocco di codice**, e basta.

   Non riformattarlo, non convertirlo in tabella markdown, non riordinare le sezioni, non
   accorciare i titoli già troncati, non tradurre le etichette. L'allineamento è già fatto a 80
   colonne: rifarlo consuma contesto e rende ogni invocazione diversa dalla precedente.

3. Aggiungi al massimo **una riga** tua, e solo se dice qualcosa che l'output non dice già —
   per esempio quale issue proponi di prendere fra le lavorabili. Il riepilogo parla da sé.

## Uscita diversa da zero

Lo script esce 1 quando la directory di progetto non esiste, quando `issues.json` non è un JSON
valido, o quando un flag non esiste. Riporta la riga che stampa così com'è e fermati: non
ritentare con flag inventati.

**Tutto esce su stdout, errori compresi: su stderr non finisce mai niente**, e l'output è testo,
mai JSON. Chi guarda solo stderr non trova nulla e crede che il comando sia rimasto muto.

Un tracker vuoto **non** è un errore: esce 0 e stampa `tracker vuoto`. Vale sia quando
`issues.json` manca sia quando esiste senza issue dentro.
