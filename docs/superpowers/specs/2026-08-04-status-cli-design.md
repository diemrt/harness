# Riepilogo del tracker a riga di comando

Data: 2026-08-04

Recupera una sola idea dal branch `backup/board-improv-2026-07-31`: il tracker si può leggere
senza aprire un browser. Il resto di quel branch — `board-graph.mjs`, `board-render.mjs`, il
`--watch`, la vista card, la demolizione del board web — resta dov'è.

## Problema

Per sapere a che punto è il lavoro oggi ci sono due strade, e nessuna delle due risponde alla
domanda "a che punto siamo" mentre la stai facendo.

`/harness:issue` senza argomenti lancia tre invocazioni di `issue-manager.mjs`, una per stato,
e chiede all'agente di riassumerle in tabella. Tre giri di tool call e un riassunto scritto a
mano ogni volta, diverso ogni volta.

`/harness:board` avvia un server HTTP e stampa un URL. Vedi tutto, ma devi lasciare la sessione,
aprire il browser, e alla fine ricordarti di fermare il processo. È la risposta giusta a una
domanda diversa: "voglio guardare il tracker mentre lavoro", non "dimmi in una schermata dove
siamo prima che io decida se vale la pena aprire qualcosa".

Manca la terza: un comando che stampa un'istantanea, dentro la sessione, come `/context` stampa
quanto contesto è rimasto.

## Cosa cambia, in una riga

Nasce `/harness:status`: un comando che stampa una schermata sola con i conteggi, cosa è in
corso e cosa si può prendere adesso.

## 1. Architettura

Un file nuovo, `scripts/status-cli.mjs`, circa 120 righe. Nessun altro script si tocca.

| pezzo | firma | effetti |
|---|---|---|
| `buildSnapshot(issues)` | → `{ counts, inFlight, workable, workableTotal, alerts }` | nessuno |
| `renderSnapshot(snapshot, { project, lastUpdated })` | → stringa | nessuno |
| `main()` | argv → stdout, exit code | tutti |

Il valore sta nel primo pezzo: "quali issue sono lavorabili", "c'è un ciclo nei `depends_on`"
sono decisioni sui dati, e si dimostrano con un array di oggetti in memoria — nessun tracker
finto su disco, nessun processo, nessun browser. `renderSnapshot` è la stessa cosa per la resa.
`main()` resta la parte sottile, quella che si prova con `spawnSync` come fa già
`test/plugin-board.test.mjs`.

Un solo file e non due (`status-render.mjs` più `status-cli.mjs`) perché il totale è ~120 righe:
lo spec del branch backup separava 800 righe fra grafo e resa, e lì il confine pagava. Qui
sarebbe un file in più da tenere allineato per niente. Il confine resta, ma è fra tre funzioni
nello stesso file.

Lo script è autonomo: risolve il progetto e legge `issues.json` per conto suo, come fa già
`board-server.mjs`. È la convenzione del repository — nessuno script esporta niente agli altri.

## 2. Le due superfici

**Dentro la sessione** (`/harness:status`) è il caso di progetto. L'agente lancia lo script con
`${CLAUDE_PLUGIN_ROOT}` e ne **ristampa l'output verbatim in un blocco di codice**, senza
riformattarlo: l'allineamento è già fatto, riformattarlo costa contesto e introduce differenze
fra un'invocazione e l'altra.

Va detto in cosa questo differisce da `/context`: `/context` lo disegna Claude Code stesso, uno
slash command di plugin no. Il costo è un giro di tool call e una quindicina di righe di
contesto. La sostanza — un comando, una schermata, niente server — è la stessa.

**Da un terminale esterno** (`node <path-plugin>/scripts/status-cli.mjs`) funziona, con lo stesso
identico testo, ma non è il caso per cui è progettato. Nessun lanciatore viene scritto nel
progetto: harness non mette file in un repository per risolvere il path di sé stesso, e chi vuole
il comando a portata di mano si scrive un alias.

**Niente ANSI, niente colore.** Nella superficie primaria stdout è una pipe verso l'agente, mai
un TTY: il ramo colorato non verrebbe eseguito mai. Sarebbero venti righe di codice e una
manciata di test per un caso che non esiste. La distinzione la portano le icone e
l'allineamento, che sopravvivono al blocco di codice markdown.

## 3. Contratto di output

```
 harness · 11 issue · aggiornato 2026-08-04 09:12
════════════════════════════════════════════════════════════════════════════════
 [########++++~~~~oooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo]
  # done 6    + in_progress 1    ~ in_review 1    o backlog 3

 IN CORSO
 ───────────────────────────────────────────────────────────────────────────────
  + 4f2a1b8c  in_progress  $$   vista albero delle catene
  ~ 9c31e07d  in_review    $    filtri per tier nel board, con scorciatoie e...

 LAVORABILI · 3 di 7
 ───────────────────────────────────────────────────────────────────────────────
  o 1787de25  $$   drawer con focus trap
  o 315ec0d9  $$   chain lens e pan/zoom
  o 730ba7d8  $    filtri tier, scorciatoie, tema
 ───────────────────────────────────────────────────────────────────────────────
 tier  $ economy   $$ standard   $$$ reasoning   - non dichiarato
```

### Icone

| stato | icona | | tier | icona |
|---|---|---|---|---|
| `backlog` | `o` | | `economy` | `$` |
| `in_progress` | `+` | | `standard` | `$$` |
| `in_review` | `~` | | `reasoning` | `$$$` |
| `blocked` | `!` | | non dichiarato | `-` |
| `done` | `#` | | | |

**Le icone della barra sono le icone delle righe.** Il `+` del segmento è il `+` della riga:
una sola convenzione, una sola legenda da leggere.

**Icone in ASCII puro, cornici in box-drawing.** `─` e `═` sono decorazione: se un terminale le
rende male perdi un bordo. Le icone sono dato, e i glifi Unicode più belli (`●`, `◐`, `▓`) hanno
larghezza *ambigua* — su alcuni terminali occupano due colonne e la tabella si disallinea proprio
nella colonna che porta il significato. `+ ~ o # !` e `$` non hanno questo problema da nessuna
parte.

Il tier assente vale `standard` al momento del dispatch, ma qui si rende `-`: questa CLI dice
cosa c'è scritto nel tracker, non cosa qualcun altro ne dedurrà.

### Layout

**Larghezza fissa 80 colonne.** Non c'è un terminale di cui leggere la larghezza: l'output
finisce in un blocco markdown reso dalla sessione.

**Troncamento del titolo a 45 caratteri**, con `...` — tre caratteri ASCII, non `…`, per la
stessa ragione di larghezza ambigua. `title` arriva a 80 caratteri per schema, quindi il
troncamento scatta spesso: è il prezzo di una riga per issue, ed è preferibile al word-wrap, che
farebbe crescere l'altezza col numero di titoli lunghi invece che col numero di issue.

**La legenda degli stati mostra solo gli stati presenti.** Un `! blocked 0` spiega un'icona che
in quella schermata non compare.

**La barra** occupa una riga da 80 colonne: uno spazio, `[`, 77 colonne di segmenti, `]`. I
segmenti sono proporzionali ai conteggi e la loro somma è esattamente 77: gli arrotondamenti si
compensano sul segmento più grande, così la barra non è mai corta né lunga di un carattere.
Uno stato con almeno una issue occupa almeno una colonna, altrimenti sparisce dalla barra pur
essendo in legenda.

**L'intestazione.** Il nome del progetto è il campo `project` di `issues.json` se c'è, altrimenti
il basename della directory del progetto — la stessa regola che il board web applica già in
`board.html`. `11 issue` è il totale del tracker, `done` incluse. La data viene da `last_updated`,
resa in ora locale con `YYYY-MM-DD HH:mm`; se il campo manca, l'intestazione si ferma al
conteggio.

### Ordinamenti

`IN CORSO` per stato, nell'ordine `in_progress`, `in_review`, `blocked`; dentro ciascuno per
`updated_at` decrescente — quello che hai toccato per ultimo in cima.

`LAVORABILI` per `created_at` crescente, le più vecchie prime, e ne mostra **tre**;
l'intestazione dichiara sempre il totale (`3 di 7`).

### Allerte

Righe con `!` davanti, sopra la barra:

```
 ! ciclo nei depends_on: 4f2a1b8c 9c31e07d 1787de25
 ! 2 issue dipendono da id inesistenti: a1b2c3d4
 ! lavorabili 0 di 4 — ogni issue in backlog attende qualcosa
```

Le issue `blocked` **non** generano un'allerta: compaiono in `IN CORSO` con la loro icona.
L'allerta è per ciò che nessuna sezione può mostrare da sé. Ripetere in quindici righe la stessa
informazione due volte è rumore.

### Casi vuoti

| caso | resa |
|---|---|
| nessun `issues.json` | `harness · tracker vuoto`, niente barra, niente sezioni |
| nessuna issue in corso | `IN CORSO` seguita da `nessuna issue aperta` |
| nessuna lavorabile, backlog vuoto | `LAVORABILI · 0 di 0` seguita da `niente in backlog` |
| nessuna lavorabile, backlog pieno | l'allerta di stallo, e `LAVORABILI · 0 di 4` |

Tutti a exit 0. Un tracker vuoto non è un errore: è un progetto che non ha ancora aperto una
issue.

## 4. Regole dei dati (`buildSnapshot`)

**`IN CORSO`** raccoglie `in_progress`, `in_review`, `blocked`. **Senza limite di righe**: se
sono dodici hai un problema di WIP, e troncarlo a "e altre 9" nasconde esattamente il fatto che
il comando dovrebbe farti notare.

**Lavorabile** = stato `backlog` e *ogni* id in `depends_on` risolve a una issue esistente in
stato `done`. Una issue senza `depends_on` è lavorabile per definizione.

**Dipendenza fantasma** — un id in `depends_on` che non corrisponde a nessuna issue del tracker
— rende la issue **non** lavorabile e produce un'allerta. Scelta conservativa: non si sa cosa
manchi, e dichiarare lavorabile qualcosa che dipende dal nulla è il modo di far partire il lavoro
sbagliato. Succede dopo un `--compact` che archivia una issue ancora referenziata, che la CLI
rifiuta, e dopo una modifica a mano di `issues.json`, che nessuno dovrebbe fare.

**Ciclo**: visita in profondità sui `depends_on`, limitata alle issue **non `done`**. Un ciclo
fra issue chiuse è un fatto storico, non un problema da segnalare oggi. Un ciclo rilevato non
impedisce il resto dell'output: le issue coinvolte semplicemente non risultano lavorabili, il che
è vero.

**Stallo**: `backlog > 0` e lavorabili `0`. Ogni issue aperta attende qualcosa, e nessuna delle
attese si può soddisfare prendendo lavoro dal backlog.

## 5. Contratto CLI

Flag: `--project-dir <path>` e `--help`. `parseArgs` in modalità `strict`, come
`board-server.mjs`: un flag inventato deve fallire, non stampare un riepilogo che sembra giusto.

**Stdout è testo, non JSON.** È una rottura dichiarata rispetto a `issue-manager.mjs` e va scritta
nel commento in testa al file: quello parla a un agente che fa `JSON.parse` sulla riga, questo
parla a un umano. Non ha consumatori automatici e non deve acquisirne.

| caso | uscita |
|---|---|
| tutto bene | il testo, exit 0 |
| `--help` | l'uso, exit 0 |
| nessun `issues.json` | `harness · tracker vuoto`, exit 0 |
| `--project-dir` inesistente | riga d'errore, exit 1 |
| `issues.json` illeggibile o JSON non valido | riga d'errore, exit 1 |
| flag sconosciuto o senza valore | riga d'errore, exit 1 |

Niente su stderr, come il resto del plugin.

## 6. Cosa cambia fuori dallo script

**`commands/status.md`**, nuovo, `allowed-tools: Bash`. Istruisce l'agente a lanciare lo script,
ristampare l'output **verbatim in un blocco di codice**, non riformattarlo, e non aggiungere più
di una riga di commento proprio.

**`skills/harness/SKILL.md`**: il riepilogo va ristampato a **clock-in** e a **clock-out**. Sono
le due soglie in cui la domanda "a che punto siamo" nasce da sé; nel mezzo la si chiede
esplicitamente. Non a ogni transizione di stato: sarebbero quindici righe non richieste dopo ogni
`in_review`.

**`README.md`**: una riga nell'elenco dei comandi.

Nessuna `references/status.md`. Il contratto sta in trenta righe di `commands/status.md`, e un
file di reference in più è un documento da tenere in sincrono con lo script senza che nessuno
abbia bisogno di leggerlo.

Il board web — `board-server.mjs`, `board.html`, `commands/board.md` — **non si tocca**. Questo
comando gli sta accanto, non lo sostituisce e non ne anticipa la rimozione.

## 7. Test

**`test/plugin-status-cli.test.mjs`**, nuovo.

Su `buildSnapshot`, con oggetti in memoria: lavorabile quando ogni dipendenza è `done`; non
lavorabile con una dipendenza ancora aperta; dipendenza fantasma → non lavorabile **e** allerta;
ciclo fra issue aperte rilevato; ciclo fra issue `done` **non** rilevato; stallo con backlog
pieno e zero lavorabili; conteggi per tutti e cinque gli stati.

Su `renderSnapshot`: troncamento a 45 caratteri; **nessuna riga oltre 80 colonne** su input
estremi (titolo da 80 caratteri, dodici issue in corso, tutti i tier); icona corretta per ogni
stato e per ogni tier, incluso il tier assente; le quattro rese dei casi vuoti; somma dei segmenti
della barra uguale alla larghezza della barra, compresi gli arrotondamenti.

Su `main`, con `spawnSync` su una directory temporanea: exit 0 e testo su un tracker valido; exit
0 su una directory senza `issues.json`; exit 1 su `--project-dir` inesistente, su `issues.json`
corrotto e su un flag sconosciuto; niente scritto su stderr in nessuno dei casi.

**`test/plugin-commands.test.mjs`**, esteso: `commands/status.md` esiste, ha il frontmatter e
dichiara `allowed-tools`.

## 8. Verifica in sessione reale

`CLAUDE.md` lo impone e vale qui più che altrove, perché la superficie primaria di questo lavoro
è proprio l'invocazione in sessione: dopo il commit, **riavvio della sessione di Claude Code e
invocazione reale di `/harness:status` in questo repository**. `npm test` verde dimostra che lo
script funziona; non dimostra che il comando è invocabile, che l'agente ristampa il blocco senza
riformattarlo, né che a 80 colonne la tabella regge nel terminale.
