---
description: Operazioni sul tracker harness — elenca le issue per stato, creane una nuova, aggiornane una esistente. Senza argomenti mostra lo stato del tracker.
argument-hint: "[list <stato> | show <id> | new <descrizione> | update <id> <modifica> | init]"
allowed-tools: Bash, Read, Write
---

Operazioni sul tracker del progetto corrente. Il contratto completo della CLI — schema,
paginazione, codici di errore, semantica di `validation` — è in
`${CLAUDE_PLUGIN_ROOT}/skills/harness/references/issues.md`: leggilo prima di comporre un
payload che non sia uno dei casi qui sotto.

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

Riassumi in una tabella `id` (accorciato), `title`, `status`. Se il tracker è vuoto dillo:
un progetto senza `issues.json` si legge come tracker vuoto, senza errore e senza creare
niente.

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

`criteria` è un **array**, un elemento per criterio; `title`, `description` e criteri hanno
limiti di lunghezza, e la `description` va in paragrafi separati da riga vuota. Valori e regole
stanno in `references/issues.md`, sezione "Limiti di formato": leggili invece di indovinare.

Proponi anche un `tier` (`economy`, `standard`, `reasoning`) dicendo perché: lo userà chi
dispatcha per scegliere l'agente. Se il lavoro non è inquadrabile ometti il campo — assente vale
`standard`, meglio di un tier inventato.

Scrivi il payload **su file** e passalo con `--issue-data-file` (nessun escaping di quote da
gestire nella shell), con `"status":"backlog"` e
`"validation":{"criteria":["...","..."],"state":"unknown"}`. Mostra il payload all'utente e
chiedi conferma **prima** di scrivere. L'id della issue creata si legge da `.data.id` della
risposta, non dal testo del messaggio.

Se la CLI risponde `LIMIT_EXCEEDED`, non comprimere il testo: tieni un riassunto nel campo e
rimanda a un documento del progetto, col path nella description. Il documento lo scrive
l'utente, eventualmente con le skill di spec presenti nell'ambiente — proponile se ci sono,
harness non le invoca da sé.

## `update <id> <modifica>` → aggiornare

`--update --issue-id <id> --issue-data-file <path>`: merge, i campi omessi restano invariati,
ma un campo presente dev'essere valido.

**Da qui non si chiude una issue.** Non portare mai una issue allo stato `done` e non
impostare mai `validation.state` a `pass`: la chiusura spetta a un agente diverso da chi ha
svolto il lavoro, e si lancia con `/harness:verify`. Il worker arriva al massimo a
`in_review` con `state` a `unknown`; oltre, con `HARNESS_ROLE=worker`, la CLI rifiuta con
`FORBIDDEN_ROLE`.

## `init` → crea il tracker

`--init`, `data: { path, created: true }`; file già esistente → `ALREADY_EXISTS`, nessuna
scrittura.

## Errori

Su stdout c'è sempre una sola riga JSON. Se `ok` è `false`, riporta `code` e `error` così
come sono: `INVALID_ID`, `NOT_FOUND`, `INVALID_INPUT`, `INVALID_TIER`, `LIMIT_EXCEEDED`,
`FORBIDDEN_ROLE` dicono già cosa è andato storto, non tirare a indovinare una correzione.
