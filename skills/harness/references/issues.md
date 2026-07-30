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
node "$SCRIPTS/issue-manager.mjs" --insert --issue-data '{"title":"...","description":"...","status":"backlog","validation":{"criteria":["...","..."],"state":"unknown"}}'

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
  "validation": { "criteria": ["<string>"], "state": "unknown|pass|fail" },
  "created_at": "<datetime>",
  "updated_at": "<datetime>"
}
```

`validation` può essere `null` (nessun criterio definito: vedi la verifica leggera in
[SKILL.md](../SKILL.md)).

**Semantica di `validation`:** `criteria` descrive cosa rende la issue accettabile.
- **alla creazione** — `criteria` con i criteri di accettazione, `state: "unknown"`;
- **alla chiusura** — `criteria` con l'**evidenza** della verifica, `state: "pass"` o `"fail"`.

## Limiti di formato

Il testo di una issue è imposto dalla CLI, non lasciato al buon senso: un payload oltre i
limiti viene rifiutato con `LIMIT_EXCEEDED`.

| Campo | Limite |
|---|---|
| `title` | 80 caratteri |
| `description` | 1200 caratteri |
| singolo criterio | 200 caratteri |
| numero di criteri | 7 |

La lunghezza si misura sulla stringa **trimmata**: uno spazio di padding non decide l'esito. I
limiti valgono su `--insert` e sui soli campi **presenti** in `--update` — il merge non
rivalida i campi omessi, quindi una issue scritta prima dei limiti resta aggiornabile.

**Forma di `criteria`, che dipende da `state`:**

- `state: "unknown"` (creazione) → **array** di stringhe non vuote, da 1 a 7 elementi, ognuno
  entro 200 caratteri. Una stringa qui viene rifiutata con `INVALID_INPUT`.
- `state: "pass"` o `"fail"` (chiusura) → stringa **o** array, **senza limiti**: il campo porta
  l'evidenza, che è l'output dei comandi eseguiti. Limitarla spingerebbe a scrivere "verificato,
  tutto ok", cioè il contrario di un'evidenza.

La forma fornita viene salvata così com'è: un array resta array, una stringa resta stringa.
Nessuna migrazione, nessuna riscrittura — le issue scritte con `criteria` stringa restano
leggibili e aggiornabili.

**Cosa fare quando la CLI risponde `LIMIT_EXCEEDED`:** non comprimere il testo per farlo
entrare. Tieni un riassunto nel campo e rimanda a un documento del progetto, scrivendone il
path nella description. Il limite dice che quel contenuto non è una issue: è un documento a cui
la issue punta.

Un `LIMIT_EXCEEDED` non è un `INVALID_INPUT`: il primo si risolve spezzando il testo, il
secondo correggendo la forma del payload.

**Regole che la CLI non può misurare** (valgono comunque):

- la `description` va in paragrafi separati da riga vuota, non un blocco unico di testo;
- ogni criterio è una cosa verificabile da un altro agente che non ha visto la conversazione:
  "funziona bene" non lo è, "il comando X esce 0 e stampa Y" sì;
- per produrre il documento a cui la issue rimanda si possono usare le skill di spec presenti
  nell'ambiente (`superpowers:brainstorming`, `core-dev-toolkit:spec` e simili). **Harness non
  le invoca e non crea documenti da sé**: non semina file nel progetto, e non dipende da nessun
  plugin di terze parti.

**Stato `in_review`:** lo imposta il worker a fine lavoro (con `validation.state = unknown`);
il verificatore indipendente porta poi la issue a `done`/`pass` oppure `blocked`/`fail`.

### Campi automatici

`id` (GUID, all'insert), `created_at` (insert), `updated_at` (insert e update).
**Non includerli mai nel payload.**

### Campi accettati in input

| Campo | Tipo | `--insert` | `--update` | Valori |
|---|---|---|---|---|
| `title` | string | obbligatorio | opzionale | non vuoto, max 80 caratteri |
| `description` | string | obbligatorio | opzionale | non vuoto, max 1200 caratteri |
| `status` | string | obbligatorio | opzionale | `backlog`, `in_progress`, `in_review`, `blocked`, `done` |
| `validation` | object \| null | opzionale | opzionale | `null` oppure `{ criteria, state: unknown\|pass\|fail }`; `criteria` array a `state: unknown`, stringa o array alla chiusura |

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
| `INVALID_INPUT` | campo sconosciuto, obbligatorio mancante o vuoto, payload `{}` in update, `page-size` < 1, `criteria` di forma sbagliata (stringa a `state: unknown`, array vuoto, elemento non stringa o vuoto) |
| `LIMIT_EXCEEDED` | `title`, `description` o un criterio oltre il limite di caratteri, o più di 7 criteri |
| `INVALID_JSON` | payload non JSON valido |
| `NOT_FOUND` | nessuna issue con quell'id |
| `FILE_NOT_FOUND` | `--issue-data-file` inesistente, o `--project-dir` che non esiste |
| `MISSING_ARGS` | flag richiesto assente, o `--issue-data` e `--issue-data-file` insieme |
| `UNKNOWN_COMMAND` | nessun comando riconosciuto (vedi `--help`) |
| `FORBIDDEN_ROLE` | con `HARNESS_ROLE=worker`, tentativo di impostare `status=done` o `validation.state=pass` |

`FORBIDDEN_ROLE` è il guard tecnico contro la self-validation: un processo lanciato con
`HARNESS_ROLE=worker` non può chiudere la propria issue, può arrivare al massimo a
`in_review` / `unknown`.
