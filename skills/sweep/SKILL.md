---
name: sweep
description: Setaccia i documenti del progetto per le occasioni che hanno scoperto e mai tracciato, le verifica e propone le issue che meritano di nascere. Senza argomenti propone il corpus da leggere e lo fa confermare.
argument-hint: "[percorsi o glob dei documenti da setacciare]"
allowed-tools: Bash, Read, Glob, Grep, Write
---

Setaccio dei documenti del progetto corrente. Il procedimento completo — cosa legge, i due
controlli su ogni occasione, cosa promuove e cosa fa delle altre — è in
`${CLAUDE_PLUGIN_ROOT}/skills/harness/references/sweep.md`: **leggilo prima di cominciare**, non è
un contratto di output da consultare a posteriori. Il workflow dentro cui questa operazione vive è
in `${CLAUDE_PLUGIN_ROOT}/skills/harness/SKILL.md`.

**Dove stanno gli script.** Claude Code sostituisce `${CLAUDE_PLUGIN_ROOT}` da sé. Su un host che
non lo fa — Codex CLI, o chiunque stia leggendo questo file come documento — il valore si ricava
dalla **base directory annunciata per questa skill**: la radice del plugin è
`<base della skill>/../..`, quindi gli script stanno in `<base della skill>/../../scripts`. Se la
base non ti è stata annunciata, fermati e chiedila: non indovinarla e non riusare un path assoluto
visto altrove, che porta il numero di versione e continuerebbe a girare sulla copia sbagliata
invece di fallire.

Non c'è nessuno script dedicato: si usano `--get-all` e `--insert` di
`${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs`.

Argomenti: `$ARGUMENTS` — percorsi o glob dei documenti da setacciare. Nessun argomento: proponi
il corpus che trovi (spec, piani, ADR, registri, referti) e **fallo confermare** prima di leggerlo.

## Cosa fare

1. **Fissa il corpus** e dillo per esteso. Un setaccio che ha letto metà dei documenti senza
   dichiararlo produce un elenco che sembra completo.
2. **Raccogli le occasioni** — quello che i documenti dicono andrebbe fatto e che non risulta
   fatto.
3. **Incrocia col tracker in tutti gli stati**, non solo `backlog`, e **verifica ogni occasione
   contro il codice**: quelle già risolte da un lavoro successivo non si propongono, si riportano
   come risolte.
4. **Promuovi solo ciò che passa la bussola** di `SKILL.md` — costoso **e** invisibile. Mostra le
   issue proposte, coi `validation.criteria`, e **aspetta conferma esplicita** prima di
   `--insert`.
5. **Riporta le non promosse in sessione** e fermati lì: harness non crea documenti nel progetto.
   Se meritano un registro, proponi le skill di documentazione presenti nell'ambiente.

## Cosa non fare

Non aprire issue senza conferma, non riscrivere i documenti che leggi, e non promuovere tutto: la
proporzione dell'audit reale che ha originato questa operazione è stata 8 occasioni su 25.
