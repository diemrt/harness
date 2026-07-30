# Board delle issue

Il board è una pagina che mostra le issue del progetto e si aggiorna **da sola** quando
`issues.json` cambia: apri il browser una volta all'inizio della sessione e lo vedi muoversi
mentre il lavoro procede.

Non è un file nel progetto. È un server locale avviato dal plugin, che serve la pagina dal
plugin e i dati dal progetto corrente: nel repository non finisce nessun HTML.

## Comando

`$SCRIPTS` = `${CLAUDE_PLUGIN_ROOT}/scripts`.

```bash
node "$SCRIPTS/board-server.mjs" [--project-dir <path>] [--port <n>]
```

Non ci sono sottocomandi: lo script avvia e basta, e si ferma uccidendo il suo `pid`. Un flag
che non sia `--project-dir` o `--port`, o un positional, viene **rifiutato** con
`UNKNOWN_ARGUMENT` — inventarsi uno `--stop` non ferma niente, e prima che lo script fosse
severo avviava un secondo server. Un flag che lo script dichiara ma usato male (`--port` senza
valore) è un errore diverso: non hai inventato niente, e il code lo dice, `INVALID_ARGUMENT`.

Il progetto è risolto come per gli altri script del plugin: **default la directory corrente
del processo**, `--project-dir` come override esplicito quando non controlli la cwd. Se lo
ometti partendo dalla cartella sbagliata ottieni un board vuoto del progetto sbagliato, senza
nessun errore: il campo `projectDir` nella riga di avvio è lì per accorgertene subito.

Il processo resta in esecuzione: avvialo **in background**. All'avvio stampa una riga JSON e
poi tace:

```json
{"ok":true,"data":{"url":"http://127.0.0.1:53124/","port":53124,"pid":31284,"projectDir":"..."}}
```

Prendi `url` da lì e mostralo all'utente **una volta sola**; `pid` serve per fermarlo al
clock-out. Con `--port` omesso la porta la sceglie il sistema operativo: non c'è una porta
fissa da ricordare e due progetti aperti insieme non si pestano i piedi. Se passi una porta
occupata, l'avvio fallisce con `PORT_IN_USE` invece di restare a metà.

| `code` | Quando |
|---|---|
| `UNKNOWN_ARGUMENT` | un flag che lo script non dichiara, o un positional inatteso |
| `INVALID_ARGUMENT` | un flag dichiarato ma usato male (es. `--port` senza valore) |
| `FILE_NOT_FOUND` | `--project-dir` non esiste |
| `PORT_IN_USE` | la porta richiesta è occupata |
| `ERROR` | errore imprevisto all'avvio |

## Ciclo di vita

- **Avvio** — al clock-in, automaticamente. Il server ascolta su `127.0.0.1` su una porta
  libera scelta a runtime.
- **URL** — stampalo **una volta sola**, quando parte. Non aprire il browser da solo: rubare
  il focus a ogni sessione è più fastidioso di un click.
- **Aggiornamento** — il server osserva `issues.json` e spinge il refresh al browser. Nessun
  reload manuale, nessun polling da parte tua.
- **Stop** — al clock-out. Non lasciare processi orfani a fine sessione.

## Cosa non fa

- Non scrive niente nel progetto.
- Non è raggiungibile dall'esterno: il socket è su `127.0.0.1`.
- Non serve file arbitrari: solo la pagina, `api/issues` ed `events`. Tutto il resto è 404,
  compreso `issues.json` chiesto per path.
- Non è un'interfaccia di modifica: le issue si cambiano con la CLI
  ([issues.md](issues.md)), così ogni scrittura passa dalle stesse validazioni.

## Dipendenze della pagina

La pagina carica Tailwind, daisyUI e Lucide **da CDN**: senza rete si apre ma non si
presenta. È un trade-off scelto consapevolmente — la coerenza con la UI storica del progetto
vale più dell'indipendenza dalla rete — non una svista. In `proposals/board-minimal.html`
c'è una UI alternativa senza dipendenze esterne, congelata in attesa di decidere se
vendorizzare le librerie o cambiare interfaccia.

I dati invece non passano mai da fuori: `api/issues` legge il file locale e basta.

## Payload di `api/issues`

```json
{"projectDir": "...", "issues": [...], "lastUpdated": "...", "project": null}
```

`issues` e `lastUpdated` rispecchiano `issues.json` (schema in [issues.md](issues.md)).
`project` è il campo `project` di `issues.json` quando presente e non vuoto, altrimenti
`null` — è il caso del seed minimo scritto oggi dal plugin. La pagina lo usa per il titolo e
ripiega sul nome della cartella (`projectDir`) solo quando è `null`. Se il file esiste ma non
è leggibile (lettura a metà di una scrittura), il payload aggiunge `error` e gli altri campi
tornano vuoti (`issues: []`, `lastUpdated: null`, `project: null`).

## Se un progetto non ha `issues.json`

Il board mostra un tracker vuoto e non crea niente. Quando il file compare — al primo
`--insert` — il watcher se ne accorge e la pagina si popola da sola.
