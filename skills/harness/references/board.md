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
che non sia `--project-dir` o `--port` viene **rifiutato** con `UNKNOWN_ARGUMENT` — inventarsi
uno `--stop` non ferma niente, e prima che lo script fosse severo avviava un secondo server. Un
flag che invece lo script dichiara ma che hai usato male — `--port` senza valore — esce con
`INVALID_ARGUMENT_VALUE`: sono due sbagli diversi e chiedono due correzioni diverse, e il `code`
è la parte del contratto su cui si ramifica.

Il progetto è risolto come per gli altri script del plugin: **default la directory corrente
del processo**, `--project-dir` come override esplicito quando non controlli la cwd. Se lo
ometti partendo dalla cartella sbagliata ottieni un board vuoto del progetto sbagliato, senza
nessun errore: il campo `projectDir` nella riga di avvio è lì per accorgertene subito.

**Il server canonicalizza la directory che riceve** (`realpathSync.native`), quindi `projectDir`
non è necessariamente la stringa che hai passato: un path 8.3 come `C:\Users\DIEGO_~1\...` torna
nella sua forma lunga, e un link simbolico nella sua destinazione. Il controllo resta quello —
guardare `projectDir` prima di annunciare l'URL — solo che si fa su un valore canonico: due
grafie dello stesso progetto danno la stessa risposta, ed è il punto. Se la normalizzazione non
riesce, il server parte lo stesso con il path che gli hai dato invece di rifiutarsi.

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
| `UNKNOWN_ARGUMENT` | un flag che lo script non dichiara, o un argomento posizionale |
| `INVALID_ARGUMENT_VALUE` | un flag dichiarato ma usato male: `--port` o `--project-dir` senza valore |
| `FILE_NOT_FOUND` | `--project-dir` non esiste |
| `PORT_IN_USE` | la porta richiesta è occupata |
| `WATCH_LOST` | la directory del progetto è sparita, o il watcher è fallito: il board non può più seguire il progetto |
| `ERROR` | errore imprevisto, all'avvio o dopo |

## Come ci si accorge che è morto

La riga di avvio non è più l'unica che il processo stampa. Se muore, lo **dichiara**, con lo stesso
envelope e sullo stesso stdout:

```json
{"ok":false,"error":"The project directory '…' is gone: the board cannot follow it any more.","code":"WATCH_LOST"}
```

Vale la pena sapere perché esiste. Il board è morto tre volte in una sessione — a 50, 25 e 16
minuti — lasciando ogni volta un URL annunciato come attivo e già morto, e nessuna traccia: la
diffidenza verso la pagina è nata lì. Un processo che muore in silenzio è peggio di uno che muore.

Due cose lo tengono in piedi, e una lo fa parlare quando non basta:

- **un browser che sparisce non lo abbatte.** Una scheda chiusa male, un portatile sospeso, una
  rete caduta lasciano una connessione che fallisce alla scrittura successiva invece di chiudersi
  prima: quel client viene semplicemente dimenticato;
- **la perdita della directory è una morte annunciata.** Se il progetto sparisce sotto il board,
  `fs.watch` non segnala un errore: continua a emettere eventi per un path che non c'è più, per
  sempre. Continuare a servire da lì significherebbe rispondere con un tracker che nessuno segue
  più — un dato stantio con l'aria di essere fresco — quindi il board lo dichiara ed esce;
- **il resto passa da un gestore di ultima istanza**, che annuncia l'eccezione non catturata con
  `code: "ERROR"` prima di uscire.

Se stai guardando la pagina e non si aggiorna più, la risposta è sullo stdout del processo: se lo
hai avviato in background redirigendo l'output, è in quel file.

## Ciclo di vita

- **Avvio** — **su richiesta, mai di iniziativa propria** (vedi «Perché non parte da solo» più
  sotto). Il server ascolta su `127.0.0.1` su una porta libera scelta a runtime.
- **URL** — stampalo **una volta sola**, quando parte, come URL nudo su una riga propria e
  senza decorazioni — niente code-span, niente link markdown, niente blocco di codice:

  ```
  http://127.0.0.1:53124/
  ```

  Non aprire il browser da solo: rubare il focus a ogni sessione è più fastidioso di un click.
- **Aggiornamento** — il server osserva `issues.json` e spinge il refresh al browser. Nessun
  reload manuale, nessun polling da parte tua.
- **Stop** — a fine sessione, se l'hai avviato. Non lasciare processi orfani.

### Il doppio click che resta

Un ctrl+click sull'URL stampato, in Claude Code su Windows Terminal, apre **due schede** sullo
stesso indirizzo invece di una. Non è un difetto di questo server: la riga stampata è una sola,
con un URL solo. La causa più probabile sono due rilevatori di link che insistono sullo stesso
testo — l'hyperlink OSC 8 che Claude Code emette e l'auto-detection sul testo grezzo che fa
Windows Terminal — e un click li innesca entrambi.

Il 2026-07-31 è stato fatto un giro manuale con l'utente per capire se cambiare la grafia
dell'URL bastasse: un click per forma, contando le schede aperte.

| forma provata | schede aperte al click |
|---|---|
| URL nudo su riga propria | 2 |
| code-span (`` `url` ``) | 2 |
| fenced code block | 2 |
| markdown link (`[testo](url)`) | 2 |

Le quattro forme aprono tutte due schede: l'ipotesi che fosse la forma di stampa a decidere è
**falsificata**. La causa sta fuori da quello che harness controlla — dentro Claude Code e
Windows Terminal — e nessuna riscrittura della riga stampata la aggira. Per questo la scelta fra
le quattro forme non è più "quale risolve il doppio click" (nessuna lo fa), ma "quale conviene
comunque tenere":

- **URL nudo su riga propria** — la forma prescritta sopra. È la più leggibile e la più facile
  da selezionare e copiare a mano quando il click non fa quello che ci si aspetta, ed è l'unico
  caso in cui la copia manuale serve davvero.
- Il **code-span** aggiunge una decorazione che in tutto il resto della documentazione di
  questo repository segna un comando da eseguire, non un indirizzo da aprire: userlo per l'URL
  confonderebbe le due cose senza guadagnare nulla contro il doppio click.
- Il **fenced code block** e il **link markdown** nascondono il testo nudo dietro a una cornice
  o a un'etichetta, rendendo la selezione manuale più scomoda proprio nel caso — il doppio
  click — in cui serve.

**Il problema non è risolto**: il doppio click resta, ed è fuori dal controllo di harness. Se
càpita, chiudi la scheda in più, oppure copia l'URL a mano dalla riga stampata invece di
cliccarci sopra.

## Perché non parte da solo

Fino al 2026-08-10 il clock-in prescriveva di avviarlo. Il primo progetto che ha usato harness
per un lavoro lungo ha fatto l'opposto, per iscritto, e con una misura.

In una sessione il processo del board è morto **tre volte** — dopo circa 50, 25 e 16 minuti.
Durate diverse, quindi non un timeout da configurare. Ogni volta ha lasciato in piedi un URL
annunciato come attivo e già morto. In una sessione successiva ha retto 55 minuti, fermato
deliberatamente al clock-out: **l'instabilità non è sistematica**, il che è la cosa peggiore,
perché non se ne può diffidare sempre.

Una causa di morte è nota e chiusa: `fs.watch()` su una directory in forma 8.3 non fallisce, fa
**abortire il processo** da dentro libuv (`!_wcsnicmp(filename, dir, dirlen)`,
`src\win\fs-event.c`). Dal 2026-08-10 il server canonicalizza la directory prima di osservarla e
quel modo di morire non c'è più. **Non spiega le tre morti qui sopra**, però: quell'abort scatta
alla prima scrittura su `issues.json`, non dopo 50 minuti di board funzionante. Resta quindi
almeno una causa non identificata, ed è quella che tiene in piedi le due regole.

Da cui le due regole che restano:

- **non avviarlo di iniziativa propria.** Se qualcuno lo chiede, avvialo e dillo.
- **non annunciare come attivo un URL che non sai vivo.** Un URL morto spacciato per vivo è
  peggio di nessun board: manda a sbattere chi si fida.

Il riepilogo testuale (`status-cli.mjs`, [status.md](status.md)) resta la fonte che non dipende
da nessun processo, ed è per questo che è lui, e non il board, il passo del clock-in.

## La card e i task

Ogni card riassume i **task** della issue in una riga per array — una barra da dieci celle e il
conteggio `spuntati/totali` — e mostra i task veri solo **espandendo**. I task di esecuzione
stanno sotto la description; quelli di validazione dentro il riquadro *Validazione*, che è dove
vive tutto ciò che riguarda il giudizio.

```text
┌───────────────────────────────────┐
│ Hop Angular 18 → 19               │
│ in_progress   reasoning           │
│                                   │
│ Porta il frontend dalla 18 alla   │
│ 19 con ng update, senza toccare…  │
│                                   │
│ ▸ task  ▓▓▓▓▓░░░░░  2/4           │
└───────────────────────────────────┘
```

L'espansione è una capacità **nuova** della pagina, non un ritocco: fino a qui la card non
nascondeva niente — description intera, tutti i criteri, un chip per dipendenza — e dodici task di
esecuzione più sei di validazione sempre visibili avrebbero prodotto card che riempiono lo schermo
da sole, facendo perdere al board la cosa per cui esiste.

La barra è piena **solo** quando ogni task è spuntato: arrotondare per eccesso mostrerebbe come
finito un lavoro che non lo è, ed è lo stesso motivo per cui il tracker non tiene dati che sembrano
freschi senza esserlo.

Quali blocchi hai aperto se lo ricorda finché la pagina resta aperta. Non è un vezzo: il server
spinge un aggiornamento a ogni scrittura di `issues.json` — cioè di continuo, mentre si lavora — e
ogni push ricostruisce la lista da capo. Senza memoria, un blocco aperto si richiuderebbe da solo
ogni pochi secondi.

Una issue senza task non mostra nessuna riga: niente da riassumere, nessuno spazio occupato.

## Cosa non fa

- Non scrive niente nel progetto.
- Non è raggiungibile dall'esterno: il socket è su `127.0.0.1`.
- Non serve file arbitrari: solo la pagina, `api/issues` ed `events`. Tutto il resto è 404,
  compreso `issues.json` chiesto per path.
- Non è un'interfaccia di modifica: le issue si cambiano con la CLI
  ([issues.md](issues.md)), così ogni scrittura passa dalle stesse validazioni.
- **Non si spuntano i task dal browser**, e non è una funzione che manca. Il guard
  anti-self-validation vive nell'**environment del processo**: rifiuta perché chi invoca ha
  `HARNESS_ROLE=worker`. Un click nel browser non porta con sé nessun ruolo, quindi per
  rispettarlo il server dovrebbe deciderlo per conto proprio — cioè reimplementare in un secondo
  posto l'unica difesa tecnica che harness possiede.

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
