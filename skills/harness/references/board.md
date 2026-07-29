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
- Non richiede rete: la pagina è autosufficiente, nessun CDN e nessun font remoto. Funziona
  con la macchina offline.

## Se un progetto non ha `issues.json`

Il board mostra un tracker vuoto e non crea niente. Quando il file compare — al primo
`--insert` — il watcher se ne accorge e la pagina si popola da sola.
