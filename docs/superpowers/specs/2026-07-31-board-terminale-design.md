# Board: dal server web al terminale

Data: 2026-07-31
Sostituisce le sezioni 4-9 di [2026-07-30-board-workflow-design.md](2026-07-30-board-workflow-design.md).

## Problema

Il board è cresciuto fino a diventare l'applicazione più grande del plugin. Oggi la sua UI è
`board.js` 797 righe, `board.css` 695, `board.html` 119, `board-server.mjs` 216 — 1827 righe,
più 866 di test che le coprono. Il cuore del plugin, `issue-manager.mjs`, ne occupa 833.

Le tre issue rimaste in backlog (drawer con focus trap, stato in querystring, chain lens,
pan/zoom, chip per tier, sei scorciatoie, tema a tre stati, densità) valgono altre 700-900
righe scritte nello stesso stile. A quel punto la UI sarebbe due terzi del plugin, e ogni riga
di quelle è codice che riscrive qualcosa che una libreria fa da anni: il layering è Sugiyama
riscritto a mano, il routing degli archi è instradamento su griglia, il drawer è `<dialog>`.

La domanda che ha aperto questa revisione non era però "quale libreria": era **se un plugin
Claude debba contenere un'applicazione**. I plugin installati su questa macchina rispondono di
no. `superpowers` ha un `package.json` che contiene solo il nome. `caveman` e
`mattpocock-skills` non hanno dipendenze a runtime. `chrome-devtools-mcp`, che di codice pesante
ne ha eccome, non lo mette nel plugin: il manifest esegue `npx chrome-devtools-mcp@1.6.0`, e il
plugin resta un puntatore. Nessuno committa un bundle dentro il plugin.

C'è una seconda osservazione, più scomoda. Il server live esiste per mostrare il tracker che
cambia mentre gli agenti lavorano — ma il tracker cambia solo quando lo cambia un agente, e
quell'agente è lo stesso che sta parlando all'utente. Stiamo pagando un server HTTP, quattro
route, un canale SSE e un live reload perché una pagina scopra da sola un fatto che chi lo ha
causato conosceva già.

## Cosa cambia, in una riga

Il board smette di essere una pagina servita da un server e diventa un comando che stampa: un
albero delle catene dentro la sessione, albero più card in un terminale a fianco.

## 1. Architettura

Tre file, di cui uno già esiste e non si tocca.

| file | responsabilità | stato |
|---|---|---|
| `scripts/board-graph.mjs` | livelli, ordinamento, catene, guardia sui cicli | invariato, 359 righe |
| `scripts/board-render.mjs` | grafo + opzioni → stringa. Funzione pura | nuovo, ~200 righe |
| `scripts/board-cli.mjs` | legge `issues.json`, stampa, osserva | nuovo, ~80 righe |

Il confine è quello che lo spec precedente aveva già scelto e che ha retto: matematica pura da
una parte, presentazione dall'altra. Cambia solo che la presentazione produce testo.

**`board-render.mjs` non conosce il terminale.** Non legge `process.env`, non guarda
`isTTY`, non stampa. Riceve il grafo, la larghezza e un flag `colors`, restituisce una stringa.
Questo è ciò che rende provabile una modifica alla resa: si cambia una funzione senza
dipendenze e si rilancia `node --test`. Per confronto, dimostrare un solo criterio della issue
`3fe5af9c` ha richiesto un tracker finto, un server, Chrome pilotato via CDP e misure su
`offsetTop`.

**`board-cli.mjs` è l'unico pezzo con effetti collaterali**: risoluzione del progetto, lettura
del file, decisione sul colore, scrittura su stdout, watcher.

Muoiono: `board-server.mjs`, `board.js`, `board.css`, `board.html`,
`test/plugin-board.test.mjs`. Con `board-server.mjs` se ne vanno porta, pid, `--port`,
`PORT_IN_USE`, il ciclo di vita start/stop documentato in `commands/board.md` e il processo
orfano da fermare al clock-out.

## 2. Le due superfici

Non sono la stessa vista, e finora le abbiamo confuse.

**Dentro la sessione** (`/harness:board`): l'agente esegue `board-cli.mjs`, legge l'output e lo
ristampa in markdown. Niente ANSI — il canale affidabile verso l'utente è il messaggio
dell'agente, che viene reso come markdown; l'output di un comando lanciato via Bash arriva
all'agente, non necessariamente agli occhi di chi guarda. **Solo l'albero delle catene**: la
description intera l'agente la sta già raccontando, ristamparla consuma contesto senza
aggiungere niente.

Il live si risolve senza codice: la skill impone di ristampare l'albero compatto dopo ogni
transizione di stato — clock-in, `in_progress`, `in_review`, `pass`/`fail`, commit. È
informazione che l'agente possiede prima della pagina.

**In un terminale a fianco** (`board-cli.mjs --watch`): ANSI pieno, ridisegno a ogni scrittura
su `issues.json`, albero più card. Lo lancia l'utente, vive quanto vuole l'utente, non è un
processo che l'agente deve ricordarsi di uccidere.

## 3. Vista catene

Albero indentato, un ramo per catena, più un gruppo `senza catena` per le issue senza
dipendenze né dipendenti — la stessa distinzione che `board-graph.mjs` già calcola.

```
harness · 6 aperte · 84 chiuse                          feat/board-improv

catena · 1f4c689e ────────────────────────────────────────────────
  ✓ 1f4c689e  vista a grafo con archi SVG                     done
  ├─ ○ 315ec0d9  chain lens e pan/zoom            [standard]  ► lavorabile
  ├─ ○ 1787de25  drawer, stato URL, copia id      [standard]  ► lavorabile
  └─ ○ 730ba7d8  filtri tier, scorciatoie, tema   [standard]  ► lavorabile
       ○ 65e77ea4  board.md riscritta             [economy]
         attende 315ec0d9 1787de25 730ba7d8

catena · 3fe5af9c ────────────────────────────────────────────────
  ✓ 3fe5af9c  archi che saltano piu' livelli                  done
  └─ ○ a47813e7  corsie lunghe vs archi corti     [standard]  ► lavorabile

senza catena ─────────────────────────────────────────────────────
  ○ 3b99f4ca  docs: verifica per commit a24e4c4   [economy]   ► lavorabile
```

**Una catena non ha un nome**: è una componente connessa, cioè un fatto del grafo, e nessun
campo del tracker la battezza. Si identifica con l'id corto della sua radice — il nodo senza
dipendenze visibili, quello di livello 0. Con più radici nella stessa componente si usa la
prima in ordine di livello e poi di indice, che è l'ordinamento che `board-graph.mjs` già
produce. Inventare un nome dai titoli sarebbe testo dedotto, cioè esattamente ciò da cui
`depends_on` ci ha tolto.

**Il nodo con più genitori compare una volta sola**, sotto il genitore più profondo, e la riga
successiva elenca gli id di tutto ciò che attende. Un DAG non è un albero: l'alternativa —
ripetere il nodo sotto ogni genitore — fa crescere le righe col numero di archi invece che col
numero di issue, e su un tracker con molte convergenze la stessa issue si legge tre volte.

**`► lavorabile`** marca le issue le cui dipendenze sono tutte chiuse. È la regola 1-WIP resa
esecutiva: il grafo la lasciava dedurre guardando le frecce, qui è una colonna. Le dipendenze
già `done` restano visibili come nodo fantasma (`✓`), perché una riga che attende qualcosa di
invisibile è peggio di una riga in più.

Il banner di ciclo resta: `board-graph.mjs` lo rileva già, e con un ciclo l'albero non si
disegna — si stampano gli id coinvolti e si ripiega sull'elenco piatto.

## 4. Vista card

Solo nel watch esterno. Riproduce tutti i sette campi della card di oggi, senza perdite:

| campo | resa |
|---|---|
| stato | pallino colorato più nome dello stato |
| tier | allineato a destra dell'intestazione |
| titolo | word-wrap sulla larghezza, mai troncato |
| description | word-wrap, newline originali preservate |
| validazione | etichetta, stato, criteri |
| id | completo, non abbreviato |
| creata / aggiornata | data e ora locali |

`validation.criteria` arriva in due forme e nessuna delle due è normalizzata in `issues.json`:
array alla creazione, stringa alla chiusura e su ogni issue precedente all'array. Il renderer
le gestisce entrambe, come fa oggi `renderCriteria`: renderne una sola azzererebbe metà del
tracker.

Esempio, con `3fe5af9c` ripresa da quando era in lavorazione:

```
─────────────────────────────────────────────────────────────────────
● in_progress                                               standard
board: gli archi che saltano piu' livelli spariscono dietro le colonne

Segnalato dal verificatore della issue 1f4c689e come osservazione
fuori contratto.

Validazione · unknown
  ○ Un arco che salta almeno due livelli e' visibile per tutto il suo
    percorso, non solo agli estremi.

3fe5af9c-aaea-499b-8858-1afb61dd39ca
creata 30 lug 23:09 · aggiornata 31 lug 09:14
─────────────────────────────────────────────────────────────────────
```

**Nel watch le card sono solo quelle in volo** — `in_progress`, `in_review`, `blocked`. Per la
regola 1-WIP sono una o due, quindi la schermata sta dentro un terminale e il redraw non
combatte con la scrollback. Il resto del tracker resta visibile come riga nell'albero sopra.

Per sfogliare tutto il resto c'è il comando one-shot con i filtri (§5), che stampa e finisce:
lì la scrollback è la tua e nessuno la ridisegna.

## 5. Interfaccia da riga di comando

```
node <plugin>/scripts/board-cli.mjs [--project-dir <path>] [--watch]
                                    [--view chains|cards] [--status <s>]
                                    [--tier <t>] [--search <testo>] [--all]
                                    [--width <n>] [--no-color]
```

- `--project-dir` — assente vale la cwd. `issues.json` non si risolve mai accanto allo script:
  una copia installata serve ogni progetto, come già dichiara `issue-manager.mjs --help`.
- `--view` — `chains` di default nel one-shot, `cards` per sfogliare. In `--watch` sono
  entrambe e il flag è ignorato.
- `--status`, `--tier`, `--search` — sostituiscono i chip e la casella di ricerca della pagina.
  Ripetibili per `--status`.
- `--all` — include le `done`, che di default restano fuori come già fa il grafo.
- `--width` — assente vale `process.stdout.columns`, e 100 quando non c'è un TTY.
- `--no-color` — il colore è attivo solo con TTY, si spegne con questo flag o con `NO_COLOR`
  valorizzato, secondo la convenzione già diffusa.

Contratto di output uguale agli altri script del plugin per gli **errori**: una riga JSON
`{"ok":false,"error":...,"code":...}` su stdout ed exit 1. In caso di successo stampa testo,
non JSON: è una vista, non un'API. Codici: `FILE_NOT_FOUND` per un `--project-dir` inesistente,
`INVALID_ARGUMENT` per un flag noto usato male, `UNKNOWN_ARGUMENT` per un flag che non esiste —
gli stessi tre che `board-server.mjs` già usa, e che `commands/board.md` già insegna a leggere.

Un progetto senza `issues.json` legge come tracker vuoto e stampa il messaggio di tracker
vuoto: è il comportamento che `issue-manager.mjs` ha già.

## 6. Watch

Il watcher è quello di `board-server.mjs:177`, spostato così com'è. Osserva **la directory** e
non il file, perché `issue-manager.mjs:507-509` scrive su un temporaneo e poi `renameSync`: un
watcher legato al file continuerebbe a puntare a quello sostituito. Il debounce sul burst di
eventi è già lì e già collaudato.

A ogni evento: rilettura, rirender, `clear` più ristampa. Su un errore di lettura — file a metà
scrittura, JSON non valido — il watch **non muore**: stampa una riga di errore e resta in
attesa dell'evento successivo, perché un watcher che esce al primo file transitorio è peggio di
nessun watcher.

## 7. Lanciatore

Il percorso del plugin in installazione globale è lungo e agganciato alla versione
(`…/.claude/plugins/cache/diemrt/harness/0.6.0/scripts/…`). Va bene per l'agente, che lo riceve
sostituito a ogni invocazione; è inservibile per una persona, e al primo aggiornamento del
plugin il comando salvato punta a una cartella che non esiste più.

Al clock-in la skill scrive `.harness/board.cmd` e `.harness/board.sh` con il percorso risolto
in quel momento, così il comando da digitare è `.harness\board`. `.harness/` si auto-ignora già
e non entra in git. Essendo riscritti a ogni clock-in, un aggiornamento di versione li ripara
da solo senza che nessuno se ne accorga.

Se il lanciatore non c'è — sessione ripresa, clock-in saltato — l'agente stampa il comando
completo da incollare.

## 8. Colore

La palette dello spec precedente (§5) tradotta in ANSI 256 colori, che Windows Terminal e i
terminali moderni supportano senza negoziazione: `backlog` grigio, `in_progress` corallo,
`in_review` viola, `blocked` rosso, `done` verde. Gli id in grigio, i titoli in chiaro, le
etichette di sezione attenuate.

Il colore non porta mai informazione da solo: ogni stato è scritto anche in lettere. Un
terminale senza colore, un `NO_COLOR`, una pipe verso un file danno la stessa vista in bianco e
nero senza perdere niente.

## 9. Test

`test/plugin-board-graph.test.mjs` resta invariato, 322 righe. Al posto delle 866 righe che
pilotavano il DOM:

**`board-render`** — snapshot su fixture, `assert.equal` su stringa: tracker vuoto; tracker
senza nessuna dipendenza (tutto `senza catena`); catena lineare; nodo con tre genitori, che
compare una volta sola; dipendenza `done` resa come fantasma; id sconosciuto; ciclo, che
ripiega sull'elenco piatto; titolo più lungo della larghezza; description con newline;
`criteria` come array e come stringa; `colors: true` che avvolge e `colors: false` che non
lascia byte di escape.

**`board-cli`** — directory temporanea, come già fa la suite: risoluzione di `--project-dir`;
`issues.json` assente che legge come vuoto; filtri; `NO_COLOR` rispettato; flag sconosciuto che
esce con `UNKNOWN_ARGUMENT`; e un test che scrive sul file e verifica che `--watch` ridisegni.

Il criterio che oggi costa un browser — «un arco lungo è visibile per tutto il percorso» — non
esiste più: non ci sono archi.

## 10. Documentazione e tracker

Da riscrivere: `commands/board.md` (sparisce il ciclo start/stop, restano i flag),
`skills/harness/references/board.md` (documenta la CLI, non la pagina), e tre punti di
`SKILL.md`: il passo 4 del clock-in (avvio del server → stampa dell'albero e scrittura del
lanciatore), il clock-out (sparisce «ferma il board»), e la regola nuova che sostituisce il
live — ristampare l'albero compatto dopo ogni transizione di stato.
`proposals/board-minimal.html` si rimuove: era in attesa di sapere se vendorizzare le
dipendenze della pagina, e la pagina non c'è più.

Sul tracker, sei issue vanno riconciliate:

| issue | destino | perché |
|---|---|---|
| `315ec0d9` chain lens, pan/zoom | **cancellata** | il pan/zoom non esiste in un terminale; il lens diventa una riga del renderer |
| `1787de25` drawer, URL, copia id | **cancellata** | non c'è né drawer né URL |
| `730ba7d8` filtri, scorciatoie, tema, densità | **cancellata** | sopravvive come flag della CLI, che è un'altra issue |
| `a47813e7` corsie lunghe vs archi corti | **cancellata** | il codice che ha quel difetto viene rimosso |
| `3b99f4ca` docs gate per `a24e4c4` | **cancellata** | assorbita dalla riscrittura documentale di questo spec |
| `65e77ea4` riscrittura di `board.md` | **riusata** | cambia oggetto: documenta la CLI |

L'ordine è vincolante: `65e77ea4` dichiara tre di quelle in `depends_on` e `issue-manager.mjs`
rifiuta `--delete` finché qualcuno le punta. Quindi prima si azzera il `depends_on` di
`65e77ea4`, poi si cancella.

**Va detto esplicitamente perché non è la mossa vietata.** `SKILL.md` proibisce a un *worker* di
togliere una dipendenza per sbloccarsi. Qui non si sblocca niente: è una decisione di scope di
chi apre le issue, che cancella il lavoro a cui quelle dipendenze puntavano. La distinzione sta
in chi decide e perché, e va lasciata scritta nel commit, altrimenti chi legge il diff vede la
mossa proibita senza il contesto.

## Rischio dichiarato

Se fra qualche mese le catene diventano larghe e l'albero indentato non basta, tornare a una
vista bidimensionale significa riscrivere una pagina da zero: questo spec la cancella, non la
mette in pausa.

Il mitigante è che `board-graph.mjs` sopravvive intatto e testato. Livelli, ordinamento,
baricentro, fantasmi e guardia sui cicli restano calcolati: una futura pagina ripartirebbe
dalla matematica, che è la metà difficile. Si rifarebbe il render, che è la metà che invecchia.

## Fuori scope

Nessuna dipendenza esterna, nessun pacchetto npm, nessun bundler: la strada del pacchetto
separato — il modello `chrome-devtools-mcp` — resta valida se un giorno il board tornasse a
essere un'applicazione, ma con una vista testuale non serve niente che non sia già in Node.

Nessun cambiamento a `issue-manager.mjs`, al formato di `issues.json`, alle regole di workflow.
Questo spec sposta una vista: il dato e le invarianti restano dove sono.
