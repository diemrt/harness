# ISSUES.md

Questo documento descrive come gestire le issues del progetto utilizzando lo script `issue-manager.ps1`.

## Introduzione

Le issues vengono memorizzate in `issues.json` e gestite tramite lo script PowerShell `issue-manager.ps1`. **Non modificare il file `issues.json` direttamente**; usa sempre lo script per mantenere la consistenza dei dati.

## Comandi di base

### Leggere le issue in backlog (default, prima pagina)
```powershell
.\issue-manager.ps1 -getAll
```

### Leggere issue per stato specifico
```powershell
.\issue-manager.ps1 -getAll -status in_progress
```

### Leggere una singola issue
```powershell
.\issue-manager.ps1 -get -issueId <id>
```

### Creare una nuova issue
```powershell
# payload da file: nessun escaping di quote da gestire
.\issue-manager.ps1 -insert -issueDataFile .\new-issue.json

# oppure inline
.\issue-manager.ps1 -insert -issueData '{"title":"...","description":"...","status":"backlog","validation":{"criteria":"...","state":"unknown"}}'
```

L'id della issue creata si legge da `.data.id` della risposta, non dal testo del messaggio:

```powershell
$id = (.\issue-manager.ps1 -insert -issueDataFile .\new-issue.json | ConvertFrom-Json).data.id
```

### Aggiornare una issue (es. chiuderla)

`-update` fa **merge**: i campi omessi mantengono il valore attuale. Per chiudere una issue basta
inviare `status` e `validation`, senza rileggerla prima con `-get`.

```powershell
.\issue-manager.ps1 -update -issueId <id> -issueData '{"status":"done","validation":{"criteria":"<evidenza>","state":"pass"}}'
```

Un `"validation": null` **esplicito** azzera la validazione; ometterlo la lascia invariata.

### Eliminare una issue
```powershell
.\issue-manager.ps1 -delete -issueId <id>
```

## Paginazione (IMPORTANTE)

`-getAll` è **paginabile**. Utilizza i seguenti parametri per navigare:

- `-page <numero>`: Numero di pagina (default: 0, base 0; valori negativi trattati come 0)
- `-pageSize <numero>`: Numero di issue per pagina (default: 10; deve essere > 0)
- `-order <asc|desc>`: Ordine di ordinamento (default: asc)
- `-status <stato>`: Filtra per stato (default: backlog)

### Esempi con paginazione

```powershell
# Pagina 0 (primo set di 10 issue, default)
.\issue-manager.ps1 -getAll

# Pagina 1 (secondo set di 10 issue)
.\issue-manager.ps1 -getAll -page 1

# Pagina 0 con 20 issue per pagina
.\issue-manager.ps1 -getAll -pageSize 20

# Issue in_progress, pagina 2, 15 per pagina
.\issue-manager.ps1 -getAll -status in_progress -page 2 -pageSize 15

# Issue ordinate in descending, prima pagina
.\issue-manager.ps1 -getAll -order desc
```

### Output JSON

`-getAll` restituisce nel campo `data`:
- `totalCount`: Numero totale di issue (filtrate per status se applicabile)
- `page`, `pageSize`: la pagina richiesta
- `issues`: Array della pagina richiesta (sempre un array, anche con 0 o 1 elementi)

Usa `totalCount` e `pageSize` per calcolare il numero totale di pagine: `ceil(totalCount / pageSize)`.
Una pagina oltre la fine restituisce `issues: []`.

## Contratto di output (per agenti)

Su stdout lo script emette **sempre una sola riga JSON**, sia in caso di successo che di errore.
`-help` è l'unica eccezione (testo semplice). Su stderr non viene scritto nulla.

```jsonc
// successo — exit code 0
{"ok":true,"data":<payload>}

// errore — exit code 1
{"ok":false,"error":"<messaggio>","code":"<CODE>"}
```

Quindi `.\issue-manager.ps1 ... | ConvertFrom-Json` funziona in entrambi i casi, e il campo `ok`
(o l'exit code) distingue l'esito:

```powershell
$r = .\issue-manager.ps1 -get -issueId <id> | ConvertFrom-Json
if (-not $r.ok) { "fallito: $($r.code)" } else { $r.data.title }
```

Il `data` restituito per comando:

| Comando   | `data`                                                |
|-----------|-------------------------------------------------------|
| `-get`    | l'oggetto issue                                       |
| `-getAll` | `{ totalCount, page, pageSize, issues: [...] }`       |
| `-insert` | l'oggetto issue creato (con `id` valorizzato)         |
| `-update` | l'oggetto issue aggiornato                            |
| `-delete` | `{ id, deleted }`                                     |

### Passare il payload

| Parametro              | Uso                                                          |
|------------------------|--------------------------------------------------------------|
| `-issueDataFile <path>`| Legge il JSON da file — nessun escaping di quote nella shell |
| `-issueData '<json>'`  | JSON inline; mutuamente esclusivo con `-issueDataFile`       |

## Campi della issue

Una issue ha i seguenti campi (schema canonico):

```json
{
  "id": "<guid>",
  "title": "<string>",
  "description": "<string>",
  "status": "backlog|in_progress|blocked|done",
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

### Campi gestiti automaticamente dallo script

| Campo        | Quando viene impostato                          |
|--------------|-------------------------------------------------|
| `id`         | Insert — GUID generato automaticamente          |
| `created_at` | Insert — timestamp corrente                     |
| `updated_at` | Insert e Update — timestamp corrente            |

**Non includere mai `id`, `created_at` o `updated_at` nel payload fornito allo script.**

### Campi richiesti nel payload (`-insert` / `-update`)

| Campo         | Tipo             | `-insert` | `-update` | Valori validi                          |
|---------------|------------------|-----------|-----------|----------------------------------------|
| `title`       | string           | ✅ Sì      | Opzionale | Non vuoto                              |
| `description` | string           | ✅ Sì      | Opzionale | Non vuoto                              |
| `status`      | string           | ✅ Sì      | Opzionale | `backlog`, `in_progress`, `blocked`, `done` |
| `validation`  | object \| null   | Opzionale | Opzionale | `null` oppure oggetto (vedi sotto)     |

In `-update` i campi omessi restano invariati (merge), ma un campo **presente** deve comunque
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
|------------------|---------------------------------------------------------------------------------|
| `INVALID_ID`     | `-issueId` non è un GUID valido                                                 |
| `INVALID_STATUS` | `status` con valore fuori da `backlog`, `in_progress`, `blocked`, `done`        |
| `INVALID_STATE`  | `validation.state` fuori da `unknown`, `pass`, `fail`                           |
| `INVALID_INPUT`  | campo sconosciuto, campo obbligatorio mancante o vuoto, payload `{}` in `-update`, `pageSize` < 1 |
| `INVALID_JSON`   | il payload non è JSON valido                                                    |
| `NOT_FOUND`      | nessuna issue con l'id indicato                                                 |
| `FILE_NOT_FOUND` | `-issueDataFile` inesistente, oppure `issues.json` mancante                     |
| `MISSING_ARGS`   | flag richiesto assente, o `-issueData` e `-issueDataFile` passati insieme       |
| `UNKNOWN_COMMAND`| nessun comando riconosciuto (vedi `-help`)                                      |

## Help

Per visualizzare l'help dello script:
```powershell
.\issue-manager.ps1 -help
```
