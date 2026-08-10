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
creato). Il file nasce al **primo `--insert`**, oppure di proposito con `--init` (sotto).

## `schema_version`

`issues.json` può portare, in cima e accanto a `last_updated`, la chiave `schema_version`: la
versione dello schema descritto in questa pagina. Lo script conosce la propria versione tramite
la costante `SCHEMA_VERSION` (oggi `1`).

- **chiave assente = versione 0, e il file si legge lo stesso.** Nessun comando cambia
  comportamento in base a questa chiave, nessun progetto va aggiornato per continuare a
  funzionare — stessa scelta già fatta per `tier` e per `depends_on`.
- **il writer preserva quello che trova.** Se il file ha `schema_version`, ogni scrittura
  (`--insert`, `--update`, `--delete`, `--compact`) lo riscrive identico; se non ce l'ha, non lo
  aggiunge. Solo `--init` (file nuovo) e `--upgrade` (file già presente) scrivono deliberatamente
  quel campo. Né `--insert` né `--update` fanno mai la migrazione al posto tuo. `--compact` non
  lo scrive nemmeno lui: lo **legge** per timbrarlo sull'archivio, così l'archivio dice sotto
  quale schema erano scritte le issue che porta.

## Comandi

```bash
# leggere: backlog (default), o uno stato specifico
# attenzione: la prima riga NON e' l'intero tracker, e' solo il backlog. --get-all senza
# --status non toglie il filtro, lo fissa su backlog: per vedere tutto va interrogato ogni
# stato (vedi "Stato del tracker" in commands/issue.md) o letto issues.json direttamente.
node "$SCRIPTS/issue-manager.mjs" --get-all
node "$SCRIPTS/issue-manager.mjs" --get-all --status in_progress

# singola issue
node "$SCRIPTS/issue-manager.mjs" --get --issue-id <id>

# creare (payload da file: nessun escaping di quote da gestire)
node "$SCRIPTS/issue-manager.mjs" --insert --issue-data-file ./new-issue.json
node "$SCRIPTS/issue-manager.mjs" --insert --issue-data '{"title":"...","description":"...","status":"backlog","validation":{"criteria":["...","..."],"state":"unknown"}}'

# aggiornare (merge: i campi omessi restano invariati)
node "$SCRIPTS/issue-manager.mjs" --update --issue-id <id> --issue-data '{"status":"done","validation":{"criteria":"<evidenza>","state":"pass"}}'

# eliminare (rifiutato finché altre issue la dichiarano in depends_on)
node "$SCRIPTS/issue-manager.mjs" --delete --issue-id <id>

# operare su un altro progetto
node "$SCRIPTS/issue-manager.mjs" --get-all --project-dir /path/to/project

# creare issues.json di proposito, col seed minimo (rifiuta se il file esiste già)
node "$SCRIPTS/issue-manager.mjs" --init

# portare issues.json allo schema corrente
node "$SCRIPTS/issue-manager.mjs" --upgrade

# archiviare le done gia' raggruppate a monte e sostituirle coi blocchi
node "$SCRIPTS/issue-manager.mjs" --compact --issue-data-file ./blocks.json
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

## `--init`

Crea `issues.json` nella directory del progetto (default cwd, o `--project-dir`) col seed
minimo:

```json
{ "schema_version": 1, "last_updated": "<datetime>", "issues": [] }
```

`schema_version` vale la costante `SCHEMA_VERSION` dello script (oggi `1`).

**Se il file esiste già, rifiuta con `ALREADY_EXISTS` e non scrive niente** — il file
preesistente resta identico byte per byte. Nessun flag di conferma o `--force`: un `--init` che
sovrascrive è un `--init` che cancella un tracker vivo, e chi vuole ripartire da zero rimuove il
file a mano, esplicitamente.

`data`: `{ path, created: true }`.

## `--upgrade`

Porta `issues.json` dal proprio `schema_version` (assente = versione `0`) a `SCHEMA_VERSION`,
eseguendo solo le migrazioni comprese fra le due versioni. La logica vive in una **lista
ordinata** di migrazioni interna allo script, ognuna con la versione che produce (`to`); si
applicano solo quelle con `to` maggiore della versione del file e non superiore a
`SCHEMA_VERSION`. La migrazione `0 → 1` materializza `depends_on: []` dove la chiave manca.

- **aggiunge soltanto:** ogni migrazione mette il default sui campi nuovi, non tocca i valori
  esistenti e non rimuove niente. Un campo deprecato lo cancella l'utente, quando decide di
  cancellarlo;
- **idempotente:** un file già a `SCHEMA_VERSION` risponde `ok:true` con `migrated: 0` e **non
  viene riscritto** — il file resta identico byte per byte, anche a `--upgrade` lanciato più
  volte di fila;
- **un file a versione superiore a `SCHEMA_VERSION`** viene rifiutato con `SCHEMA_TOO_NEW` e non
  scrive niente: è uno script vecchio davanti a dati più nuovi di lui, e riscriverli
  degraderebbe quello che lo schema più recente porta;
- **mai automatico:** né `--insert` né `--update` eseguono una migrazione al posto tuo — restano
  a leggere e scrivere `schema_version` così come lo trovano (vedi sopra). L'upgrade è
  un'azione esplicita.

```bash
node "$SCRIPTS/issue-manager.mjs" --upgrade
```

`data`: `{ from, to, migrated }`, con `migrated` il numero di issue **effettivamente toccate**
dalle migrazioni applicate (un'issue toccata da più migrazioni nello stesso giro conta una
volta sola).

## `--compact`

Rimpicciolisce `issues.json` senza perdere lo storico: le issue chiuse che gli vengono nominate
escono dal tracker, finiscono **intere** in un archivio, e al loro posto resta una issue per
blocco che le riassume e dice dove sono andate.

**È una primitiva: non decide i raggruppamenti.** Sapere che due issue chiuse parlano dello
stesso argomento è giudizio, e il giudizio sta a monte — i blocchi arrivano già decisi nel
payload. `--compact` esegue e basta.

```json
{
  "blocks": [
    { "title": "…", "description": "…", "issue_ids": ["<guid>", "<guid>"] }
  ]
}
```

Il payload si passa come per gli altri comandi (`--issue-data` o, meglio, `--issue-data-file`).
`title` e `description` di un blocco rispettano gli **stessi limiti** di qualunque altra issue
(80 / 1200 caratteri): un blocco diventa una issue come le altre.

**Cosa viene rifiutato, e in che ordine.** Ogni controllo gira *prima* che venga scritto un solo
byte, quindi **un rifiuto non lascia niente dietro di sé**: né `issues.json` toccato, né
l'archivio, né la directory `.harness/`.

1. `HARNESS_ROLE=worker` → `FORBIDDEN_ROLE`. Il controllo è il primo e non guarda nemmeno il
   payload: ogni blocco che questo comando scrive è un record `done` / `pass`, che è esattamente
   la mossa che il guard anti-self-validation esiste per impedire.
2. forma del payload: campo sconosciuto, `blocks` assente o vuoto, blocco senza `issue_ids` o con
   `issue_ids: []`, `title`/`description` vuoti → `INVALID_INPUT`; oltre i limiti →
   `LIMIT_EXCEEDED`; id che non è un GUID → `INVALID_ID`. Lo stesso id in due blocchi (o due
   volte nello stesso) → `INVALID_INPUT`: l'originale viene rimosso e sostituito una volta sola,
   due riassunti dello stesso lavoro non possono essere entrambi veri.
3. contro il tracker: id che non esiste → `NOT_FOUND`; issue che **non è `done`** →
   `INVALID_STATUS`. Solo il lavoro chiuso si riassume.
4. una issue **viva** (che resta nel tracker) dichiara in `depends_on` uno degli id da
   archiviare → `INVALID_DEPENDENCY`, **elencando gli id che puntano**. È la stessa semantica di
   `--delete`: far puntare quei riferimenti al blocco muterebbe issue che il chiamante non ha
   nominato. Chi compatta scollega prima. Una dipendenza fra due issue archiviate **nello stesso
   giro** non è un ostacolo: se ne va con loro.

**L'archivio.** Su successo gli oggetti issue originali vengono scritti **interi e identici a
com'erano** — nessuna normalizzazione, i campi sconosciuti a questa versione dello script
compresi — in:

```
<progetto>/.harness/archive/<timestamp>.json
```

```json
{ "schema_version": <n>, "archived_at": "<datetime>", "issues": [ /* gli originali */ ] }
```

`schema_version` è quello che il tracker dichiarava al momento dell'archiviazione (assente vale
`0`): l'archivio **si autodescrive**, così chi lo riapre fra sei mesi non deve indovinare quale
schema stava leggendo. Il nome del file è il timestamp del giro con i `:` sostituiti da `-`
(illegali in un nome di file su Windows); due compattazioni nello stesso secondo prendono un
suffisso numerico invece di sovrascriversi.

L'archivio finisce in `.harness/`, e **se versionarlo lo decide il progetto**: harness non
scrive nessun `.gitignore`, né qui né altrove ([config.md](config.md)). Vale la pena deciderlo
invece di ereditarlo, perché `issues.json` è condiviso e ogni blocco porta il path
dell'archivio che ne contiene gli originali: tenere quel file fuori dal repository significa
lasciare a chi clona un puntatore verso il nulla.

La scrittura avviene in quest'ordine — archivio, poi `issues.json` — così un errore a metà non
lascia mai il tracker senza la copia.

**L'archivio non viene mai riletto.** Non è un secondo tracker: `--get`, `--get-all` e il board
continuano a vedere **solo** `issues.json`. Un `--get` su una issue archiviata risponde
`NOT_FOUND`. È storia congelata, e il blocco che la sostituisce ne porta il path.

**La issue blocco** viene inserita con `status: "done"`, `validation.state: "pass"`,
`depends_on: []` e `tier: null`. I suoi `validation.criteria` sono l'evidenza della
compattazione: il path dell'archivio (relativo al progetto — `issues.json` è condiviso nel
repository, un path assoluto di un clone non significherebbe niente in un altro) e una riga
`id + titolo` per ogni issue coperta.

`data`: `{ archivePath, removed, blocks: [ { id, title, archivedCount } ] }`, con `archivePath`
assoluto (il chiamante può aprirlo subito) e `removed` il numero di issue tolte da `issues.json`.

Il giro che `--compact` **non** fa — leggere le `done`, proporre i blocchi, farli confermare — è
il comando `/harness:compact`, che poi chiama questa primitiva col payload confermato.

## Paginazione

`--get-all` è paginato:

- `--page <n>` — base 0, default 0 (valori negativi trattati come 0)
- `--page-size <n>` — default 10, deve essere > 0
- `--order <asc|desc>` — default asc
- `--status <stato>` — default `backlog`

Nel `data` tornano `totalCount`, `page`, `pageSize` e `issues` (sempre un array). Pagine
totali = `ceil(totalCount / pageSize)`; una pagina oltre la fine torna `issues: []`.
`totalCount` è calcolato **dopo** il filtro di stato, incluso quello di default: non è un
conteggio del tracker intero, è un conteggio della fetta filtrata.

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
| `--init` | `{ path, created: true }` |
| `--upgrade` | `{ from, to, migrated }` |
| `--compact` | `{ archivePath, removed, blocks: [ { id, title, archivedCount } ] }` |

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
  "tier": "economy|standard|reasoning",
  "depends_on": ["<guid>"],
  "validation": { "criteria": ["<string>"], "state": "unknown|pass|fail" },
  "created_at": "<datetime>",
  "updated_at": "<datetime>"
}
```

`validation` può essere `null` (nessun criterio definito: vedi la verifica leggera in
[SKILL.md](../SKILL.md)).

**`tier`** dichiara quanto costa il lavoro della issue, così chi dispatcha legge un dato invece
di ridedurlo dalla description: `economy`, `standard`, `reasoning`. È opzionale e può essere
`null` — assente vale `standard`. Un `null` esplicito in `--update` lo azzera: è un **hint**, e
un tier rimasto indietro dopo un cambio di scope va corretto, non conservato. La mappatura su
modello e reasoning effort sta in [SKILL.md](../SKILL.md), non nei dati.

**`depends_on`** elenca le issue che devono chiudersi **prima** di questa: l'arco va dalla
dipendenza alla issue che la dichiara, non il contrario. È sempre un array — assente vale `[]`,
e `[]` esplicito ripulisce le dipendenze — così chi legge il tracker cammina un grafo diretto
senza dover distinguere fra chiave mancante e lista vuota. Le issue scritte prima del campo non
hanno la chiave e restano leggibili e aggiornabili: il primo `--update` la materializza, come è
già successo con `tier`.

A differenza di `tier` e `validation`, `null` **non** è un valore ammesso: "nessuna dipendenza"
si scrive già `[]`, e una seconda grafia obbligherebbe a indovinare quale delle due è
memorizzata. Non c'è nessun tetto al numero di dipendenze: una dipendenza è un fatto del grafo,
non testo libero, e un limite spingerebbe a cancellare un arco vero per far passare il payload.

Il grafo è **aciclico per costruzione**: la CLI rifiuta con `INVALID_DEPENDENCY` un id
inesistente, la self-reference, un duplicato nell'array e qualsiasi payload che chiuderebbe un
ciclo (diretto o indiretto). È l'unico punto in cui il DAG viene difeso, ed è ciò che permette a
ogni lettore — board compreso — di darlo per acquisito. Per lo stesso motivo `--delete` di una
issue da cui altre dipendono viene rifiutata, elencando gli id che la puntano: sfilare l'id dai
loro record muterebbe issue che il chiamante non ha nominato. Chi cancella scollega prima.

**`depends_on` non blocca il lavoro.** La CLI non impedisce di portare `in_progress` una issue
con dipendenze aperte: l'unico guard di processo resta quello anti-self-validation
(`FORBIDDEN_ROLE`). Che si rispetti l'ordine della catena è una regola di workflow, e vive in
[SKILL.md](../SKILL.md) come ci vive il tier.

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
- e dev'essere controllabile **con gli accessi che il verificatore ha**: il suo ambiente è quello
  del worker, non di più. Un criterio che chiede di guardare un server irraggiungibile, una
  console web o un ambiente in linea non è verificabile — ed è un criterio scritto male, non un
  verificatore limitato. Si riformula su un artefatto che entra nel repository:
  [verification.md](verification.md);
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
| `tier` | string \| null | opzionale | opzionale | `economy`, `standard`, `reasoning`, oppure `null` |
| `depends_on` | array | opzionale | opzionale | id di issue esistenti; assente vale `[]`, `[]` ripulisce; niente self-reference, niente duplicati, niente cicli; `null` non è ammesso |
| `validation` | object \| null | opzionale | opzionale | `null` oppure `{ criteria, state: unknown\|pass\|fail }`; `criteria` array a `state: unknown`, stringa o array alla chiusura |

In `--update` i campi omessi restano invariati, ma un campo **presente** deve essere valido:
`{"title":""}` viene rifiutato, e così un payload `{}`. I campi sconosciuti sono rifiutati in
entrambi i comandi.

## Codici di errore

Il `code` è stabile: usalo per la logica, il messaggio è per gli umani.

| `code` | Quando |
|---|---|
| `INVALID_ID` | `--issue-id` non è un GUID valido, o un `issue_ids` di `--compact` non lo è |
| `INVALID_STATUS` | `status` fuori dai valori ammessi, o `--compact` su una issue che non è `done` |
| `INVALID_STATE` | `validation.state` fuori da `unknown`, `pass`, `fail` |
| `INVALID_TIER` | `tier` fuori da `economy`, `standard`, `reasoning` (un `null` esplicito è valido) |
| `INVALID_DEPENDENCY` | `depends_on` non è un array (`null` incluso), elemento non GUID, id duplicato, self-reference, id inesistente nel tracker, ciclo diretto o indiretto; oppure `--delete` di una issue da cui altre dipendono, o `--compact` di una issue da cui dipende una issue viva |
| `INVALID_INPUT` | campo sconosciuto, obbligatorio mancante o vuoto, payload `{}` in update, `page-size` < 1, `criteria` di forma sbagliata (stringa a `state: unknown`, array vuoto, elemento non stringa o vuoto); in `--compact` anche `blocks` assente/vuoto, blocco vuoto, stesso id in due blocchi |
| `LIMIT_EXCEEDED` | `title`, `description` o un criterio oltre il limite di caratteri, o più di 7 criteri (vale anche per `title`/`description` di un blocco di `--compact`) |
| `INVALID_JSON` | payload non JSON valido |
| `NOT_FOUND` | nessuna issue con quell'id |
| `FILE_NOT_FOUND` | `--issue-data-file` inesistente, o `--project-dir` che non esiste |
| `MISSING_ARGS` | flag richiesto assente, o `--issue-data` e `--issue-data-file` insieme |
| `UNKNOWN_COMMAND` | nessun comando riconosciuto (vedi `--help`) |
| `FORBIDDEN_ROLE` | con `HARNESS_ROLE=worker`, tentativo di impostare `status=done` o `validation.state=pass`, oppure qualunque `--compact` |
| `ALREADY_EXISTS` | `--init` quando `issues.json` esiste già: rifiutato, niente viene scritto |
| `SCHEMA_TOO_NEW` | `--upgrade` su un file con `schema_version` maggiore di `SCHEMA_VERSION`: rifiutato, niente viene scritto |

`FORBIDDEN_ROLE` è il guard tecnico contro la self-validation: un processo lanciato con
`HARNESS_ROLE=worker` non può chiudere la propria issue, può arrivare al massimo a
`in_review` / `unknown`. Per lo stesso motivo un worker non può lanciare `--compact`: ogni blocco
che quel comando scrive è un record `done` / `pass`.
