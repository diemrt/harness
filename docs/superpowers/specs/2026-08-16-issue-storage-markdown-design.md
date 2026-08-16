# Le issue vivono in markdown, e lo script resta l'unico writer

Data: 2026-08-16

Chiude la domanda sullo storage che [analisi/2026-08-13-substrato-del-tracker.md](../analisi/2026-08-13-substrato-del-tracker.md) ha lasciato aperta e che [2026-08-13-ergonomia-emessa-design.md](2026-08-13-ergonomia-emessa-design.md) ha deliberatamente tenuto fuori scope. Quella spec ha risolto l'ergonomia *emettendo* markdown come proiezione di `issues.json`. Questa inverte la relazione: i file markdown **sono** il tracker. Non esiste più una fonte e una copia.

Non riapre beads, MCP, né il formato di comunicazione della CLI. Il canale resta JSON; cambia il mezzo su disco.

## Problema

Due fatti, già scritti, che insieme rendono `issues.json` il file sbagliato.

**È un monolitico committato.** Due catene che avanzano in parallelo confliggono su di lui. L'analisi del 13 agosto lo registra come difetto del substrato, non come impressione: «Chi ha uno storage a grana di cella questo problema non ce l'ha.»

**L'80% dell'uso dichiarato è leggere il dettaglio di una issue.** Titolo, descrizione, stato, criteri, task. Quello *è* un documento. Tenerlo serializzato in un array JSON e poi *emettere* i markdown (la strada del 13 agosto) dà il documento, al prezzo di un doppione da tenere allineato e di un `issues.json` che resta il punto caldo del merge.

La tentazione simmetrica — lasciare che l'agente editi i `.md` e ritirare i guard — è l'altra metà del problema. I guard (`FORBIDDEN_ROLE`, DAG aciclico, update appaiato, `in_progress` senza task) sono la tesi. Spostarli dalla scrittura al file «perché tanto è markdown» è Backlog.md: la struttura torna testo da riparsare, e gli errori che oggi sono impossibili tornano possibili.

## Cosa cambia, in una riga

Il tracker è `.harness/issues/<short-id>.md`. `issue-manager.mjs` è l'unico processo che apre quei file. Lo stdout della CLI, i guard e l'oggetto issue restano quelli di oggi. `--upgrade` è il ponte, una volta. Il plugin passa a `1.0.0`.

## Decisioni già prese, da non riaprire in implementazione

Prese in questa sessione, in quest'ordine. Un'implementazione che ne contraddice una sta facendo un'altra spec.

1. **Una sola fonte, niente doppione.** Sparisce `issues.json`. Sparisce `.harness/export/` come copia (e non viene costruito: `export-md.mjs` non esiste, e questa spec non lo introduce). I file in `.harness/issues/` *sono* il tracker.
2. **L'enforcement resta in scrittura.** Lo script è l'unico writer. Umani e agenti non editano i `.md`. Si guadagna il `git diff` per issue e il merge a grana di file, non un giro CLI in meno.
3. **Markdown lo parla solo `issue-manager`.** `status-cli.mjs` e `docs-gate.mjs` smettono di aprire lo storage e chiamano la CLI. `tracker-graph.mjs` non si tocca: è già puro.
4. **`--upgrade` è la migrazione, una volta.** Nessun dual-write, nessun dual-read oltre il riconoscimento che produce `STORAGE_NOT_MIGRATED`.
5. **`schema_version` va in `config.json`. `last_updated` sparisce.** Le chiavi extra di questo repository (`project`, `rules`, `status_legend`, `tags`) non sono schema: `--upgrade` le ignora, non le copia in config.
6. **Il corpo è solo prosa.** Frontmatter = il record intero (array e oggetti restano tali). Corpo = `# <title>` più la `description`. Niente checklist nel corpo.
7. **Lo stdout resta JSON, byte per byte sul contratto esistente.** Il cambio di canale è fuori da questa major. L'unico comando nuovo è `--dump`.

## Architettura

```
.harness/
  config.json          # setup, verify, docsGate, execution, externalWorker, schema_version
  issues/              # IL tracker: un file per issue
    <short-id>.md
  archive/             # come oggi: storia congelata, JSON di oggetti issue
  runs/
```

`issues.json` alla radice sparisce. Un progetto harness è uno che ha `.harness/issues/` — o, finché non ha lanciato `--upgrade`, un `issues.json` che 1.x rifiuta con `STORAGE_NOT_MIGRATED`. Né l'uno né l'altro: tracker vuoto, come oggi un repo senza file.

### L'oggetto issue non cambia

`id` resta un UUID intero (`randomUUID()`). `depends_on` punta a UUID interi. `--issue-id` accetta lo stesso GUID di oggi. I campi, i limiti, la semantica di `validation.criteria` rispetto a `state`, l'aggiornamento appaiato, il guard di ruolo: identici a [references/issues.md](../../../skills/harness/references/issues.md) alla data di questa spec.

Il nome del file è `shortId`: i primi 8 caratteri dell'`id`, già usati dal riepilogo (`663a70ae-48ba-…` → `663a70ae.md`). È derivato dall'`id` e non dal titolo, quindi non cambia quando il titolo cambia. Una collisione — due UUID che condividono il prefisso, all'insert o in lettura se il disco è stato toccato a mano — si rifiuta con `ID_COLLISION` nominando le due issue. Allungare lo slug in silenzio muterebbe path già committati.

### Il file di una issue

```markdown
---
id: 663a70ae-48ba-4e41-b48d-27af3dc7843b
title: "Il titolo, sempre quotato se serve"
status: done
tier: standard
depends_on: []
covers: []
tasks:
  - id: 1
    short_title: "…"
    full_description: "…\n…"
    checked: true
validation:
  criteria:
    - "…"
  tasks: []
  state: pass
created_at: "2026-08-12T10:00:00Z"
updated_at: "2026-08-12T11:00:00Z"
---

# Il titolo, sempre quotato se serve

Paragrafo della description.

Secondo paragrafo, separato da riga vuota.
```

**In lettura** il record si ricostruisce così: ogni campo strutturato — `title` compreso — viene dal frontmatter; la `description` è il corpo dopo l'eventuale H1 iniziale (l'H1 è la copia resa del titolo, non una seconda fonte). Se H1 e `title` divergono, vince il frontmatter: i file non si editano a mano, e una seconda fonte sarebbe un doppione nello stesso file.

**`validation: null`** si serializza come `null` YAML. Gli array vuoti restano array, non spariscono: è la stessa scelta già fatta per `depends_on` e `covers`.

### Il sottoinsieme YAML

Zero dipendenze, come il resto del plugin. Il parser e il serializer vivono in `scripts/issue-store.mjs`, importato **solo** da `issue-manager.mjs`. Non è un parser YAML: è il sottoinsieme che lo schema usa, e tutto il resto si rifiuta.

Ammesso:

- mapping e sequence in block style, indentati a 2 spazi;
- scalari: stringa, intero, booleano, `null`;
- stringhe double-quoted in stile JSON (`\n`, `\"`, `\\`) quando contengono `:`, `#`, newline, spazio in testa o in coda, o quando coincidono con `true` / `false` / `null` / un numero; altrimenti plain.

Rifiutato, con `INVALID_INPUT`, senza tentare un recupero: tag (`!!str`), ancore e alias (`&`, `*`), direttive (`%YAML`), merge (`<<:`), flow style annidato oltre le sequence di scalari (`depends_on`, `covers`).

Il serializer è l'inverso del parser: un oggetto issue prodotto da `--get` e riscritto produce, in lettura, un oggetto profondamente uguale. È il test che difende il criterio 1, e va scritto per primo sul modulo.

### Chi parla cosa

```
status-cli.mjs  ──spawn──►  issue-manager --dump  ──►  { schema_version, issues }
docs-gate.mjs   ──spawn──►  issue-manager --dump  ──►  (stesso envelope)
tracker-graph.mjs           (invariato: prende issues, restituisce dati)
issue-manager.mjs ──import──► issue-store.mjs ──► .harness/issues/*.md
```

`issue-store.mjs` classifica lo storage, elenca, legge, scrive e cancella i file. I guard, lo schema, i codici, l'envelope restano in `issue-manager.mjs`. Estrarlo non è eleganza: è tenere un file già a 1.706 righe dal diventare anche un parser.

`status-cli` e `docs-gate` **non** importano `issue-store`. Il confine «markdown lo parla solo `issue-manager`» è di processo, non di file: uno spawn, un envelope, niente YAML in un secondo posto.

## Flusso dei comandi

### Riconoscere lo storage

All'avvio `issue-manager` classifica il progetto, in quest'ordine, e poi non lo rivede. «Popolato» per il json significa: il file esiste. «Popolato» per la directory significa: esiste almeno un `*.md`. Una directory vuota accanto a un json è un `--upgrade` a metà, non un tracker 1.x.

| Cosa trova | Cosa fa |
|---|---|
| `.harness/issues/` esiste (anche vuota) e `issues.json` no | storage 1.x, procedi |
| `issues.json` esiste e la directory non è popolata | `STORAGE_NOT_MIGRATED` su ogni comando tranne `--upgrade` e `--help` |
| entrambi popolati | `STORAGE_CONFLICT` su ogni comando tranne `--upgrade` e `--help` |
| nessuno dei due | tracker vuoto, come oggi |

### `--dump`

Nessun filtro, nessuna pagina. `data` è `{ schema_version, issues: [...] }` — gli oggetti issue identici a quelli di `--get`, nello stesso ordine stabile di `--get-all` (per `id` crescente). Tracker vuoto → `issues: []`, exit 0.

È l'unico comando nuovo. `--get` e `--get-all` non si toccano: default `backlog` e pagina 10 restano, perché gli agenti e i comandi ci sono già sopra.

### `--init`

Su un tracker vuoto crea `.harness/issues/`. Se `config.json` esiste già, ci scrive `schema_version: 4` (le altre chiavi restano). Se non esiste, **non lo crea**: un `{ schema_version: 4 }` da solo farebbe credere al clock-in che la configurazione c'è, e il `verify` non verrebbe mai proposto. Finché la config manca, `schema_version` si legge come `0` — stessa regola della chiave assente. `data`: `{ path, created: true }` con `path` assoluto della directory `.harness/issues/`. È l'unico payload di successo che cambia forma.

`--init` con directory già esistente **o** con `issues.json` già presente resta `ALREADY_EXISTS`. Nessun `--force`.

### Scritture

`--insert` scrive un file nuovo; collisione di `short-id` → `ID_COLLISION`, niente file. `--update` rilegge quel file, fa il merge in memoria (stessi guard), riscrive atomicamente *quel* file (tmp nella stessa directory + `rename`). `--delete` lo rimuove, stessa regola sui dipendenti. Un crash a metà non tocca le altre issue: è il guadagno per cui si lascia il monolitico.

### `--compact`

Stessa primitiva, stesso payload, stesso ordine di rifiuto (ruolo, forma, tracker, grafo). Cambia solo il disco: archivio JSON *prima* (oggetti issue interi, `schema_version` letto da `config.json`; assente vale `0`), poi si cancellano i `.md` archiviati e si scrive il `.md` del blocco. L'archivio resta JSON e resta illeggibile da `--get`: è storia congelata, non un secondo tracker. Il formato dell'archivio non cambia — un export futuro può sempre materializzare i `.md` da lì.

Se muore dopo l'archivio e prima di cancellare i `.md`, al giro dopo quelle issue sono ancora nel tracker **e** nell'archivio. `--get` le vede ancora, non si è perso niente. Un secondo `--compact` sugli stessi id è lecito (l'archivio prende un suffisso, come oggi). Non si introduce un rollback automatico.

### `--upgrade`

`SCHEMA_VERSION` diventa `4`. `--upgrade` è due cose in sequenza, e solo lui le fa.

1. Migrazioni di *schema* sull'oggetto issue, come oggi (`0→1` `depends_on`, `1→2` `covers`, `2→3` `tasks`). Restano additive, sull'oggetto, indipendenti dal mezzo.
2. Poi la migrazione di *storage* (`3→4`): un `.md` per issue, `schema_version: 4` aggiunto a `config.json` **solo se quel file esiste già** (issue-manager non crea la config: un `{ schema_version: 4 }` da solo farebbe credere al clock-in che il `verify` sia stato scelto), cancellazione di `issues.json` **alla fine**, dopo che tutti i file esistono. Su uno storage già 1.x (niente json) la `3→4` non riscrive i `.md`: al più timbra la chiave in config e basta.

`--upgrade` è l'unico comando che *risolve* un conflitto di storage: se `issues.json` c'è, quello è la fonte, i `.md` si riscrivono da lì, il json si cancella alla fine. I file già scritti da un giro interrotto vengono sovrascritti, non fusi — un `--upgrade` a metà non è un tracker 1.x, è un json che sta ancora migrando. Ogni altro comando, sul conflitto, continua a rifiutare.

Un crash a metà lascia quindi json + directory popolata: `--get` e compagni rispondono `STORAGE_CONFLICT`; il `--upgrade` successivo completa e cancella il json. Idempotente: un secondo `--upgrade` a successo avvenuto è no-op a byte.

Altri rifiuti, invariati nella semantica:

- `SCHEMA_TOO_NEW` se `schema_version` (dal json, o da `config.json` su storage già 1.x *senza* json) è maggiore di `4`;
- no-op, niente scritto, `migrated: 0` se lo storage è già 1.x a versione `4` e il json non c'è.

Un plugin 0.7 davanti a uno storage 1.x non vede `issues.json` e legge un tracker vuoto. È il motivo del major, e va nelle note di rilascio. Non si mitiga con un dual-read.

### `schema_version` e `harness-config`

Oggi `harness-config --init` rifiuta le chiavi che non conosce e riscrive `config.json` enumerando solo `setup`, `verify`, `externalWorker`, `docsGate`, `execution`. Senza un cambio lì, il primo clock-in che «sistema» la config azzera lo schema e il tracker torna versione 0.

Quindi, in questa stessa major:

- `schema_version` entra nella whitelist di `validateConfigInput`;
- `initConfig` **preserva** la chiave se già presente e il payload non la nomina; se la chiave manca, un `--init` della config la semina a `4` (altrimenti un progetto configurato prima di avere un tracker resta a versione 0 per sempre);
- `issue-manager --init` / `--upgrade` la scrivono quando toccano un `config.json` già presente; non creano la config per mettercela;
- `docsGate.exclude` di default sostituisce `issues.json` con `.harness/issues/**` e aggiunge `.harness/archive/**` (una mutazione del tracker o un archivio non sono un commit di codice da documentare). `issues.json` resta comunque in exclude, così un json residuo dopo un upgrade a metà non diventa «codice».

`schema_version` assente si legge in due modi, e non sono lo stesso default: sul json vale `0` (come oggi); su uno storage 1.x vale `4`, perché il mezzo *è* la versione che l'ha introdotto. Senza questa distinzione un `--init` appena fatto, senza config, verrebbe letto come versione 0 e il primo `--upgrade` lo tratterebbe come un tracker preistorico. Non è un errore in nessuno dei due casi.

### `status-cli` e `docs-gate`

Spawnano `--dump`. Se l'envelope è `ok: false`:

- `status-cli --oneline` resta sul contratto invertito: riga vuota, exit 0, anche su `STORAGE_NOT_MIGRATED` / `STORAGE_CONFLICT`. Una statusline che urla a ogni refresh è peggio del silenzio — già deciso il 13 agosto.
- `status-cli` a schermo intero e `docs-gate` dicono l'errore e escono 1. Non sono una barra: sono invocati di proposito, e un conflitto di storage nascosto in un riepilogo vuoto è un tracker che sembra vuoto.

L'intestazione del riepilogo a schermo intero perde due dati che vivevano sulla radice di `issues.json`: `project` e `last_updated`. Il nome del progetto è il basename della directory (il fallback che `status-cli` usa già quando `project` manca). La riga «aggiornato \<data ora\>» sparisce: `last_updated` non esiste più, e ricalcolarlo come `max(updated_at)` sarebbe un dato nuovo spacciato per il vecchio. È l'unica differenza visibile del riepilogo; i conteggi, la 1-WIP e le allerte non cambiano.

## Errori

I codici esistenti non si rinominano e non cambiano significato. Se ne aggiungono tre.

| `code` | Quando | Cosa è stato scritto |
|---|---|---|
| `STORAGE_NOT_MIGRATED` | c'è `issues.json`, la directory non è popolata, e il comando non è `--upgrade` / `--help` | niente |
| `STORAGE_CONFLICT` | json e directory entrambi popolati | niente |
| `ID_COLLISION` | due issue condividono gli stessi 8 caratteri di `id` | niente |

`ID_COLLISION` non è `ALREADY_EXISTS`: quello resta «`--init` su un tracker che c'è già».

Cosa non è un errore nuovo:

- file `.md` in `.harness/issues/` il cui nome non è 8 hex, o il cui frontmatter non parsa, o il cui `id` non coincide col nome del file: `INVALID_INPUT` sul comando che lo incontra, nessuna scrittura. Non si ripara e non si salta in silenzio;
- `--dump` / `--get` / `--get-all` su tracker vuoto: successo, `issues: []`;
- plugin 0.7 davanti a un progetto 1.x: non è un codice, è un tracker vuoto.

`--get --issue-id` su un id il cui file è l'unico rotto fallisce su quel file senza dover validare gli altri. `--dump` e `--get-all` vedono tutti, e un solo file rotto fallisce l'elenco. Una pagina di backlog che omette una issue è peggio di un errore.

Niente warning su stderr. Niente codice distinto per «YAML malformato»: è forma, quindi `INVALID_INPUT`.

## Testing

La rete di sicurezza è il contratto JSON esistente, non una suite nuova che lo sostituisce. `test/plugin-issue-manager.test.mjs` resta la suite comportamentale: envelope, exit code, stderr vuoto, merge, limiti, DAG, ruolo, task, `--compact`, `--upgrade` di schema. Le asserzioni su `data` di `--get` / `--insert` / `--update` / `--delete` / `--compact` non si allentano.

Cambia il **seme**, non l'asserzione. `setupTempProject` smette di scrivere `issues.json` e materializza lo stesso seed come `.harness/issues/<short-id>.md` più `schema_version` in `config.json`. I test che oggi piantano di proposito un json (chiave assente, `SCHEMA_TOO_NEW`, `--init` su file esistente) restano sul json e diventano, o restano, test di migrazione / rifiuto.

Cose nuove, e vanno scritte prima del codice che le soddisfa:

- **`issue-store.mjs`** — round-trip: un oggetto issue con `validation` oggetto, `validation: null`, `tasks` non vuoti, `depends_on` non vuoto, `full_description` con newline e due punti, torna profondamente uguale. Un tag, un'ancora, un merge key vengono rifiutati. Nome file ≠ prefisso di `id` → rifiuto. Due issue con lo stesso prefisso → `ID_COLLISION`.
- **`--dump`** — tutti gli stati, nessuna pagina, `schema_version` presente, oggetti identici a N `--get`. Tracker vuoto → `issues: []`. File rotto nell'elenco → `INVALID_INPUT`, exit 1.
- **Classificazione** — i quattro casi della tabella, più directory vuota + json (`STORAGE_NOT_MIGRATED`, non conflitto).
- **`--upgrade` 3→4** — un temp project con `issues.json` a schema 3 produce un `.md` per issue e **nessun** `issues.json`. Se `config.json` c'era, guadagna `schema_version: 4` e nient'altro (niente `project` / `rules` / `tags` / `status_legend`). Se non c'era, la config non nasce. Un secondo `--upgrade` è no-op a byte. Crash simulato (directory già popolata + json ancora lì): `--get` → `STORAGE_CONFLICT`; `--upgrade` completa e cancella il json. Storage 1.x senza config: `schema_version` letto come `4`, `--upgrade` è no-op.
- **`harness-config`** — un `--init` successivo senza `schema_version` nel payload **non** la cancella. Un payload che la porta con un tipo non intero ≥ 0 viene rifiutato. `docsGate.exclude` di default contiene `.harness/issues/**` e `.harness/archive/**`.
- **`status-cli` / `docs-gate`** — non aprono più `issues.json`. Su `--dump` che fallisce: schermo intero e docs-gate escono 1; `--oneline` esce 0 con riga vuota. Intestazione senza «aggiornato» e senza `project`.
- **CI** — il passo `node scripts/issue-manager.mjs --get-all --page-size 1` resta: è già sul contratto che non cambia. Questo repository, a lavoro concluso, non ha più `issues.json`: il passo deve continuare a vedere le issue, quindi l'implementazione include l'`--upgrade` di *questo* tracker, via script, non a mano ([CLAUDE.md](../../../CLAUDE.md)).

I test si seminano in directory temporanee, come già fa la suite. Non si usa `issues.json` alla radice di questo repository come fixture, e non lo si riscrive per «provare» uno scenario.

## Versione, documentazione, branch

**Versione: `1.0.0`.** È il primo 1.x. `1.0.1` implicherebbe un `1.0.0` già pubblicato; non c'è. Si tocca alla fine del lavoro, insieme, in `.claude-plugin/plugin.json` e `.claude-plugin/marketplace.json` — sono gli unici due numeri di versione del repository.

**Perché è un major, detto chiaro.** Un plugin 0.7 davanti a un progetto 1.x legge un tracker vuoto. Un plugin 1.x davanti a un progetto 0.7 rifiuta ogni comando che non sia `--upgrade`. Non c'è dual-read che lo copra, ed è voluto. Le note di rilascio aprono con queste due frasi e col comando da lanciare (`node …/issue-manager.mjs --upgrade`).

**Documentazione che deve cambiare con il codice**, perché oggi nomina `issues.json` come *il* tracker:

- `skills/harness/SKILL.md` — trigger («quando il progetto contiene un `issues.json`»), capitolo «Cosa harness scrive nel progetto», frontmatter `description`;
- `skills/harness/references/issues.md` — intera: il file, `--init`, `--upgrade`, `--compact`, i path, la riga «non modificare a mano» (diventa «non modificare i `.md` a mano»);
- `skills/harness/references/config.md`, `status.md`, `docs-gate.md`, `git.md`;
- `README.md`, `AGENTS.md`, `CONTRIBUTING.md` nella misura in cui promettono «niente nel progetto tranne `issues.json`»;
- le `description` di `plugin.json` e `marketplace.json` (oggi promettono anche un «live issue board» già rimosso: si allineano in questo stesso tocco, perché si sta già riscrivendo la frase).

**Documentazione che non si tocca.** Spec, piani, approvazioni e analisi in `docs/` registrano cosa fu deciso allora. Gli archivi in `.harness/archive/` sono storia congelata. Le issue già `done` restano quel che erano: dopo l'`--upgrade` di questo repository sono file markdown con lo stesso oggetto.

**Branch.** Il lavoro vive fuori da `main`, su `feat/markdown-issue-storage`. Niente atterra sul ramo condiviso prima del `pass` del verificatore indipendente — è il workflow di questo repository, e vale anche per il cambio di storage.

## Fuori scope

- **Cambiare il formato di comunicazione della CLI.** JSON sullo stdout resta. I candidati veri a una 2.x sul canale, se mai, sono tre e vanno aperti solo con un difetto misurato: troppi spawn sulla statusline, envelope che non scala, un ospite che non digerisce JSON. Senza quel fatto, «forse non JSON» è estetica.
- **Far editare i `.md` a umani o agenti.** Contraddice la decisione 2.
- **`export-md.mjs`, `.harness/export/`, il grafo Mermaid.** Quella è la spec del 13 agosto, e resta una proiezione che questa forma rende *inutile* per l'80% (il dettaglio è già il file). Il Mermaid per le catene è un guadagno ancora vero e ancora fuori da qui.
- **Beads, MCP, un secondo backend.** Chiusi o aperti nel referto del 13 agosto; questa spec non li anticipa.
- **Copiare `project` / `rules` / `tags` / `status_legend` in `config.json`.** Non sono schema. Se un progetto ci teneva, li tiene altrove; harness non li possedeva.
- **Ricalcolare `last_updated`.** Sparisce.
- **Dual-read 1.x/0.7.** Il major esiste per non farlo.

## Relazione con la spec del 13 agosto

[2026-08-13-ergonomia-emessa-design.md](2026-08-13-ergonomia-emessa-design.md) ha fissato tre cose che questa spec eredita e una che inverte.

Eredita: emettere invece di servire; frontmatter = il record, mai semantica nella formattazione; `--oneline` col contratto invertito; zero dipendenze; harness non scrive `.gitignore`.

Inverte: quella spec teneva `issues.json` come fonte e i markdown come proiezione, *proprio per non migrare*. Il motivo era non anticipare la domanda sullo storage. La domanda è questa spec, e la risposta è migrare. Il principio «un file per issue, slug stabile, corpo = prosa» nasceva per un export consumabile da un sito; applicato alla fonte produce lo stesso file, senza il doppione.

`--oneline` e la rimozione del board non sono lavoro di questa spec: `--oneline` è già in `status-cli.mjs`, il board è già uscito dal plugin.
