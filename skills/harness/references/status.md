# Riepilogo del tracker

`status-cli.mjs` stampa in una schermata sola dove sta il lavoro: conteggi, cosa è in corso,
cosa si può prendere adesso. È l'equivalente di `/context` per il tracker — si guarda prima di
decidere se vale la pena aprire il board.

Non scrive niente. Nessun flag lo fa scrivere.

```bash
node "$SCRIPTS/status-cli.mjs" [--project-dir <path>] [--help]
```

`--project-dir` serve solo se la cwd non è la radice del progetto. `--help` stampa l'uso ed
esce 0. Non ci sono altri flag e non ci sono sottocomandi: `parseArgs` è in modalità `strict`,
quindi un flag inventato fallisce invece di produrre un riepilogo che sembra giusto ma risponde
a un'altra domanda.

## Il canale è stdout, e il formato è testo

**Stdout porta tutto, anche gli errori. Su stderr non finisce mai niente.** Chi cattura solo
stderr per leggere il motivo di un fallimento non trova nulla e crede che il comando sia
rimasto muto.

**L'output è testo, mai JSON.** È una rottura dichiarata rispetto a `issue-manager.mjs` e
`board-server.mjs`, che stampano una riga JSON perché un agente la parsa: questo comando parla
a un umano che legge un blocco di codice, non ha consumatori automatici e non deve acquisirne.
Non passarlo a `JSON.parse`.

Niente ANSI, niente colore, nessuna lettura di `isTTY`: nella superficie per cui esiste stdout
è una pipe verso l'agente, e un ramo colorato non verrebbe eseguito mai. La distinzione la
portano le icone e l'allineamento, che sopravvivono al blocco di codice markdown.

## Codici d'uscita

| caso | uscita |
|---|---|
| riepilogo stampato | 0 |
| `--help` | 0 |
| nessun `issues.json`, oppure tracker con zero issue | 0, una riga `tracker vuoto` |
| `--project-dir` inesistente | 1, una riga |
| `issues.json` illeggibile o JSON non valido | 1, una riga |
| flag sconosciuto o senza valore | 1, una riga |

Un tracker vuoto **non** è un errore: è un progetto che non ha ancora aperto una issue. Vale
sia quando `issues.json` manca sia quando esiste con `issues: []`, come lo scrive `--init`: in
entrambi i casi la riga è la stessa e non si stampa né barra né sezioni.

## Come si legge l'output

Questo esempio è output reale dello script su un tracker di 17 issue, non un disegno: 6 chiuse,
una per ciascuno degli altri stati e 8 in backlog, di cui una con una dipendenza rotta.

```
 harness · 17 issue · aggiornato 2026-08-04 12:00
 ! 1 issue dipende da id inesistente: ffffffff
════════════════════════════════════════════════════════════════════════════════
 [###########################++++~~~~!!!!oooooooooooooooooooooooooooooooooooooo]
  # done 6  + in_progress 1  ~ in_review 1  ! blocked 1  o backlog 8

 IN CORSO
 ───────────────────────────────────────────────────────────────────────────────
  + 4f2a1b8c  in_progress  $$   vista albero delle catene
  ~ 9c31e07d  in_review    $    filtri per tier nel board, con scorciatoie...
  ! a47813e7  blocked      $$$  corsie lunghe contro archi corti

 LAVORABILI · 3 di 7
 ───────────────────────────────────────────────────────────────────────────────
  o 1787de25  $$   drawer con focus trap
  o 315ec0d9  $$   chain lens e pan/zoom
  o 730ba7d8  $    filtri tier, scorciatoie, tema
 ───────────────────────────────────────────────────────────────────────────────
 tier  $ economy   $$ standard   $$$ reasoning   - non dichiarato
```

Le otto in backlog non sono otto lavorabili: quella con la dipendenza rotta non lo è, e sono le
altre sette che l'intestazione conta in `3 di 7`.

Larghezza fissa **80 colonne**. Non c'è un terminale di cui leggere la larghezza: l'output
finisce in un blocco markdown reso dalla sessione.

### Intestazione

`<progetto> · <n> issue · aggiornato <data ora>`.

`<n>` conta l'intero tracker, `done` incluse. La data viene da `last_updated`, resa in ora
locale come `YYYY-MM-DD HH:mm`; se il campo manca o non è interpretabile, l'intestazione si
ferma al conteggio invece di stampare un valore grezzo.

Il nome è il campo `project` di `issues.json` quando c'è, altrimenti il basename della
directory del progetto — la stessa regola che il board applica già.

### Icone

| stato | icona | | tier | icona |
|---|---|---|---|---|
| `backlog` | `o` | | `economy` | `$` |
| `in_progress` | `+` | | `standard` | `$$` |
| `in_review` | `~` | | `reasoning` | `$$$` |
| `blocked` | `!` | | non dichiarato | `-` |
| `done` | `#` | | | |

**Le icone della barra sono le icone delle righe:** una sola convenzione, una sola legenda da
leggere. Sono ASCII pure di proposito — i glifi Unicode più belli (`●`, `◐`, `▓`) hanno
larghezza *ambigua* e su alcuni terminali occupano due colonne, disallineando proprio la
colonna che porta il significato. Le cornici (`═`, `─`) sono decorazione e possono permetterselo.

Il tier assente vale `standard` al momento del dispatch, ma qui si rende `-`: questa CLI dice
cosa c'è scritto nel tracker, non cosa qualcun altro ne dedurrà.

### Barra e legenda

I segmenti stanno sempre in quest'ordine da sinistra a destra, indipendentemente dalle
dimensioni: `#` done, `+` in_progress, `~` in_review, `!` blocked, `o` backlog. Il lavoro
chiuso a sinistra, il backlog intatto a destra, così la barra si riempie da sinistra man mano
che il progetto avanza. La legenda sotto usa lo stesso ordine.

La barra occupa 77 colonne fra parentesi quadre. **Non è proporzionale in senso stretto:** uno
stato con almeno una issue occupa sempre almeno una colonna, altrimenti una sola `blocked` su
duecento sparirebbe proprio quando serve vederla. L'errore di arrotondamento che questo
introduce viene assorbito dal segmento più largo, così la somma resta esatta.

La legenda sotto elenca **solo gli stati presenti**: un `! blocked 0` spiegherebbe un'icona che
in quella schermata non compare.

### Sezioni

`IN CORSO` raccoglie `in_progress`, `in_review` e `blocked`, in quest'ordine, e dentro ciascuno
mette per prima la issue toccata più di recente (`updated_at` decrescente). **Non si tronca
mai:** dodici righe qui sono un problema di WIP da vedere, non da riassumere.

`LAVORABILI · 3 di 7` significa **tre righe mostrate su sette issue lavorabili**, dalla più
vecchia (`created_at` crescente). Lavorabile è una issue in `backlog` le cui dipendenze sono
tutte `done`; una senza `depends_on` lo è per definizione. Una dipendenza che punta a un id
inesistente **non** rende lavorabile la issue: non si sa cosa manchi, e autorizzare lavoro che
dipende dal nulla è il modo di partire dalla parte sbagliata.

Il numero a destra non è il totale del backlog — quello compare nell'allerta di stallo.

I titoli si troncano a **45 caratteri** con tre punti ASCII (`...`, mai `…`, per la stessa
ragione di larghezza ambigua), e gli spazi interni si normalizzano prima: un a capo dentro un
titolo non può aggiungere una riga alla tabella. Gli id sono troncati a **8 caratteri**:
bastano a riconoscere una issue, non a passarla a `issue-manager.mjs`, che vuole il GUID intero.

### Stati vuoti

`nessuna issue aperta` sotto `IN CORSO` non è un errore di lettura: è la verifica 1-WIP, e
l'assenza è il dato.

`niente in backlog` compare sia quando il backlog è davvero vuoto sia quando è pieno ma
bloccato. A distinguere i due casi è l'allerta di stallo.

### Allerte

Righe con `!` davanti, **sopra la barra**, perché sono la prima cosa da leggere. Sono le sole
cose che le sezioni non possono mostrare da sé:

- `ciclo nei depends_on: <id> <id> ...` — una catena che si chiude su sé stessa. La ricerca è
  limitata alle issue **non `done`**: un ciclo fra issue chiuse è un fatto storico, non un
  problema di oggi, e segnalarlo ogni volta insegnerebbe a saltare la riga. Un ciclo non
  interrompe il resto dell'output; le issue coinvolte semplicemente non risultano lavorabili.
- `<n> issue dipendono da id inesistenti: <id> ...` — `depends_on` che puntano al nulla.
  Succede dopo una modifica a mano di `issues.json`, o dopo un archivio che ha portato via
  qualcosa ancora referenziato.
- `lavorabili 0 di <n> — ogni issue in backlog attende qualcosa` — stallo: il backlog non è
  vuoto e nessuna delle sue issue è prendibile. Qui `<n>` è il **totale del backlog**, non il
  totale delle lavorabili come nell'intestazione della sezione: è la coda della riga a dire
  quale dei due stai leggendo.

Un'allerta più lunga di 80 colonne **va a capo** su righe di continuazione indentate, non viene
troncata: troncare nasconderebbe proprio l'id che serve.

Le issue `blocked` **non** generano un'allerta. Compaiono in `IN CORSO` con la loro icona:
ripetere la stessa informazione due volte in quindici righe è rumore.

## Le due superfici

**Dentro la sessione** — `/harness:status`. L'agente lancia lo script e ne ristampa l'output
verbatim in un blocco di codice, senza riformattarlo: l'allineamento è già fatto, rifarlo costa
contesto e rende ogni invocazione diversa dalla precedente. La skill lo impone anche a clock-in
e a clock-out, dove il confronto fra le due schermate dice cosa si è mosso.

**Da un terminale esterno** — `node <path-plugin>/scripts/status-cli.mjs`, stesso identico
testo. Funziona, ma non è il caso per cui è progettato: harness non scrive un lanciatore nel
progetto per risolvere il path di sé stesso.
