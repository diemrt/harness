---
description: Operazioni sul tracker harness — elenca le issue per stato, creane una nuova, aggiornane una esistente. Senza argomenti mostra lo stato del tracker.
argument-hint: "[list <stato> | show <id> | new <descrizione> | update <id> <modifica> | init | upgrade]"
allowed-tools: Bash, Read, Write
---

Operazioni sul tracker del progetto corrente. Contratto completo della CLI — schema,
paginazione, errori, `validation` — in
`${CLAUDE_PLUGIN_ROOT}/skills/harness/references/issues.md`: leggilo prima di comporre un
payload fuori dai casi sotto.

Tutte le invocazioni passano dallo script del plugin. **Non aprire e non editare
`issues.json` a mano**, nemmeno per un campo: si perde la consistenza dei dati.

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

Riassumi in tabella `id` (accorciato), `title`, `status`; un progetto senza `issues.json` si
legge come tracker vuoto — dillo, non è un errore e non crea niente.

## `list [stato]` → un solo stato

`--get-all --status <stato>` (`backlog` se lo stato è omesso). L'elenco è paginato: usa
`--page` / `--page-size` se `totalCount` supera quanto stai mostrando.

## `show <id>` → una issue

`--get --issue-id <id>`. Riporta anche i `validation.criteria`: sono il contratto su cui la
issue verrà giudicata.

## `new <descrizione libera>` → creare

Trasforma la descrizione dell'utente in `title`, `description` e `validation.criteria`.
I criteri sono la parte che conta: devono essere verificabili da un altro agente che non ha
visto questa conversazione — "funziona bene" non lo è, "il comando X esce 0 e stampa Y" sì.

`criteria` è un **array**, un elemento per criterio; `title`/`description`/criteri hanno
limiti di lunghezza (sezione "Limiti di formato" in `references/issues.md`), e `description`
va in paragrafi separati da riga vuota.

Proponi anche un `tier` (`economy`, `standard`, `reasoning`) dicendo perché — lo usa chi
dispatcha; omettilo se il lavoro non è inquadrabile (assente vale `standard`).

Scrivi il payload **su file** e passalo con `--issue-data-file` (nessun escaping di quote da
gestire nella shell), con `"status":"backlog"` e
`"validation":{"criteria":["...","..."],"state":"unknown"}`. Mostra il payload all'utente e
chiedi conferma **prima** di scrivere. L'id della issue creata si legge da `.data.id` della
risposta, non dal testo del messaggio.

`LIMIT_EXCEEDED`: non comprimere il testo, rimanda a un documento del progetto (path nella
description) — vedi "Cosa fare quando..." in `references/issues.md`. Harness non scrive
documenti da sé; proponi le skill di spec presenti nell'ambiente, se ci sono.

## `update <id> <modifica>` → aggiornare

`--update --issue-id <id> --issue-data-file <path>`: merge, campi omessi invariati, un campo
presente dev'essere valido.

**Da qui non si chiude una issue.** Non portare mai lo stato a `done` né `validation.state` a
`pass`: la chiusura spetta a un agente diverso da chi ha svolto il lavoro, con
`/harness:verify`. Il worker arriva al massimo a `in_review` / `unknown`; oltre, con
`HARNESS_ROLE=worker`, la CLI rifiuta `FORBIDDEN_ROLE`.

## `init` → crea il tracker

`--init`, `data: { path, created: true }`; file già esistente → `ALREADY_EXISTS`, nessuna
scrittura.

## `upgrade` → aggiorna lo schema

`--upgrade` porta `issues.json` a `SCHEMA_VERSION`, aggiunge solo campi nuovi coi default (mai
automatico da `new`/`update`). `data: { from, to, migrated }`; già aggiornato → `migrated: 0`,
nessuna scrittura; più nuovo di questo script → `SCHEMA_TOO_NEW`, nessuna scrittura.

## Errori

Su stdout c'è sempre una sola riga JSON. Se `ok` è `false`, riporta `code` e `error` così
come sono: `INVALID_ID`, `NOT_FOUND`, `INVALID_INPUT`, `INVALID_TIER`, `LIMIT_EXCEEDED`,
`FORBIDDEN_ROLE` dicono già cosa è andato storto, non tirare a indovinare una correzione.
