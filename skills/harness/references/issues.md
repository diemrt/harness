# Tracker delle issue

Le issue vivono in `issues.json` alla radice del progetto e si gestiscono **solo** tramite lo
script del plugin. **Non modificare `issues.json` a mano**: si perde la consistenza dei dati.

`$SCRIPTS` = `${CLAUDE_PLUGIN_ROOT}/scripts`.

## Dove sta il file

Lo script vive nel plugin, i dati nel progetto. `issues.json` viene risolto contro la
**directory del progetto**, mai accanto allo script:

- default: la directory corrente del processo;
- `--project-dir <path>`: override esplicito, quando non controlli la cwd.

Un progetto senza `issues.json` si legge come tracker vuoto (nessun errore, nessun file
creato). Il file nasce al **primo `--insert`**.

## Comandi

```bash
# leggere: backlog (default), o uno stato specifico
node "$SCRIPTS/issue-manager.mjs" --get-all
node "$SCRIPTS/issue-manager.mjs" --get-all --status in_progress

# singola issue
node "$SCRIPTS/issue-manager.mjs" --get --issue-id <id>

# creare (payload da file: nessun escaping di quote da gestire)
node "$SCRIPTS/issue-manager.mjs" --insert --issue-data-file ./new-issue.json
node "$SCRIPTS/issue-manager.mjs" --insert --issue-data '{"title":"...","description":"...","status":"backlog","validation":{"criteria":"...","state":"unknown"}}'

# aggiornare (merge: i campi omessi restano invariati)
node "$SCRIPTS/issue-manager.mjs" --update --issue-id <id> --issue-data '{"status":"done","validation":{"criteria":"<evidenza>","state":"pass"}}'

# eliminare
node "$SCRIPTS/issue-manager.mjs" --delete --issue-id <id>

# operare su un altro progetto
node "$SCRIPTS/issue-manager.mjs" --get-all --project-dir /path/to/project
```

L'id di una issue creata si legge da `.data.id` della risposta, **non** dal testo del
messaggio:

```bash
# portabile ovunque ci sia Node
node "$SCRIPTS/issue-manager.mjs" --insert --issue-data-file ./new-issue.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.id))"
```

```powershell
$id = (node "$SCRIPTS/issue-manager.mjs" --insert --issue-data-file .\new-issue.json | ConvertFrom-Json).data.id
```

Un `"validation": null` **esplicito** azzera la validazione; ometterlo la lascia invariata.

## Paginazione

`--get-all` è paginato:

- `--page <n>` — base 0, default 0 (valori negativi trattati come 0)
- `--page-size <n>` — default 10, deve essere > 0
- `--order <asc|desc>` — default asc
- `--status <stato>` — default `backlog`

Nel `data` tornano `totalCount`, `page`, `pageSize` e `issues` (sempre un array). Pagine
totali = `ceil(totalCount / pageSize)`; una pagina oltre la fine torna `issues: []`.

## Contratto di output

Su stdout **sempre una sola riga JSON**, sia in successo che in errore (`--help` è l'unica
eccezione: testo semplice). Su stderr non viene scritto nulla.

```jsonc
{"ok":true,"data":<payload>}                      // exit code 0
{"ok":false,"error":"<messaggio>","code":"<CODE>"} // exit code 1
```

| Comando | `data` |
|---|---|
| `--get` | l'oggetto issue |
| `--get-all` | `{ totalCount, page, pageSize, issues: [...] }` |
| `--insert` | l'issue creata (con `id`) |
| `--update` | l'issue aggiornata |
| `--delete` | `{ id, deleted }` |

| Parametro | Uso |
|---|---|
| `--issue-data-file <path>` | legge il JSON da file — nessun escaping nella shell |
| `--issue-data '<json>'` | JSON inline; mutuamente esclusivo con `--issue-data-file` |

## Schema della issue

```json
{
  "id": "<guid>",
  "title": "<string>",
  "description": "<string>",
  "status": "backlog|in_progress|in_review|blocked|done",
  "validation": { "criteria": "<string>", "state": "unknown|pass|fail" },
  "created_at": "<datetime>",
  "updated_at": "<datetime>"
}
```

`validation` può essere `null` (nessun criterio definito).

**Semantica di `validation`:** `criteria` descrive cosa rende la issue accettabile.
- **alla creazione** — `criteria` con i criteri di accettazione, `state: "unknown"`;
- **alla chiusura** — `criteria` con l'**evidenza** della verifica, `state: "pass"` o `"fail"`.

**Stato `in_review`:** lo imposta il worker a fine lavoro (con `validation.state = unknown`);
il verificatore indipendente porta poi la issue a `done`/`pass` oppure `blocked`/`fail`.

### Campi automatici

`id` (GUID, all'insert), `created_at` (insert), `updated_at` (insert e update).
**Non includerli mai nel payload.**

### Campi accettati in input

| Campo | Tipo | `--insert` | `--update` | Valori |
|---|---|---|---|---|
| `title` | string | obbligatorio | opzionale | non vuoto |
| `description` | string | obbligatorio | opzionale | non vuoto |
| `status` | string | obbligatorio | opzionale | `backlog`, `in_progress`, `in_review`, `blocked`, `done` |
| `validation` | object \| null | opzionale | opzionale | `null` oppure `{ criteria: <non vuoto>, state: unknown\|pass\|fail }` |

In `--update` i campi omessi restano invariati, ma un campo **presente** deve essere valido:
`{"title":""}` viene rifiutato, e così un payload `{}`. I campi sconosciuti sono rifiutati in
entrambi i comandi.

## Codici di errore

Il `code` è stabile: usalo per la logica, il messaggio è per gli umani.

| `code` | Quando |
|---|---|
| `INVALID_ID` | `--issue-id` non è un GUID valido |
| `INVALID_STATUS` | `status` fuori dai valori ammessi |
| `INVALID_STATE` | `validation.state` fuori da `unknown`, `pass`, `fail` |
| `INVALID_INPUT` | campo sconosciuto, obbligatorio mancante o vuoto, payload `{}` in update, `page-size` < 1 |
| `INVALID_JSON` | payload non JSON valido |
| `NOT_FOUND` | nessuna issue con quell'id |
| `FILE_NOT_FOUND` | `--issue-data-file` inesistente, o `--project-dir` che non esiste |
| `MISSING_ARGS` | flag richiesto assente, o `--issue-data` e `--issue-data-file` insieme |
| `UNKNOWN_COMMAND` | nessun comando riconosciuto (vedi `--help`) |
| `FORBIDDEN_ROLE` | con `HARNESS_ROLE=worker`, tentativo di impostare `status=done` o `validation.state=pass` |

`FORBIDDEN_ROLE` è il guard tecnico contro la self-validation: un processo lanciato con
`HARNESS_ROLE=worker` non può chiudere la propria issue, può arrivare al massimo a
`in_review` / `unknown`.
