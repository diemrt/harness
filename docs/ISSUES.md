# ISSUES.md

Questo documento descrive come gestire le issues del progetto utilizzando lo script `issue-manager.mjs`.

## Introduzione

Le issues vengono memorizzate in `issues.json` e gestite tramite lo script Node.js `issue-manager.mjs`. **Non modificare il file `issues.json` direttamente**; usa sempre lo script per mantenere la consistenza dei dati.

## Comandi di base

### Leggere le issue in backlog (default, prima pagina)
```bash
node issue-manager.mjs --get-all
```

### Leggere issue per stato specifico
```bash
node issue-manager.mjs --get-all --status in_progress
```

### Leggere una singola issue
```bash
node issue-manager.mjs --get --issue-id <id>
```

### Creare una nuova issue
```bash
# payload da file: nessun escaping di quote da gestire
node issue-manager.mjs --insert --issue-data-file ./new-issue.json

# oppure inline
node issue-manager.mjs --insert --issue-data '{"title":"...","description":"...","status":"backlog","validation":{"criteria":"...","state":"unknown"}}'
```

L'id della issue creata si legge da `.data.id` della risposta, non dal testo del messaggio:

```powershell
# PowerShell
$id = (node issue-manager.mjs --insert --issue-data-file .\new-issue.json | ConvertFrom-Json).data.id
```

```bash
# Portabile su qualsiasi OS (richiede solo Node.js)
node issue-manager.mjs --insert --issue-data-file ./new-issue.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.id))"
```

### Aggiornare una issue (es. chiuderla)

`--update` fa **merge**: i campi omessi mantengono il valore attuale. Per chiudere una issue basta
inviare `status` e `validation`, senza rileggerla prima con `--get`.

```bash
node issue-manager.mjs --update --issue-id <id> --issue-data '{"status":"done","validation":{"criteria":"<evidenza>","state":"pass"}}'
```

Un `"validation": null` **esplicito** azzera la validazione; ometterlo la lascia invariata.

### Eliminare una issue
```bash
node issue-manager.mjs --delete --issue-id <id>
```

## Paginazione (IMPORTANTE)

`--get-all` è **paginabile**. Utilizza i seguenti parametri per navigare:

- `--page <numero>`: Numero di pagina (default: 0, base 0; valori negativi trattati come 0)
- `--page-size <numero>`: Numero di issue per pagina (default: 10; deve essere > 0)
- `--order <asc|desc>`: Ordine di ordinamento (default: asc)
- `--status <stato>`: Filtra per stato (default: backlog)

### Esempi con paginazione

```bash
# Pagina 0 (primo set di 10 issue, default)
node issue-manager.mjs --get-all

# Pagina 1 (secondo set di 10 issue)
node issue-manager.mjs --get-all --page 1

# Pagina 0 con 20 issue per pagina
node issue-manager.mjs --get-all --page-size 20

# Issue in_progress, pagina 2, 15 per pagina
node issue-manager.mjs --get-all --status in_progress --page 2 --page-size 15

# Issue ordinate in descending, prima pagina
node issue-manager.mjs --get-all --order desc
```

### Output JSON

`--get-all` restituisce nel campo `data`:
- `totalCount`: Numero totale di issue (filtrate per status se applicabile)
- `page`, `pageSize`: la pagina richiesta
- `issues`: Array della pagina richiesta (sempre un array, anche con 0 o 1 elementi)

Usa `totalCount` e `pageSize` per calcolare il numero totale di pagine: `ceil(totalCount / pageSize)`.
Una pagina oltre la fine restituisce `issues: []`.

## Contratto di output (per agenti)

Su stdout lo script emette **sempre una sola riga JSON**, sia in caso di successo che di errore.
`--help` è l'unica eccezione (testo semplice). Su stderr non viene scritto nulla.

```jsonc
// successo — exit code 0
{"ok":true,"data":<payload>}

// errore — exit code 1
{"ok":false,"error":"<messaggio>","code":"<CODE>"}
```

Quindi il campo `ok` (o l'exit code) distingue l'esito, sia lavorando in PowerShell con
`ConvertFrom-Json` sia con qualsiasi altra shell tramite un piccolo script Node:

```powershell
# PowerShell
$r = node issue-manager.mjs --get --issue-id <id> | ConvertFrom-Json
if (-not $r.ok) { "fallito: $($r.code)" } else { $r.data.title }
```

```bash
# Portabile su qualsiasi OS (richiede solo Node.js)
node issue-manager.mjs --get --issue-id <id> | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);console.log(r.ok?r.data.title:'fallito: '+r.code)})"
```

Il `data` restituito per comando:

| Comando       | `data`                                                |
|---------------|--------------------------------------------------------|
| `--get`       | l'oggetto issue                                       |
| `--get-all`   | `{ totalCount, page, pageSize, issues: [...] }`       |
| `--insert`    | l'oggetto issue creato (con `id` valorizzato)         |
| `--update`    | l'oggetto issue aggiornato                            |
| `--delete`    | `{ id, deleted }`                                     |

### Passare il payload

| Parametro                  | Uso                                                          |
|-----------------------------|--------------------------------------------------------------|
| `--issue-data-file <path>`  | Legge il JSON da file — nessun escaping di quote nella shell |
| `--issue-data '<json>'`     | JSON inline; mutuamente esclusivo con `--issue-data-file`    |

## Campi della issue

Una issue ha i seguenti campi (schema canonico):

```json
{
  "id": "<guid>",
  "title": "<string>",
  "description": "<string>",
  "status": "backlog|in_progress|in_review|blocked|done",
  "validation": {
    "criteria": "<string>",
    "state": "unknown|pass|fail"
  },
  "created_at": "<datetime>",
  "updated_at": "<datetime>"
}
```

> `validation` può essere `null` (nessun criterio definito) oppure un oggetto con `criteria` e `state`.
>
> **Semantica di `validation`:** `criteria` descrive cosa rende la issue valida/accettabile.
> - **Alla creazione**: impostare `criteria` con i criteri di accettazione e `state: "unknown"`.
> - **Alla chiusura**: aggiornare `criteria` con l'evidenza della verifica effettuata e `state: "pass"` o `"fail"`.
>
> **Stato `in_review`:** il worker imposta `in_review` a fine lavoro (con `validation.state=unknown`);
> il verificatore indipendente porta poi la issue a `done`/`pass` o `blocked`/`fail`.

### Campi gestiti automaticamente dallo script

| Campo        | Quando viene impostato                          |
|--------------|-------------------------------------------------|
| `id`         | Insert — GUID generato automaticamente          |
| `created_at` | Insert — timestamp corrente                     |
| `updated_at` | Insert e Update — timestamp corrente            |

**Non includere mai `id`, `created_at` o `updated_at` nel payload fornito allo script.**

### Campi richiesti nel payload (`--insert` / `--update`)

| Campo         | Tipo             | `--insert` | `--update` | Valori validi                          |
|---------------|------------------|-----------|-----------|----------------------------------------|
| `title`       | string           | ✅ Sì      | Opzionale | Non vuoto                              |
| `description` | string           | ✅ Sì      | Opzionale | Non vuoto                              |
| `status`      | string           | ✅ Sì      | Opzionale | `backlog`, `in_progress`, `in_review`, `blocked`, `done` |
| `validation`  | object \| null   | Opzionale | Opzionale | `null` oppure oggetto (vedi sotto)     |

In `--update` i campi omessi restano invariati (merge), ma un campo **presente** deve comunque
essere valido: `{"title":""}` viene rifiutato. Un payload `{}` viene rifiutato. I campi
sconosciuti sono rifiutati in entrambi i comandi.

#### Oggetto `validation` (quando non `null`)

| Campo      | Tipo   | Obbligatorio | Valori validi             |
|------------|--------|-------------|---------------------------|
| `criteria` | string | ✅ Sì        | Non vuoto                 |
| `state`    | string | ✅ Sì        | `unknown`, `pass`, `fail` |

### Errori

In caso di errore lo script esce con `exit 1` e stampa `{"ok":false,"error":"<messaggio>","code":"<CODE>"}`.
Il campo `code` è stabile: usalo per la logica, il `messaggio` è per la lettura umana.

| `code`           | Quando                                                                          |
|------------------|-----------------------------------------------------------------------------------|
| `INVALID_ID`     | `--issue-id` non è un GUID valido                                                |
| `INVALID_STATUS` | `status` con valore fuori da `backlog`, `in_progress`, `in_review`, `blocked`, `done` |
| `INVALID_STATE`  | `validation.state` fuori da `unknown`, `pass`, `fail`                           |
| `INVALID_INPUT`  | campo sconosciuto, campo obbligatorio mancante o vuoto, payload `{}` in `--update`, `page-size` < 1 |
| `INVALID_JSON`   | il payload non è JSON valido                                                    |
| `NOT_FOUND`      | nessuna issue con l'id indicato                                                 |
| `FILE_NOT_FOUND` | `--issue-data-file` inesistente, oppure `issues.json` mancante                  |
| `MISSING_ARGS`   | flag richiesto assente, o `--issue-data` e `--issue-data-file` passati insieme  |
| `UNKNOWN_COMMAND`| nessun comando riconosciuto (vedi `--help`)                                     |
| `FORBIDDEN_ROLE` | con `HARNESS_ROLE=worker`, tentativo di impostare `status=done` o `validation.state=pass` (self-validation vietata al ruolo worker) |

## Help

Per visualizzare l'help dello script:
```bash
node issue-manager.mjs --help
```
