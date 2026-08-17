---
name: docs-gate
description: Elenca i commit che hanno toccato codice senza che nessuna issue li dichiari in covers. Senza argomenti usa la finestra autocalibrata sul progetto corrente.
argument-hint: "[--since <rev>] [--project-dir <path>]"
allowed-tools: Bash
---

Controllo cumulativo del gate documentale sul progetto corrente. Il contratto completo — come si
autocalibra la finestra, cosa conta come coperto, come si leggono le righe, canali e codici
d'uscita — è in `${CLAUDE_PLUGIN_ROOT}/skills/harness/references/docs-gate.md`: leggilo quando
l'output non ti torna, non prima. Il workflow dentro cui questa operazione vive è in
`${CLAUDE_PLUGIN_ROOT}/skills/harness/SKILL.md`.

**Dove sta lo script.** Claude Code sostituisce `${CLAUDE_PLUGIN_ROOT}` da sé. Su un host che non
lo fa — Codex CLI, o chiunque stia leggendo questo file come documento — il valore si ricava dalla
**base directory annunciata per questa skill**: la radice del plugin è `<base della skill>/../..`,
quindi gli script stanno in `<base della skill>/../../scripts`. Se la base non ti è stata
annunciata, fermati e chiedila: non indovinarla e non riusare un path assoluto visto altrove, che
porta il numero di versione e continuerebbe a girare sulla copia sbagliata invece di fallire.

Argomenti: `$ARGUMENTS` (nessun argomento = finestra autocalibrata sul progetto corrente).

## Cosa fare

1. Lancia lo script:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-gate.mjs" [--since <rev>] [--project-dir <path>]
   ```

   Non ci sono altri flag e non ci sono sottocomandi.

2. **Ristampa l'output verbatim, dentro un blocco di codice.** Non riformattarlo, non convertirlo
   in tabella markdown, non accorciare i soggetti già troncati: l'allineamento è già fatto a 80
   colonne.

3. Se ci sono commit scoperti, **proponi le issue docs da aprire**, una per commit o una per
   gruppo coerente, e aspetta conferma. Ogni issue proposta dichiara in `covers` lo SHA che copre
   — è quello che la rende coperta al giro dopo. Si aprono con l'operazione `issue`
   (`/harness:issue` in Claude Code, `$issue` in Codex) o direttamente con `--insert`
   (`${CLAUDE_PLUGIN_ROOT}/skills/harness/references/issues.md`).

   Non aprirle da solo senza mostrarle: il gate è un promemoria, e cosa merita una issue lo decide
   la bussola in `SKILL.md`.

## Uscita diversa da zero

**Trovare commit scoperti esce 0**: è il risultato, non un errore. Lo script esce 1 solo quando
non ha potuto rispondere — fra i casi, il più frequente al primo uso:

- *nessuna issue dichiara una revisione in `covers`* → non c'è una finestra da cui partire.
  Rilancia con `--since <rev>` esplicito, scegliendo il punto da cui ha senso guardare (per
  esempio il primo commit da quando il progetto usa harness). Non inventare un default.
- `--since` che non risolve, `.harness/config.json` mancante, directory non git, flag sconosciuto
  → riporta la riga così com'è e fermati.

**Tutto esce su stdout, errori compresi: su stderr non finisce mai niente**, e l'output è testo,
mai JSON.
