# Board: dipendenze fra issue e vista a grafo

Data: 2026-07-30
Stato: approvato in brainstorming, da pianificare

## Problema

Il board (`scripts/board.html`) mostra le issue come una lista piatta di card, tutte allo stesso
livello: nulla dice quale lavoro ne abilita un altro. La regola 1-WIP di harness parla di "catena
di dipendenza", ma la catena non esiste come dato — la deduce l'orchestratore ogni volta, a
giudizio, e nessuno può verificarla.

In più la pagina carica Tailwind, daisyUI e Lucide da CDN: senza rete si apre e non si presenta.
`references/board.md` lo documenta come trade-off scelto, e `proposals/board-minimal.html` è una
UI alternativa senza dipendenze, congelata in attesa di decidere. Questo documento decide.

## Cosa cambia, in una riga

Le issue dichiarano da cosa dipendono; il board diventa un grafo di quelle dipendenze, servito
senza rete e disegnato nello stile di Claude Code.

## 1. Dato: il campo `depends_on`

Nuovo campo sulla issue, in `issues.json`:

```json
{
  "id": "c3d4e5f6-...",
  "title": "Board: vista a grafo",
  "depends_on": ["a1b2c3d4-...", "b2c3d4e5-..."],
  "status": "backlog"
}
```

`depends_on` è un array di GUID e significa **"queste issue devono chiudersi prima"**. L'arco va
dalla dipendenza alla issue che la dichiara.

**Forma memorizzata.** Sempre un array: `--insert` scrive `[]` quando il campo è assente,
`--update` fa merge con `existing.depends_on ?? []`. Le issue scritte prima del campo non hanno
la chiave e restano leggibili e aggiornabili senza migrazione, esattamente come è già successo
con `tier`.

**Nessun cap sul numero di dipendenze.** Un `LIMIT_EXCEEDED` in harness dice "questo contenuto
non è una issue, è un documento a cui la issue punta". Una dipendenza non è testo libero: è un
fatto del grafo, e un tetto spingerebbe a cancellare archi veri per far passare il payload. Il
layout deve reggere il fan-in.

## 2. Validazione nella CLI

Codice nuovo: **`INVALID_DEPENDENCY`**, un codice per campo come `INVALID_TIER` e
`INVALID_STATUS`. Copre tutti i modi in cui `depends_on` può essere sbagliato, e il messaggio
dice quale:

| Caso | Esito |
|---|---|
| non è un array | `INVALID_DEPENDENCY` |
| elemento non GUID | `INVALID_DEPENDENCY` |
| id duplicato nell'array | `INVALID_DEPENDENCY` |
| self-reference | `INVALID_DEPENDENCY` |
| id che non esiste nel tracker | `INVALID_DEPENDENCY` |
| ciclo (diretto o indiretto) | `INVALID_DEPENDENCY` |

Il ciclo si cerca con una DFS sul grafo memorizzato più gli archi proposti dal payload. È
l'unico punto in cui il DAG resta un DAG: la board si limita a difendersi (§6), non a riparare.

**`--delete` di una issue con dipendenti** viene rifiutata con `INVALID_DEPENDENCY`, elencando
gli id che la puntano. L'alternativa — sfilare l'id dagli altri record — muterebbe issue che il
chiamante non ha nominato, in silenzio. Chi cancella scollega prima, esplicitamente.

**Nessun guard tecnico sul lavoro.** La CLI non impedisce di portare `in_progress` una issue con
dipendenze aperte. In harness l'unico guard di processo è quello anti-self-validation
(`FORBIDDEN_ROLE`), e resta l'unico: il resto sono regole di workflow, che vivono nella skill
come ci vive il tier. Un guard qui toglierebbe la valvola di sfogo — nessun modo di far partire
un lavoro che l'orchestratore giudica indipendente nei fatti, se non cancellando il dato.

`--get-all` non cambia: nessun filtro `--ready`, nessun campo derivato in output.

## 3. Regole nella skill

`skills/harness/SKILL.md`:

- **Regola 1-WIP.** La formulazione non cambia; cambia che la catena ora è calcolabile — è la
  componente connessa del grafo di `depends_on` — invece che dedotta a giudizio.
- **Invariante nuovo, gemello di quello sui criteri:** al worker è vietato togliere una
  dipendenza per sbloccarsi. Cancellare l'arco che rende la propria issue non ancora lavorabile
  è la stessa mossa del cancellare i criteri che la rendono giudicabile. Le dipendenze le mette
  chi apre la issue; chi le cambia lo motiva nella description.

`skills/harness/references/issues.md`: schema, tabella dei campi accettati in input, semantica
del campo, `INVALID_DEPENDENCY` nella tabella dei codici, comportamento di `--delete`.

`skills/harness/references/board.md`: la sezione "Dipendenze della pagina" documenta il CDN come
scelta consapevole e va riscritta, non corretta ai margini. Si aggiungono le route nuove, la
vista a grafo e le scorciatoie.

`proposals/board-minimal.html` si ritira: la decisione che aspettava è presa, e la sua
impostazione senza dipendenze entra in `board.css`.

## 4. Architettura della pagina

Quattro file serviti da quattro route fisse di `board-server.mjs`:

| route | file | content-type |
|---|---|---|
| `/`, `/index.html` | `scripts/board.html` | `text/html` |
| `/board.css` | `scripts/board.css` | `text/css` |
| `/board.js` | `scripts/board.js` | `text/javascript` |
| `/board-graph.mjs` | `scripts/board-graph.mjs` | `text/javascript` |

Tabella statica, file letti in memoria all'avvio come già accade per la pagina. Nessun path
costruito a partire dall'URL: "non serve file arbitrari" resta vero — sono quattro route
dichiarate una per una invece di una. Tutto il resto continua a rispondere 404.

**Perché due file JS.** `board-graph.mjs` è matematica pura sul DAG — livelli, ordinamento,
antenati e discendenti, guardia sui cicli — senza alcun accesso al DOM, quindi importabile
davvero da `node --test`. `board.js` è l'app: fetch, SSE, render, eventi, stato nell'URL.

Sparisce `extractFunctions`, l'helper di `test/plugin-board.test.mjs` che oggi ritaglia le
funzioni dall'HTML contando le graffe per poterle chiamare. Il layout di un DAG verificato per
stringa passerebbe su un renderer presente e sbagliato.

Zero dipendenze esterne: niente Tailwind, niente daisyUI, niente Lucide. CSS scritto a mano su
custom properties, icone SVG inline, font di sistema, nessun build step.

## 5. Direzione visiva

Il brief fissa "stile Claude Code": crema caldo e corallo qui sono la scelta richiesta, non il
default in cui si finisce per inerzia.

| token | light | dark |
|---|---|---|
| `--bg` | `#F0EEE6` | `#1B1A18` |
| `--surface` | `#FAF9F5` | `#232220` |
| `--ink` | `#1F1E1C` | `#EDEAE2` |
| `--muted` | `#6C6A62` | `#9A968B` |
| `--line` | `#DEDBD0` | `#34322E` |
| `--accent` | `#D97757` | `#E08262` |

Stati, tarati caldi sulla stessa palette: `backlog` `#8A877D`, `in_progress` `--accent`,
`in_review` `#7A6BB5`, `blocked` `#C0473E`, `done` `#5B8C51`.

**Tipografia — una regola, non due font scelti a caso: la macchina parla mono, l'umano parla
sans.** Id, tier, stati, contatori, etichette di livello ed evidenze di verifica usano lo stack
mono di sistema (`ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace`); titoli e
description usano lo stack sans di sistema, perché sono prosa italiana lunga e in mono a 13px si
legge male. La distinzione dice una cosa vera del record: metà la scrive un agente, metà la
legge una persona.

Spacing su base 4px, densità alta, radius 6px, bordi hairline da 1px. Via il contenitore
centrato da 1152px: barra di stato in alto (progetto, indicatore live, contatori inline),
toolbar, poi la canvas a tutta larghezza — il grafo ha bisogno di spazio.

**Elemento distintivo: il chain lens.** Al focus su una card, tutto ciò che non appartiene alla
sua catena sbiadisce e gli archi della catena restano pieni. È la regola 1-WIP resa visibile, ed
è l'unico punto in cui la pagina alza la voce: tutto il resto sta zitto.

## 6. Vista a grafo

**Cosa entra.** Nodi = issue con `status !== "done"`. Il grafo serve a decidere cosa lavorare
adesso, e su questo tracker le issue chiuse sono la grande maggioranza: includerle
degraderebbe la vista in una colonna infinita.

**Nodi fantasma.** Una dipendenza già `done` di un nodo visibile entra comunque, in forma
compatta: bordo tratteggiato, solo titolo troncato e stato. Senza, la freccia partirebbe dal
nulla. Stessa forma per un `depends_on` che punta a un id sparito: la CLI lo impedisce, ma la
pagina lo disegna come fantasma "id sconosciuto" invece di ignorarlo — un arco che scompare
senza dirlo è peggio di un arco brutto.

**Layering** (`board-graph.mjs`, funzioni pure): `level(n) = 0` se il nodo non ha dipendenze
visibili, altrimenti `max(level(dep)) + 1` — longest-path. L'ordine dentro il livello si ottiene
con due passate di baricentro per ridurre gli incroci, con tie-break sull'indice originale
nell'array, che è già il criterio di ordinamento della vista WIP.

**Issue senza catena** (né dipendenze né dipendenti) non formano colonna: vanno in una griglia a
wrap etichettata `senza catena`, a sinistra del livello 0. Altrimenti sul tracker attuale, dove
nessuna issue ha ancora dipendenze, il grafo è una colonna verticale che contiene tutto.

**Archi**: polilinee SVG a gomito, 1px, punta sul target; un arco che salta più livelli passa
nel corridoio fra le colonne.

**Guardia sui cicli.** `issues.json` è un file e qualcuno può editarlo a mano nonostante il
divieto. Il layering tiene un visited-set: trovato un ciclo non entra in loop, la pagina mostra
un banner con gli id coinvolti e ripiega sulla vista lista. Il grafo non è un posto dove si
perde un dato.

**Vista lista.** Resta, come seconda vista con toggle: mostra tutte le issue, `done` incluse, ed
è la vista di riferimento quando il grafo non ha niente da dire.

## 7. Feature

**Drawer di dettaglio.** Click o `Enter` su una card apre un pannello a destra con description
intera, criteri, tier e dipendenze come link cliccabili che selezionano e centrano quella issue.
`Esc` chiude, il focus resta in trappola finché è aperto, un bottone copia l'id
(`navigator.clipboard`: `127.0.0.1` è secure context, nessun fallback da scrivere).

**Stato nell'URL.** `?view=graph|list&status=wip&q=…&tier=…&issue=<id>`. `replaceState` sui
filtri, `pushState` sull'apertura di una issue, così il tasto indietro chiude il drawer invece
di uscire dalla pagina. Al boot l'URL vince sui default; un link si può incollare.

**Filtri e tastiera.** Chip per tier accanto a quelli per stato, con `standard` che include il
`tier` assente — è ciò che `references/issues.md` già dichiara. Chip dei filtri attivi con
clear. Scorciatoie: `/` porta il focus sulla ricerca, `Esc` chiude o pulisce, `g` e `l` cambiano
vista, le frecce muovono il focus fra le card, `Enter` apre il drawer, `?` mostra l'elenco delle
scorciatoie.

**Tema e densità.** `data-theme` su `<html>`, default `system` da `prefers-color-scheme`, toggle
system→light→dark persistito in `localStorage`. Modalità compatta che riduce il padding e
nasconde la description nelle card.

**Interazione col grafo.** Drag sullo sfondo per il pan, rotella per lo scroll, `ctrl`+rotella
per lo zoom (0.5×–1.5×), bottoni fit-to-screen e reset. Il chain lens si attiva su hover **e**
su focus da tastiera: se vivesse solo nel mouse, metà delle persone non lo vedrebbe mai.

**Baseline non negoziabile**, non un bundle opzionale: focus visibile ovunque, contrasto AA,
`aria` sui controlli e sugli stati, `prefers-reduced-motion` rispettato.

## 8. Stati ed errori

Restano i tre stati di oggi — loading, error, empty — con in più il banner di ciclo (§6) e il
nodo fantasma "id sconosciuto". Il payload di `api/issues` non cambia forma: `depends_on` viaggia
dentro gli oggetti issue, che il server già inoltra così come sono.

## 9. Test

- `board-graph.mjs`: import vero dal test, niente estrazione per stringa. Livelli, ordinamento
  con incroci, nodi fantasma, ciclo, gruppo senza catena, calcolo della catena di un nodo.
- `issue-manager.mjs`: matrice `depends_on` — forma, id inesistente, self-reference, ciclo
  diretto e indiretto, `--delete` con dipendenti, merge che preserva il campo su una issue che
  non ce l'ha, guard `HARNESS_ROLE` non toccato dal campo nuovo.
- `board-server.mjs`: le quattro route con il content-type giusto, tutto il resto 404, nessun
  traversal, e il marker test aggiornato ai file nuovi.

**Gap dichiarato:** nessun test E2E su browser. Il repository non ha un headless e non lo
introduce per questo lavoro. Drawer, pan/zoom e scorciatoie restano coperti dalla sola prova
manuale in sessione, che `CLAUDE.md` impone comunque per ogni modifica al plugin.

## 10. Decomposizione in issue

```
[1] CLI: depends_on ──┬──> [2] skill + issues.md
                      └───────────────┐
[3] server: 4 route ──> [4] restyle ──┼──> [6] vista grafo ──┬──> [7] chain lens + pan/zoom
[5] board-graph.mjs ──────────────────┘                      ├──> [8] drawer + deep-link
                                                             └──> [9] filtri + tastiera + tema
                                              [6], [4], [3] ───────> [10] board.md + ritiro proposal
```

| # | issue | tier | dipende da |
|---|---|---|---|
| 1 | `depends_on` in `issue-manager.mjs`: schema, validazione, cicli, delete | reasoning | — |
| 2 | `issues.md` + `SKILL.md`: campo, catena calcolabile, invariante worker | standard | 1 |
| 3 | `board-server.mjs`: route statiche per css e js | standard | — |
| 4 | split in `board.html` + `board.css` + `board.js`, restyle, zero CDN, parità funzionale con oggi | standard | 3 |
| 5 | `board-graph.mjs`: layering puro + test | reasoning | — |
| 6 | vista grafo: SVG, fantasmi, senza-catena, toggle | reasoning | 1, 4, 5 |
| 7 | chain lens + pan/zoom | standard | 6 |
| 8 | drawer di dettaglio + stato nell'URL + copia id | standard | 6 |
| 9 | filtri tier + scorciatoie + tema + densità | standard | 6 |
| 10 | `board.md` riscritta, `proposals/board-minimal.html` ritirato | economy | 3, 4, 6 |

`[1]`, `[3]` e `[5]` sono catene distinte e partono in parallelo: la regola 1-WIP lo consente.
`[6]` è il punto di giunzione ed è il lavoro più grande — se una issue va spezzata durante il
piano, è quella.

## Fuori scope

- Modifica delle issue dal board: resta una vista, le scritture passano dalla CLI e dalle sue
  validazioni.
- Filtro `--ready` o campi derivati in output dalla CLI.
- Guard tecnico che impedisca `in_progress` con dipendenze aperte.
- Test E2E su browser e qualsiasi dipendenza di build.
