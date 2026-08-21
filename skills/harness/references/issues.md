# Tracker delle issue

Le issue vivono in `.harness/issues/`, **un file Markdown per issue**, e si gestiscono **solo**
tramite lo script del plugin. **Non modificare quei file a mano**: si perde la consistenza dei dati.

`$SCRIPTS` = `${CLAUDE_PLUGIN_ROOT}/scripts`.

## Dove stanno i file

Lo script vive nel plugin, i dati nel progetto. `.harness/issues/` viene risolto contro la
**directory del progetto**, mai accanto allo script:

- default: la directory corrente del processo;
- `--project-dir <path>`: override esplicito, quando non controlli la cwd.

Ogni issue sta in `<stato>-<primi 8 caratteri del suo id>.md`: frontmatter per tutti i campi,
corpo Markdown per il titolo e la `description`. Il codec e le scritture atomiche stanno in
`$SCRIPTS/issue-store.mjs`, e **`issue-manager.mjs` è l'unico che lo importa**: chi legge il
tracker — `status-cli.mjs`, `docs-gate.mjs`, chiunque altro — passa da `--dump`, mai dai file.
Un lettore in più di quel formato sarebbe un posto in più da correggere ogni volta che si muove.

**Lo stato apre il nome**, così un `ls` risponde alla domanda che uno si fa davvero — in che stato
sono le issue, e quante per stato — invece di mostrare venticinque stringhe esadecimali. L'ordine
alfabetico **raggruppa** per stato, non lo mette in ordine di workflow: un prefisso numerico che lo
facesse codificherebbe nel nome una gerarchia che nessuno ha deciso.

Il prezzo è che il path non è più una funzione del solo id: chi legge o cancella **cerca** il file,
chi scrive lo calcola da id e stato. Un cambio di stato quindi rinomina, e il nome nuovo viene
scritto **prima** che il vecchio sparisca: l'ordine opposto aprirebbe una finestra in cui un crash
non lascia nessun file, questo ne lascia due — e due file per un id fanno fallire ogni lettura con
`ID_COLLISION` che li nomina entrambi, invece di far scegliere a caso al lettore. Per lo stesso
motivo un nome il cui prefisso non combacia con lo `status` del frontmatter viene rifiutato: la
riga che si legge a colpo d'occhio non può essere quella che mente.

Un progetto senza tracker si legge come tracker vuoto (nessun errore, nessun file creato). La
directory nasce al **primo `--insert`**, oppure di proposito con `--init` (sotto).

## `schema_version`

Lo schema descritto in questa pagina è il `5`: lo storage resta un file Markdown per issue e ogni
record porta `revision`, un intero positivo e monotono. I record schema 4 senza campo leggono come
revisione logica `1` senza essere riscritti; `--upgrade` materializza il campo. Lo script conosce la propria versione tramite la costante
`SCHEMA_VERSION`.

La versione è dichiarata in `.harness/config.json`, come **prima chiave dell'oggetto**, dai due
comandi che la scrivono: `issue-manager --init` e `issue-manager --upgrade`. `harness-config.mjs`
non la scrive mai di suo — la **preserva** quando riscrive il file, perché `--init` lì ricostruisce
la configurazione da capo e una riscrittura che la perdesse farebbe leggere un tracker migrato come
uno mai timbrato.

- **chiave assente = versione corrente.** Un progetto già su storage Markdown ma senza config
  timbrata si legge come schema 4 se almeno una issue non porta `revision`, altrimenti schema 5: `.harness/issues/` esiste, e quello
  è il fatto. `--upgrade` la timbra quando la trova in disaccordo, e non riscrive niente quando è
  già giusta.
- **la config non viene creata da nessuno dei due comandi.** Se il progetto non ha
  `.harness/config.json`, `--init` e `--upgrade` non lo inventano: averla o no è una decisione del
  progetto, e `harness-config.mjs` è il comando che la prende.
- **`--compact` legge la versione, non la scrive**, per timbrarla sull'archivio: così l'archivio
  dice sotto quale schema erano scritte le issue che porta.

### Tracker legacy `issues.json`

Fino allo schema 3 il tracker era un solo file JSON alla radice del progetto. Un progetto ancora
in quello stato **non si legge**: ogni comando che tocca le issue rifiuta con
`STORAGE_NOT_MIGRATED` e dice di lanciare `--upgrade`, che è l'unico comando che quel tracker lo
accetta ancora (vedi `--upgrade` sotto). Nessun comando migra al posto tuo, e nessuno legge un
`issues.json` di nascosto.

## Comandi

```bash
# leggere: backlog (default), o uno stato specifico
# attenzione: la prima riga NON e' l'intero tracker, e' solo il backlog. --get-all senza
# --status non toglie il filtro, lo fissa su backlog: per vedere tutto si usa --dump, che non
# filtra e non pagina (vedi "Nessun argomento" in ../../issue/SKILL.md).
node "$SCRIPTS/issue-manager.mjs" --get-all
node "$SCRIPTS/issue-manager.mjs" --get-all --status in_progress

# singola issue
node "$SCRIPTS/issue-manager.mjs" --get --issue-id <id>

# tutto il tracker, senza filtri e senza pagine
node "$SCRIPTS/issue-manager.mjs" --dump

# creare (payload da file: nessun escaping di quote da gestire)
node "$SCRIPTS/issue-manager.mjs" --insert --issue-data-file ./new-issue.json
node "$SCRIPTS/issue-manager.mjs" --insert --issue-data '{"title":"...","description":"...","status":"backlog","validation":{"criteria":["...","..."],"state":"unknown"}}'

# aggiornare (merge: i campi omessi restano invariati)
node "$SCRIPTS/issue-manager.mjs" --update --issue-id <id> --expected-revision <n> --issue-data '{"status":"done","validation":{"criteria":"<evidenza>","state":"pass"}}'

# aggiornare la prosa dichiarando che la decomposizione in task regge ancora
node "$SCRIPTS/issue-manager.mjs" --update --issue-id <id> --expected-revision <n> --issue-data-file ./change.json --decomposition-unchanged

# eliminare (rifiutato finché altre issue la dichiarano in depends_on)
node "$SCRIPTS/issue-manager.mjs" --delete --issue-id <id> --expected-revision <n>

# operare su un altro progetto
node "$SCRIPTS/issue-manager.mjs" --get-all --project-dir /path/to/project

# creare .harness/issues di proposito (rifiuta se il tracker esiste già)
node "$SCRIPTS/issue-manager.mjs" --init

# portare un tracker issues.json legacy allo storage Markdown
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

## Revisioni, lock e conflitti

Ogni `--get`, `--get-all` e `--dump` restituisce `revision`. Prima di mutare, il chiamante legge
l'issue e passa esattamente quel valore con `--expected-revision`; `revision` non è ammesso nei
payload insert/update. `--update`, `--delete` e ogni riferimento di `--compact` sono compare-and-set.
Il manager serializza init, insert, update, delete, compact e upgrade con
`.harness/issue-manager.lock`; le letture restano lock-free.

Su `REVISION_CONFLICT` non ripetere il payload: rileggi, ricostruisci il solo cambiamento richiesto
sullo stato corrente, riesegui i guard locali e invia la nuova revisione. Su `TRACKER_BUSY` nessuno
stato è stato confrontato: rileggi e riprova, senza cancellare un lock vivo.

## Aprire una issue: cosa decide chi la apre

La CLI valida la **forma** del payload. Quello che rende una issue utile invece che ben formata
sta qui, e vale per chiunque chiami `--insert`: il comando `/harness:issue` come un agente che è
arrivato a questa pagina e chiama la primitiva direttamente. Scritto solo nel comando, questo giro
sarebbe invisibile al secondo, che è il lettore più frequente.

- **I criteri sono la parte che conta.** Si scrivono pensando a chi li leggerà: un altro agente,
  che non ha visto la conversazione e ha gli accessi del worker e nient'altro. Le due regole per
  scriverli sono in «Regole che la CLI non può misurare», più sotto.
- **Se la issue non merita criteri**, `validation` può essere `null` — ma solo nei quattro casi
  della verifica leggera elencati in [SKILL.md](../SKILL.md), e con la riga di motivazione che
  quel capitolo richiede nella `description`. Fuori da quei casi i criteri sono obbligatori.
- **Il `tier` si propone dicendo perché**, così chi dispatcha legge una decisione invece di
  rifarla. Omesso vale `standard`: è un default, non un dato mancante da riempire.
- **Il payload si mostra e si fa confermare prima di scriverlo.** Una issue sbagliata non rompe
  niente, e per questo resta: la si corregge quando è ancora testo in sessione, non dopo che è
  entrata nel tracker.
- **`LIMIT_EXCEEDED` non si risolve comprimendo il testo:** vedi «Cosa fare quando la CLI risponde
  `LIMIT_EXCEEDED`», più sotto.

Prima ancora: **se il lavoro meriti una issue** lo decide la bussola in [SKILL.md](../SKILL.md).
Questa pagina descrive come si scrive una issue, non se vada scritta.

## `--dump`

Restituisce **l'intero tracker**, senza filtro di stato e senza pagine, ordinato per id
crescente:

```json
{ "schema_version": 4, "issues": [ /* tutte */ ] }
```

È il comando con cui si legge il tracker dall'esterno: `status-cli.mjs` e `docs-gate.mjs` passano
di qui, e chiunque altro debba vedere tutte le issue fa lo stesso. **Nessuno legge i file
`.md` per conto proprio**: un lettore in più di quel formato è un posto in più da correggere
ogni volta che si muove, ed è la ragione per cui questo comando esiste invece di documentare il
layout.

`--get-all` resta il comando per una fetta sola — uno stato, una pagina — e il suo default su
`backlog` è il motivo per cui non serve a vedere tutto.

## `--init`

Crea `.harness/issues/` nella directory del progetto (default cwd, o `--project-dir`). La
directory nasce vuota: il tracker è l'insieme dei file dentro, e un tracker vuoto è una directory
senza file.

Se `.harness/config.json` **esiste già**, ci timbra `schema_version: SCHEMA_VERSION` come prima
chiave. **Non lo crea**: avere o no una configurazione è una decisione del progetto, e
`harness-config.mjs` è il comando che la prende.

**Se il tracker esiste già — Markdown o `issues.json` legacy — rifiuta con `ALREADY_EXISTS` e non
scrive niente.** Nessun flag di conferma o `--force`: un `--init` che sovrascrive è un `--init`
che cancella un tracker vivo, e chi vuole ripartire da zero rimuove i file a mano,
esplicitamente.

`data`: `{ path, created: true }`.

## `--upgrade`

Porta un progetto dal tracker `issues.json` legacy allo storage Markdown a `SCHEMA_VERSION`,
applicando per strada le migrazioni di campo comprese fra la versione che il file dichiara
(assente = versione `0`) e questa. La logica vive in una **lista ordinata** di migrazioni interna
allo script, ognuna con la versione che produce (`to`); si applicano solo quelle con `to`
maggiore della versione del file e non superiore a `SCHEMA_VERSION`. La migrazione `0 → 1`
materializza `depends_on: []` dove la chiave manca; la `1 → 2` fa lo stesso con `covers: []`; la
`2 → 3` con `tasks: []` e, sulle sole issue che hanno un oggetto `validation`,
`validation.tasks: []` — una `validation` a `null` non ne guadagna uno, perché non ci sarebbe
dove metterli. Lo schema `4` non aggiunge campi: **è il formato di storage**, e la migrazione
`3 → 4` è il travaso da un file JSON a un file per issue.

L'ordine di scrittura è: archivio, file delle issue, config, e **per ultima** la rimozione di
`issues.json`. È l'ordine che tiene ogni crash recuperabile — finché il file legacy c'è, sul
disco esiste una copia completa del tracker.

- **niente viene scritto** finché ogni issue non è stata migrata e serializzata in memoria e ogni
  short id controllato per collisioni: un record che il codec non sa rappresentare deve fermare
  la migrazione mentre il progetto è ancora intero, non a metà;
- **aggiunge soltanto:** ogni migrazione di campo mette il default sui campi nuovi, non tocca i
  valori esistenti e non rimuove niente;
- **l'originale non si perde:** `issues.json` viene copiato **verbatim** in
  `.harness/archive/upgrade-<timestamp>.json` prima di sparire. È lì che sopravvivono le chiavi
  radice che lo storage Markdown non ha dove mettere — `project`, `tags`, `status_legend`,
  `last_updated`;
- **idempotente:** un progetto già su storage Markdown risponde `ok:true` con `migrated: 0` e
  **non viene riscritto**, nemmeno di un byte, a `--upgrade` lanciato più volte di fila. La
  versione che un file JSON dichiara non lo rende storage Markdown: un `issues.json` che dichiara
  già `4` viene comunque travasato;
- **riprende un upgrade interrotto:** un progetto che ha **entrambi** gli storage popolati è
  quello che un crash lascia dietro di sé. `--upgrade` lo completa quando ogni issue Markdown è,
  campo per campo, una che questa migrazione avrebbe scritto; se una diverge o è sconosciuta al
  JSON, quelli sono due tracker veri e non una migrazione a metà, e rifiuta con
  `STORAGE_CONFLICT` senza scrivere niente. Ogni altro comando, davanti allo stesso stato,
  rifiuta con lo stesso codice e rimanda qui;
- **un file a versione superiore a `SCHEMA_VERSION`** viene rifiutato con `SCHEMA_TOO_NEW` e non
  scrive niente: è uno script vecchio davanti a dati più nuovi di lui, e migrarli contro uno
  schema che non conosce degraderebbe quello che lo schema più recente porta;
- **mai automatico:** né `--insert` né `--update` eseguono una migrazione al posto tuo, e nessun
  comando legge un `issues.json` di nascosto. L'upgrade è un'azione esplicita.

```bash
node "$SCRIPTS/issue-manager.mjs" --upgrade
```

`data`: `{ from, to, migrated, issues, archivePath, resumed }`. `migrated` conta le **issue
effettivamente toccate** da una migrazione di campo, non le modifiche fatte — un'issue toccata da
più migrazioni nello stesso giro conta una volta sola; `issues` quante ne ha il tracker dopo il
travaso; `archivePath` dove è finita la copia del file legacy; `resumed` se questo run ha
completato un upgrade interrotto da un altro.

**Le chiavi sono le stesse su ogni percorso.** Sul no-op — progetto già su storage Markdown —
`archivePath` è `null` e `resumed` è `false`, scritti, non omessi: un payload le cui chiavi
dipendono da quale ramo è girato costringe ogni chiamante a controllarne l'esistenza prima di
leggerle, e chi se ne dimentica legge `undefined` come se fosse un dato.

## `--compact`

Rimpicciolisce il tracker senza perdere lo storico: le issue chiuse che gli vengono nominate
escono dal tracker, finiscono **intere** in un archivio, e al loro posto resta una issue per
blocco che le riassume e dice dove sono andate.

Con un file per issue, «rimpicciolire» vuol dire **togliere file**: `--compact` cancella i `.md`
delle issue archiviate e ne scrive uno per blocco. Ogni altro file del tracker resta identico
byte per byte — non viene riscritto un tracker intero per una modifica che riguarda tre issue,
che è precisamente quello che il file JSON unico faceva a ogni comando.

**È una primitiva: non decide i raggruppamenti.** Sapere che due issue chiuse parlano dello
stesso argomento è giudizio, e il giudizio sta a monte — i blocchi arrivano già decisi nel
payload. `--compact` esegue e basta.

```json
{
  "blocks": [
    {
      "title": "…",
      "description": "…",
      "issues": [
        { "id": "<guid>", "expected_revision": 3 },
        { "id": "<guid>", "expected_revision": 7 }
      ]
    }
  ]
}
```

Il payload si passa come per gli altri comandi (`--issue-data` o, meglio, `--issue-data-file`).
`title` e `description` di un blocco rispettano gli **stessi limiti** di qualunque altra issue
(80 / 1200 caratteri): un blocco diventa una issue come le altre.

**Cosa viene rifiutato, e in che ordine.** Ogni controllo gira *prima* che venga scritto un solo
byte, quindi **un rifiuto non lascia niente dietro di sé**: né un file di issue toccato, né
l'archivio.

1. `HARNESS_ROLE=worker` → `FORBIDDEN_ROLE`. Il controllo è il primo e non guarda nemmeno il
   payload: ogni blocco che questo comando scrive è un record `done` / `pass`, che è esattamente
   la mossa che il guard anti-self-validation esiste per impedire.
2. forma del payload: campo sconosciuto, `blocks` assente o vuoto, blocco senza `issues` o con
   `issues: []`, `title`/`description` vuoti → `INVALID_INPUT`; oltre i limiti →
   `LIMIT_EXCEEDED`; id che non è un GUID → `INVALID_ID`; `expected_revision` deve essere un
   intero positivo. Lo stesso id in due blocchi (o due
   volte nello stesso) → `INVALID_INPUT`: l'originale viene rimosso e sostituito una volta sola,
   due riassunti dello stesso lavoro non possono essere entrambi veri.
3. contro il tracker: id che non esiste → `NOT_FOUND`; revisione cambiata →
   `REVISION_CONFLICT`; issue che **non è `done`** → `INVALID_STATUS`. Solo il lavoro chiuso si
   riassume.
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

L'archivio finisce in `.harness/archive/`, e **se versionarlo lo decide il progetto**: harness non
scrive nessun `.gitignore`, né qui né altrove ([config.md](config.md)). Vale la pena deciderlo
invece di ereditarlo, perché il tracker è condiviso e ogni blocco porta il path
dell'archivio che ne contiene gli originali: tenere quei file fuori dal repository significa
lasciare a chi clona un puntatore verso il nulla.

La scrittura avviene in quest'ordine — archivio, poi i file delle issue — così un errore a metà
non lascia mai il tracker senza la copia.

**L'archivio non viene mai riletto.** Non è un secondo tracker: `--get`, `--get-all`, `--dump` e
il riepilogo continuano a vedere **solo** `.harness/issues/`. Un `--get` su una issue archiviata
risponde `NOT_FOUND`. È storia congelata, e il blocco che la sostituisce ne porta il path.

**La issue blocco** viene inserita con `status: "done"`, `validation.state: "pass"`,
`depends_on: []`, `covers: []` e `tier: null`. I suoi `validation.criteria` sono l'evidenza della
compattazione: il path dell'archivio (relativo al progetto — il tracker è condiviso nel
repository, un path assoluto di un clone non significherebbe niente in un altro) e una riga
`id + titolo` per ogni issue coperta.

`data`: `{ archivePath, removed, consumed, blocks: [ { id, title, archivedCount } ] }`, con
`archivePath` assoluto (il chiamante può aprirlo subito), `removed` il numero di issue tolte dal
tracker e `consumed` gli id con la revisione consumata da ciascuna issue archiviata.

### Il giro che `--compact` non fa

La primitiva riceve i blocchi già decisi. Deciderli è il giro qui sotto, che `/harness:compact`
esegue e che **un agente arrivato da questa pagina deve poter eseguire lo stesso**: nominare il
giro senza descriverlo lo rendeva invisibile a metà dei suoi lettori.

1. **Leggere le `done` proiettando `id` e `title`.** `--get-all` restituisce l'oggetto issue
   intero — su questo repository 162.5KB per 88 issue — di cui il raggruppamento usa due campi.
   Senza proiezione il giro si strozza proprio sui tracker grandi, cioè dove compattare serve di
   più. L'elenco è paginato: `totalCount` dice se restano pagine da scorrere con `--page`, e la
   proiezione toglie campi, non issue.
2. **Raggruppare per argomento**, non per ordine cronologico e non un blocco per issue: sapere che
   due issue chiuse parlano dello stesso argomento è il giudizio che la primitiva non fa, ed è
   l'unica cosa che questo giro aggiunge. Meno di due issue `done` → non c'è niente da compattare.
3. **Far confermare il raggruppamento, esplicitamente, prima di chiamare la primitiva.** Un blocco
   scritto è un archivio da disfare a mano: si corregge la proposta finché non va bene, e si
   procede solo dopo un sì.
4. **Chiamare `--compact` col payload confermato**, passato con `--issue-data-file` per non dover
   gestire l'escaping delle quote nella shell.

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
| `--dump` | `{ schema_version, issues: [...] }` — tutto il tracker, per id crescente |
| `--insert` | l'issue creata (con `id`) |
| `--update` | l'issue aggiornata |
| `--delete` | `{ id, deleted, revision }` |
| `--init` | `{ path, created: true }` |
| `--upgrade` | `{ from, to, migrated, issues, archivePath, resumed }` |
| `--compact` | `{ archivePath, removed, consumed, blocks: [ { id, title, archivedCount } ] }` |

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
  "covers": ["<git-ref>"],
  "tasks": [{ "id": 1, "short_title": "<string>", "full_description": "<string>", "checked": false }],
  "validation": {
    "criteria": ["<string>"],
    "tasks": [{ "id": 1, "short_title": "<string>", "full_description": "<string>", "checked": false }],
    "state": "unknown|pass|fail"
  },
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
ogni lettore di darlo per acquisito. Per lo stesso motivo `--delete` di una
issue da cui altre dipendono viene rifiutata, elencando gli id che la puntano: sfilare l'id dai
loro record muterebbe issue che il chiamante non ha nominato. Chi cancella scollega prima.

**`depends_on` non blocca il lavoro.** La CLI non impedisce di portare `in_progress` una issue
con dipendenze aperte: l'unico guard di processo resta quello anti-self-validation
(`FORBIDDEN_ROLE`). Che si rispetti l'ordine della catena è una regola di workflow, e vive in
[SKILL.md](../SKILL.md) come ci vive il tier.

**`covers`** dichiara quali revisioni git quella issue copre. È **generale, non specifico della
documentazione**: qualunque issue può dichiarare di coprire una revisione, e il gate documentale
([docs-gate.md](docs-gate.md)) chiede soltanto che *qualcuno* la nomini. È sempre un array —
assente vale `[]`, `[]` esplicito ripulisce — e `null` **non** è ammesso, per lo stesso motivo di
`depends_on`: "nessuna revisione" ha già una grafia, e una seconda obbligherebbe a indovinare
quale delle due è memorizzata. Nessun tetto al numero di elementi.

La validazione è **volutamente lasca**: stringhe non vuote, niente duplicati, e nient'altro.
Harness non è una libreria git e non prova a riconoscere uno SHA valido — un riferimento sbagliato
semplicemente non risolve, e il gate lo **riporta come irrisolto** invece di ignorarlo. Una
validazione stretta rifiuterebbe tag e riferimenti simbolici legittimi per difendere da un errore
che si vede comunque.

**Quando si scrive.** All'`--insert`, mai dopo. Una issue non può registrare il **proprio** lavoro
mentre lo sta ancora facendo: i suoi commit non esistono nel momento in cui la issue si apre, e
inseguirli chiederebbe un update dopo ogni commit, cioè un altro passo dimenticabile. Una issue
docs invece nasce **dopo** i commit di codice che deve documentare: quegli SHA esistono già quando
la issue si apre. È questo che rende il campo praticabile invece che teorico, ed è anche perché è
un **array**: un tratto di lavoro sono più commit, non uno.

**`tasks` e `validation.tasks`** sono la **decomposizione** della prosa alla grana a cui l'agente
lavora: una voce per passo, `{ id, short_title, full_description, checked }`. `description` e
`validation.criteria` restano invariati e restano prosa — sono il registro con cui una issue
spiega a una persona cosa vuole e perché; i due array sono la stessa cosa all'altra grana, e
l'aggiornamento appaiato più sotto impedisce che divergano.

I task **indicizzano, non sostituiscono**: `full_description` porta quanto serve ad agire — il
comando, l'esito atteso, il riferimento al passo di piano — non l'analisi che ci sta dietro.
Il tracker è committato, condiviso e riletto a ogni comando, e ogni lettura lo paga: guadagna
l'avanzamento, non diventa il documento.

I **task di validazione stanno dentro `validation`**, non accanto: è lì che vive tutto ciò che
riguarda il giudizio, guard compreso, e tenerli fuori spargerebbe la stessa nozione in due punti
dello schema. Se `validation` è `null` — la verifica leggera di [SKILL.md](../SKILL.md) — non ci
sono task di validazione, e non c'è dove metterli.

Entrambi sono sempre array — assente vale `[]`, `[]` esplicito ripulisce — e `null` **non** è
ammesso, per lo stesso motivo di `depends_on` e `covers`. `id` è un intero positivo, unico dentro
il proprio array e stabile: è locale e ordinale, e un GUID lo renderebbe illeggibile nell'unico
contesto in cui si legge, dove il riferimento utile è «il task 4». **Nessun tetto al numero di
task**: la grana del livello sotto varia da progetto a progetto, e un limite spingerebbe ad
accorpare passi veri per far passare il payload.

**Quando si scrivono.** `validation.tasks` nascono **con la issue**, come i criteri: chi apre sa
cosa deve essere vero alla fine. `tasks` li materializza **chi prende la issue**, prima di
iniziare: è chi sa *come* arrivarci. La CLI lo impone — un `in_progress` con `tasks` vuoto viene
rifiutato con `INVALID_INPUT`, e nemmeno `--decomposition-unchanged` lo aggira.

Quel rifiuto è sulla **transizione**: garantisce che nessuna issue *entri* in `in_progress` senza
passi dichiarati. Non garantisce che non possa esserne svuotata dopo — per farlo servono un
`"tasks": []` esplicito e il flag, cioè due gesti deliberati di chi lo sta dichiarando a voce alta.
Un update qualunque a una issue già in volo senza task resta invece accettato: le issue scritte
prima del campo devono restare modificabili, o il tracker conterrebbe record che nessuno può più
toccare.

**Un `--update` che non nomina `validation.tasks` li conserva.** Il payload di chiusura è
`{criteria, state}`: senza questa regola ogni chiusura cancellerebbe la checklist che ha appena
giudicato. Per svuotarli si passa `"tasks": []` esplicito.

**Aggiornamento appaiato.** Un `--update` che modifica `description` senza toccare `tasks` — o il
contrario — viene rifiutato con `INVALID_INPUT`, e così per `validation.criteria` e
`validation.tasks`. Il flag `--decomposition-unchanged` dichiara che la decomposizione regge
ancora, ed è l'unica via d'uscita. È la stessa filosofia con cui la CLI difende il DAG dai cicli:
impossibile per costruzione, non sconsigliato a parole. Senza, la deriva sarebbe silenziosa e
peggiore dell'assenza dei task — il verificatore misurerebbe una cosa e l'umano ne leggerebbe
un'altra, e nulla lo direbbe.

Tre cose che il guard **non** rifiuta, e non sono eccezioni ma la sua definizione:

- **spuntare un task** non è una nuova decomposizione: il confronto guarda `id`, `short_title` e
  `full_description`, mai `checked`. L'allineamento prima di ogni commit non chiede mai il flag —
  se lo chiedesse, il flag verrebbe passato sempre e smetterebbe di significare qualcosa;
- **la prima materializzazione** non diverge da niente: una issue senza task non ha ancora una
  decomposizione da cui allontanarsi;
- **alla chiusura** (`state` `pass` o `fail`) `criteria` porta l'evidenza e non più il contratto:
  la regola vale solo finché `state` è `unknown`, altrimenti nessun verificatore potrebbe chiudere
  una issue senza il flag.

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
| `short_title` di un task | 60 caratteri |
| `full_description` di un task | 1200 caratteri |

La lunghezza si misura sulla stringa **trimmata**: uno spazio di padding non decide l'esito. I
limiti valgono su `--insert` e sui soli campi **presenti** in `--update` — il merge non
rivalida i campi omessi, quindi una issue scritta prima dei limiti resta aggiornabile.

I due limiti sui task valgono identici per `tasks` e per `validation.tasks`. `short_title` si
misura in **caratteri, non in parole**: il vincolo vero è che entri in una riga del riepilogo,
ed è ciò che il rendering misura davvero — contare parole è ambiguo fra lingue,
trattini e sigle. Il tetto di `full_description` è **generoso ma non assente**: abbastanza alto da
non mordere mai un indice, abbastanza basso da fermare un manuale. Vale anche qui la regola del
`LIMIT_EXCEEDED`: non dice «comprimi», dice «quel contenuto non è un task», e quasi sempre è un
passo del piano, che sta nel piano.

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
| `covers` | array | opzionale | opzionale | riferimenti git che la issue copre; assente vale `[]`, `[]` ripulisce; stringhe non vuote, niente duplicati; `null` non è ammesso |
| `tasks` | array | opzionale | opzionale | passi di esecuzione `{ id, short_title, full_description, checked }`; assente vale `[]`, `[]` ripulisce; `id` intero positivo e unico nell'array, `checked` booleano; `null` non è ammesso |
| `validation` | object \| null | opzionale | opzionale | `null` oppure `{ criteria, tasks, state: unknown\|pass\|fail }`; `criteria` array a `state: unknown`, stringa o array alla chiusura; `tasks` come sopra, e un `--update` che non li nomina li conserva |

In `--update` i campi omessi restano invariati, ma un campo **presente** deve essere valido:
`{"title":""}` viene rifiutato, e così un payload `{}`. I campi sconosciuti sono rifiutati in
entrambi i comandi.

`--update` accetta un flag suo, `--decomposition-unchanged`: dichiara che prosa e task descrivono
ancora gli stessi passi, e permette a uno dei due di muoversi senza l'altro. Non è una scorciatoia
per il resto — non aggira il rifiuto di `in_progress` senza task, e non tocca nessun'altra
validazione.

## Codici di errore

Il `code` è stabile: usalo per la logica, il messaggio è per gli umani.

| `code` | Quando |
|---|---|
| `INVALID_ID` | `--issue-id` non è un GUID valido, o un `issues[].id` di `--compact` non lo è |
| `INVALID_STATUS` | `status` fuori dai valori ammessi, o `--compact` su una issue che non è `done` |
| `INVALID_STATE` | `validation.state` fuori da `unknown`, `pass`, `fail` |
| `INVALID_TIER` | `tier` fuori da `economy`, `standard`, `reasoning` (un `null` esplicito è valido) |
| `INVALID_DEPENDENCY` | `depends_on` non è un array (`null` incluso), elemento non GUID, id duplicato, self-reference, id inesistente nel tracker, ciclo diretto o indiretto; oppure `--delete` di una issue da cui altre dipendono, o `--compact` di una issue da cui dipende una issue viva |
| `INVALID_INPUT` | campo sconosciuto, obbligatorio mancante o vuoto, payload `{}` in update, `page-size` < 1, `criteria` di forma sbagliata (stringa a `state: unknown`, array vuoto, elemento non stringa o vuoto); `tasks` o `validation.tasks` non array, voce malformata, `id` non intero positivo o duplicato, `checked` non booleano; `in_progress` con `tasks` vuoto; aggiornamento non appaiato di prosa e decomposizione; in `--compact` anche `blocks` assente/vuoto, blocco vuoto, stesso id in due blocchi |
| `LIMIT_EXCEEDED` | `title`, `description` o un criterio oltre il limite di caratteri, più di 7 criteri, `short_title` oltre 60 o `full_description` oltre 1200 caratteri (vale anche per `title`/`description` di un blocco di `--compact`) |
| `INVALID_JSON` | payload non JSON valido |
| `NOT_FOUND` | nessuna issue con quell'id |
| `FILE_NOT_FOUND` | `--issue-data-file` inesistente, o `--project-dir` che non esiste |
| `MISSING_ARGS` | flag richiesto assente, o `--issue-data` e `--issue-data-file` insieme |
| `UNKNOWN_COMMAND` | nessun comando riconosciuto (vedi `--help`) |
| `FORBIDDEN_ROLE` | con `HARNESS_ROLE=worker`, tentativo di impostare `status=done` o `validation.state=pass`, di spuntare una voce di `validation.tasks`, oppure qualunque `--compact` |
| `ALREADY_EXISTS` | `--init` quando un tracker esiste già: rifiutato, niente viene scritto |
| `SCHEMA_TOO_NEW` | `schema_version` dichiarato maggiore di `SCHEMA_VERSION`: rifiutato, niente viene scritto |
| `STORAGE_NOT_MIGRATED` | il progetto ha ancora il tracker `issues.json` legacy: ogni comando rifiuta, tranne `--upgrade` |
| `STORAGE_CONFLICT` | `issues.json` e issue Markdown popolati entrambi: un `--upgrade` interrotto, che `--upgrade` riprende se i due combaciano |
| `ID_COLLISION` | due issue che condividono gli otto caratteri del nome del file, o una sola issue trovata in due file — la rinomina di stato lasciata a metà |

`FORBIDDEN_ROLE` è il guard tecnico contro la self-validation: un processo lanciato con
`HARNESS_ROLE=worker` non può chiudere la propria issue, può arrivare al massimo a
`in_review` / `unknown`. Per lo stesso motivo un worker non può lanciare `--compact`: ogni blocco
che quel comando scrive è un record `done` / `pass`, e non può spuntare una voce di
`validation.tasks`: spuntare un criterio che misura il proprio lavoro è self-validation con
un'altra sintassi. I propri `tasks` di esecuzione li spunta eccome — quelli dicono a che punto è,
non se il lavoro va bene.
