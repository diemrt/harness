---
name: issue
description: Operazioni sul tracker harness — elenca le issue per stato, creane una nuova, aggiornane una esistente. Senza argomenti mostra lo stato del tracker.
argument-hint: "[list <stato> | show <id> | new <descrizione> | update <id> <modifica> | init | upgrade]"
allowed-tools: Bash, Read, Write
---

Operazioni sul tracker del progetto corrente. Contratto completo della CLI — schema,
paginazione, errori, `validation` — in
`${CLAUDE_PLUGIN_ROOT}/skills/harness/references/issues.md`: leggilo prima di comporre un
payload fuori dai casi sotto. Il workflow dentro cui questa operazione vive è in
`${CLAUDE_PLUGIN_ROOT}/skills/harness/SKILL.md`.

**Dove sta lo script.** Claude Code sostituisce `${CLAUDE_PLUGIN_ROOT}` da sé. Su un host che non
lo fa — Codex CLI, o chiunque stia leggendo questo file come documento — il valore si ricava dalla
**base directory annunciata per questa skill**: la radice del plugin è `<base della skill>/../..`,
quindi gli script stanno in `<base della skill>/../../scripts`. Se la base non ti è stata
annunciata, fermati e chiedila: non indovinarla e non riusare un path assoluto visto altrove, che
porta il numero di versione e continuerebbe a girare sulla copia sbagliata invece di fallire.

Tutte le invocazioni passano dallo script del plugin. **Non aprire e non editare i file del
tracker a mano** — `.harness/issues/<stato>-<primi 8 caratteri dell'id>.md` — nemmeno per un campo: si
perde la consistenza dei dati.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" <flag> [--project-dir <path>]
```

Argomenti: `$ARGUMENTS`. Il primo (`$1`) è l'operazione.

## Nessun argomento → stato del tracker

Mostra dove sta il lavoro adesso, in quest'ordine: `in_progress`, `in_review`, `backlog`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --get-all --status in_progress
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --get-all --status in_review
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --get-all --status backlog
```

Riassumi in tabella `id` (accorciato), `title`, `status`; un progetto senza tracker si
legge come tracker vuoto — dillo, non è un errore e non crea niente.

## `list [stato]` → un solo stato

`--get-all --status <stato>` (`backlog` se lo stato è omesso). L'elenco è paginato: usa
`--page` / `--page-size` se `totalCount` supera quanto stai mostrando.

## `show <id>` → una issue

`--get --issue-id <id>`. Riporta anche i `validation.criteria`: sono il contratto su cui la
issue verrà giudicata.

## `new <descrizione libera>` → creare

Trasforma la descrizione dell'utente in `title`, `description` e `validation.criteria`. **Cosa
rende una issue buona invece che ben formata** — criteri, verifica leggera, `tier`, conferma prima
di scrivere — è in `references/issues.md`, sezione "Aprire una issue": leggila, non è opzionale.

Scrivi il payload **su file** e passalo con `--issue-data-file` (nessun escaping di quote da
gestire nella shell), con `"status":"backlog"` e
`"validation":{"criteria":["...","..."],"state":"unknown"}`. L'id della issue creata si legge da
`.data.id` della risposta, non dal testo del messaggio.

Insieme ai criteri scrivi i `validation.tasks`. I `tasks` di esecuzione no: li materializza chi
prende la issue, e la CLI li esige al passaggio a `in_progress`.

Una issue docs che documenta commit già fatti li dichiara in `"covers":["<sha>"]`: è ciò che la
rende visibile all'operazione `docs-gate`.

## `update <id> <modifica>` → aggiornare

`--update --issue-id <id> --issue-data-file <path>`: merge, campi omessi invariati, un campo
presente dev'essere valido.

**Prosa e decomposizione si toccano insieme:** cambiare la `description` senza rivedere i `tasks`
viene rifiutato; se i passi reggono, dichiaralo con `--decomposition-unchanged`. Spuntare un task
non chiede mai il flag.

**Da qui non si chiude una issue.** Non portare mai lo stato a `done` né `validation.state` a
`pass`: la chiusura spetta a un agente diverso da chi ha svolto il lavoro, con l'operazione
`verify` (`/harness:verify` in Claude Code, `$verify` in Codex). Il worker arriva al massimo a
`in_review` / `unknown`; oltre, con `HARNESS_ROLE=worker`, la CLI rifiuta `FORBIDDEN_ROLE` —
spunta dei `validation.tasks` compresa.

## `init` → crea il tracker

`--init` crea `.harness/issues/`, `data: { path, created: true }`; tracker già esistente →
`ALREADY_EXISTS`, nessuna scrittura.

## `upgrade` → migra un tracker legacy

`--upgrade` porta un `issues.json` legacy allo storage Markdown (mai automatico da
`new`/`update`). `data: { from, to, migrated, issues, archivePath, resumed }`; già su storage
Markdown → `migrated: 0`, nessuna scrittura.

## Errori

Su stdout c'è sempre una sola riga JSON. Se `ok` è `false`, riporta `code` e `error` così
come sono: `INVALID_ID`, `NOT_FOUND`, `INVALID_INPUT`, `INVALID_TIER`, `LIMIT_EXCEEDED`,
`FORBIDDEN_ROLE`, `STORAGE_CONFLICT` dicono già cosa è andato storto, non tirare a indovinare
una correzione. `STORAGE_NOT_MIGRATED` ha una risposta sola, ed è nel messaggio: il progetto ha
ancora il tracker JSON, va lanciato `upgrade`.
