# Revisioni atomiche e compare-and-set delle issue

Data: 2026-08-21

Questa spec sviluppa la prima direzione P0 selezionata in
[`2026-08-20-deepseek-harness-spunti.md`](../analisi/2026-08-20-deepseek-harness-spunti.md):
impedire che due agenti sovrascrivano in silenzio stati della stessa issue letti in momenti
diversi. Non importa il runtime di DeepSeek Harness e non cambia gli invarianti di harness. Il
tracker resta Markdown, `issue-manager.mjs` resta il solo writer, la verifica resta indipendente e
la pubblicazione resta subordinata al `pass`.

La modifica è il primo lavoro della release `1.1.0`. La direzione successiva — criteri immutabili
e storico dei tentativi di verifica — dipende da questo contratto, ma resta fuori scope.

## Problema

Oggi `--update` esegue una sequenza read–merge–write. `writeIssue` rende atomica la sostituzione del
singolo file tramite file temporaneo e rename, ma non rende atomico il confronto fra lo stato letto
e quello scritto. Due processi possono quindi:

1. leggere entrambi la stessa checklist;
2. spuntare due task diversi nelle proprie copie;
3. scrivere entrambi con successo;
4. lasciare nel tracker soltanto l'ultimo aggiornamento.

Il file non è corrotto e ogni comando esce `0`: la perdita è costosa e invisibile. Lo stesso
problema esiste quando delete o compact agiscono su un record che è cambiato dopo che il chiamante
lo ha scelto.

## Decisioni

Le decisioni sono state prese nel brainstorming del 20–21 agosto 2026, in quest'ordine.

1. **Il CAS copre tutte le mutazioni di issue esistenti.** `--update`, `--delete` e ogni issue
   consumata da `--compact` richiedono la revisione letta dal chiamante. `--insert` crea un nuovo
   record e `--upgrade` è una migrazione amministrativa: usano il lock, ma non ricevono una
   revisione attesa.
2. **La revisione attesa è obbligatoria.** Non esiste una modalità compatibile “last write wins”,
   un warning, `--force` o un fallback silenzioso.
3. **La revisione non fa parte del patch.** I comandi a bersaglio singolo ricevono
   `--expected-revision <n>`; compact riceve riferimenti strutturati. `revision` è un campo
   automatico come `id` e `updated_at`.
4. **La baseline è 1 e la compatibilità è progressiva.** Un record precedente senza campo viene
   letto come revisione logica `1`; l'upgrade lo materializza; la prima mutazione riuscita lo
   scrive direttamente a `2`.
5. **L'atomicità usa un lock transazionale di progetto.** Le mutazioni sono serializzate per il
   breve intervallo read–compare–validate–write. Un lock per issue o uno storage a revisioni
   immutabili aggiungerebbero complessità senza un beneficio utile per comandi locali di pochi
   millisecondi.

## Modello dati

L'oggetto issue guadagna:

```json
{
  "revision": 1
}
```

`revision` è un intero positivo e monotono per la vita del record. Una nuova issue e una nuova
issue-blocco prodotta da compact nascono a `1`. Ogni mutazione logica riuscita di una issue
esistente consuma lo stato `n` e produce `n + 1` una sola volta, indipendentemente dal numero di
file scritti o rinominati internamente.

Il campo viene serializzato nel frontmatter Markdown e compare negli oggetti restituiti da
`--get`, `--get-all`, `--dump`, `--insert` e `--update`. Un record senza campo viene normalizzato
a `1` nella superficie della CLI senza essere riscritto da una lettura. Un campo presente che non
sia un intero positivo è storage invalido e produce `INVALID_REVISION`; non viene reinterpretato
come baseline.

`revision` non è ammesso in `--issue-data` né all'insert né all'update. Permetterlo darebbe al
chiamante il controllo del token che deve proteggerlo.

`SCHEMA_VERSION` passa da `4` a `5` e la migrazione `4 → 5` aggiunge `revision: 1` dove manca.

## Contratto della CLI

### Update e delete

```text
node issue-manager.mjs --update --issue-id <id> --expected-revision <n> \
  (--issue-data <json> | --issue-data-file <path>)

node issue-manager.mjs --delete --issue-id <id> --expected-revision <n>
```

`--update` restituisce l'issue completa con `revision: n + 1`. `--delete` non conserva una
tombstone, ma la risposta rende esplicita la revisione finale consumata:

```json
{ "id": "<guid>", "deleted": true, "revision": 6 }
```

La revisione finale di delete non è riutilizzabile: l'identità non esiste più nel tracker.

### Compact

Ogni blocco sostituisce `issue_ids` con `issues`, perché un id senza lo stato letto non basta più:

```json
{
  "blocks": [
    {
      "title": "…",
      "description": "…",
      "issues": [
        { "id": "<guid>", "expected_revision": 3 },
        { "id": "<guid>", "expected_revision": 8 }
      ]
    }
  ]
}
```

Il vecchio `issue_ids` viene rifiutato come campo non riconosciuto: accettarlo senza revisioni
riaprirebbe esattamente il percorso non protetto che questa release elimina. La risposta conserva
`archivePath`, `removed` e `blocks`, e aggiunge il risultato delle issue consumate:

```json
{
  "consumed": [
    { "id": "<guid>", "revision": 4 },
    { "id": "<guid>", "revision": 9 }
  ]
}
```

L'archivio conserva lo stato che è stato confrontato, alla revisione `n`; `consumed` registra la
transizione finale a `n + 1`. La nuova issue-blocco è una nuova identità e nasce a revisione `1`.

### Errori

| Codice | Quando | Scritture |
|---|---|---|
| `MISSING_ARGS` | manca `--expected-revision` su update/delete, oppure manca una revisione in compact | nessuna |
| `INVALID_REVISION` | revisione attesa o memorizzata non è un intero positivo | nessuna |
| `REVISION_CONFLICT` | la revisione attesa non coincide con quella corrente | nessuna |
| `TRACKER_BUSY` | un'altra mutazione mantiene il lock oltre l'attesa massima | nessuna |

`REVISION_CONFLICT` vale per qualunque disuguaglianza, non soltanto per `expected < current`: una
revisione futura indica comunque che il chiamante non sta nominando lo stato presente. Il messaggio
riporta id, revisione attesa e revisione corrente; il codice è la superficie stabile.

L'ordine dei rifiuti è definito. Forma degli argomenti, JSON e ruolo vengono controllati prima di
acquisire il lock. Sotto lock si leggono i bersagli e si confrontano tutte le revisioni. Soltanto
dopo un CAS riuscito si eseguono i controlli semantici che dipendono dal tracker — DAG, dipendenti,
stato e decomposizione. Un input sintatticamente valido ma stantio riceve quindi il conflitto prima
di un eventuale errore semantico calcolato su uno stato che non aveva letto.

## Lock transazionale

Un nuovo modulo focalizzato, `scripts/tracker-lock.mjs`, possiede il lock; non conosce issue,
revisioni o payload. `issue-manager.mjs` lo usa per tutti i comandi mutanti: init, insert, update,
delete, compact e upgrade. `issue-store.mjs` resta il codec e il writer dei singoli record.

Il lock è `.harness/issue-manager.lock`, creato con apertura esclusiva (`wx`). Il contenuto porta:

```json
{
  "pid": 12345,
  "created_at": "<datetime>",
  "token": "<random>"
}
```

L'acquisizione ritenta ogni 50 ms per un massimo di 5 secondi. Se il proprietario è vivo, il lock
non viene mai sottratto. Se il PID non esiste più, il file è abbandonato e può essere rimosso prima
di ritentare. Un file appena creato ma ancora vuoto o parziale riceve una grazia di 5 secondi;
scaduta la grazia viene trattato come abbandonato. Su Windows un controllo del PID che risponde
“accesso negato” conta come processo vivo, non come permesso di sottrarre il lock.

Il rilascio avviene in `finally` e rimuove il file soltanto se il token su disco coincide ancora
con quello del proprietario. Un processo in ritardo non può quindi cancellare il lock acquisito da
un successore.

Le letture restano lock-free: `--get`, `--get-all`, `--dump` e status non devono creare file in un
progetto privo di tracker. Il singolo record resta sempre atomico grazie a temp + rename. Una
lettura dell'intero tracker può osservare per pochi millisecondi una compact o una migrazione a
metà, come già accade oggi; non può però trasformare quella vista in una scrittura stantia, perché
la mutazione successiva rilegge e confronta sotto lock.

## Flussi delle mutazioni

### Update

1. Parsa e valida forma, ruolo e revisione attesa.
2. Acquisisce il lock.
3. Rilegge la singola issue e normalizza l'eventuale revisione assente a `1`.
4. Confronta; sul conflitto esce senza scrivere.
5. Applica merge e guard esistenti sullo stato corrente.
6. Imposta `revision: n + 1` e il nuovo `updated_at`.
7. Scrive atomicamente il file e rilascia il lock.

Due update concorrenti con la stessa revisione attesa non possono entrambi riuscire: il secondo
entra nella sezione critica dopo che il primo ha scritto e vede il nuovo valore.

### Delete

Delete confronta la revisione prima di controllare i dipendenti, poi verifica il grafo sullo
snapshot letto sotto lock. Su successo rimuove il file e restituisce `n + 1`. Non introduce
tombstone né permette il riuso dell'id.

### Compact

Compact acquisisce un solo lock per l'intero batch. Prima di scrivere un byte:

1. verifica forma, unicità e appartenenza ai blocchi di tutti i riferimenti;
2. legge tutte le issue e confronta tutte le revisioni;
3. verifica stato `done`, dipendenze vive e resto del contratto esistente;
4. serializza in memoria archivio, blocchi e risposta.

Un solo riferimento stantio annulla tutto il batch. Su successo l'ordine di sicurezza resta
archivio, nuovi blocchi, rimozione delle issue originali; il lock impedisce a un'altra mutazione di
intercalarsi fra questi passi.

### Insert, init e upgrade

Insert non ha uno stato precedente da confrontare: crea `revision: 1` sotto lo stesso lock che
protegge collisioni e scrittura. Init usa il lock per rendere atomico il controllo “tracker già
presente”. Upgrade usa il lock per impedire mutazioni mentre riscrive più record, ma non richiede
revisioni attese dal chiamante.

## Migrazione e compatibilità

Il nuovo script legge tracker Markdown schema 4 senza riscriverli. Una revisione assente viene
esposta come `1` in ogni risposta, così un chiamante può leggerla e usarla subito nel CAS.

`--upgrade` viene esteso ai tracker Markdown, non soltanto al vecchio `issues.json`:

1. acquisisce il lock;
2. legge, normalizza e serializza tutte le issue in memoria;
3. rifiuta prima delle scritture se un record non è rappresentabile;
4. aggiunge `revision: 1` soltanto ai record che non la portano;
5. conserva revisioni presenti, `created_at`, `updated_at` e ogni altro campo;
6. scrive `schema_version: 5` nella config per ultima, se la config esiste.

La materializzazione della baseline non è una mutazione di dominio: non cambia `updated_at` e non
produce `revision: 2`. Un crash può lasciare alcuni record col campo e altri senza; entrambi
rappresentano logicamente `1`, e rieseguire upgrade completa il lavoro. Quando tutte le issue sono
materializzate e la config è a 5, un secondo upgrade è no-op byte per byte.

Se `schema_version` manca su storage Markdown, la versione effettiva è `4` quando almeno una issue
non porta `revision`, `5` quando tutte la portano o il tracker è vuoto. Questa inferenza vale per
la migrazione; evita che l'assenza storica della config impedisca di materializzare il nuovo campo.
Una config che dichiara 5 ma incontra un campo ancora assente tratta il record come residuo
recuperabile di una migrazione interrotta e lo completa al successivo upgrade.

I tracker legacy `issues.json` attraversano in ordine anche la migrazione `4 → 5` prima di essere
scritti in Markdown. Gli archivi esistenti restano storia congelata e non vengono riscritti.

La compatibilità è all'indietro, non in avanti: harness 1.1 legge e aggiorna tracker precedenti;
una copia 1.0 non conosce il CAS e non deve essere usata dopo l'upgrade. Le note di rilascio e il
controllo della copia installata devono chiedere aggiornamento del plugin e nuova sessione prima di
mutare un tracker schema 5.

## Componenti toccati

- `scripts/tracker-lock.mjs` — acquisizione, attesa, recupero e rilascio del lock.
- `scripts/issue-manager.mjs` — schema 5, revisione, contratto CLI, CAS e flussi mutanti.
- `scripts/issue-store.mjs` — round-trip del nuovo campo attraverso il codec esistente; nessuna
  logica CAS.
- `scripts/harness-worker.mjs` e `agents/harness-verifier.md` — leggere la revisione corrente e
  passarla a ogni update.
- `skills/harness/SKILL.md` e reference/skill operative pertinenti — prescrivere che ogni
  mutazione parta dalla revisione appena letta e documentare conflitto e retry.
- test di manager, store, worker, verifier e struttura del plugin.
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json` —
  versione `1.1.0`, insieme e alla fine.

Status e docs-gate consumano `--dump`: ricevono il nuovo campo ma non devono mostrarlo né usarlo.
La revisione è controllo di scrittura, non informazione da aggiungere al riepilogo umano.

## Gestione del conflitto da parte degli agenti

`REVISION_CONFLICT` non viene ritentato ripetendo lo stesso payload. Il chiamante deve:

1. rileggere la issue;
2. ricostruire il proprio cambiamento sopra lo stato corrente;
3. rieseguire i guard locali necessari;
4. inviare il nuovo patch con la revisione appena letta.

Per le checklist questo significa preservare i task già spuntati da altri e applicare soltanto il
proprio avanzamento. Un merge automatico cieco riprodurrebbe il lost update un livello più in alto
e resta vietato.

`TRACKER_BUSY` è diverso: nessuno stato è stato confrontato. Il chiamante può ritentare il comando
dopo una nuova lettura; non deve cancellare manualmente un lock che dichiara un processo vivo.

## Testing

I test vengono scritti prima dell'implementazione che soddisfano e usano soltanto tracker
temporanei. Il tracker reale di questo repository non è mai una fixture.

### Contratto e migrazione

- insert nasce a revisione 1; get, get-all e dump espongono il campo;
- una issue senza campo viene letta come 1 senza cambiare byte;
- una revisione zero, negativa, frazionaria o stringa viene rifiutata;
- upgrade Markdown 4→5 materializza la baseline, conserva timestamp e revisioni esistenti, timbra
  la config per ultima ed è idempotente a byte;
- upgrade da ogni schema legacy attraversa la nuova migrazione in modo deterministico;
- la prima mutazione di una issue senza campo, attesa 1, produce revisione 2.

### CAS e assenza di scritture

- update riuscito incrementa esattamente una volta e restituisce il valore;
- expected mancante o invalida produce il codice previsto;
- update e delete stantii lasciano ogni file del progetto byte per byte invariato;
- compact con un solo riferimento stantio non crea archivio, non rimuove issue e non scrive
  blocchi;
- compact riuscito restituisce tutte le revisioni consumate e crea blocchi a revisione 1;
- errori di ruolo, DAG o decomposizione rilasciano sempre il lock.

### Concorrenza reale

Una prova avvia due processi `issue-manager` con la stessa revisione attesa e due aggiornamenti di
checklist differenti. Esattamente uno esce 0 e porta la issue a revisione 2; l'altro esce 1 con
`REVISION_CONFLICT`. Il file finale contiene il cambiamento del vincitore e non una combinazione
silenziosa. Il perdente rilegge, riapplica il proprio task e riesce con revisione 2, producendo
revisione 3 e conservando entrambi gli avanzamenti.

Test separati coprono attesa su lock vivo, `TRACKER_BUSY`, recupero di un lock con PID terminato,
grazia per un lock incompleto e controllo del token al rilascio. Le prove devono girare su Windows
e sugli host Unix della CI senza dipendenze native.

### Gate finale

Il gate resta quello di `.harness/config.json`: `npm run test`. La verifica indipendente controlla
inoltre che la spec sia stata committata prima del codice, che i tre manifest dicano `1.1.0` e che
nessun chiamante interno conservi una mutazione priva di revisione attesa.

## Fuori scope

- storico append-only dei tentativi di verifica e criteri immutabili;
- lock distribuiti fra macchine o filesystem remoti;
- API server, database, event sourcing o runtime agente parallelo;
- merge automatico dei payload in conflitto;
- tombstone e riuso degli id cancellati;
- mostrare revisioni nel riepilogo o nella statusline;
- lock per issue e scritture lock-free basate su file immutabili;
- modificare gli invarianti di self-validation, 1-WIP o pubblicazione dopo il `pass`.

Il risultato di questa spec è più stretto: ogni stato leggibile di una issue ha un token, ogni
mutazione nomina esattamente il token letto e il tracker impedisce che due scritture concorrenti
affermino entrambe di derivare dallo stesso stato.
