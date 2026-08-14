# Riepilogo del tracker

`status-cli.mjs` stampa in una schermata sola dove sta il lavoro: conteggi, cosa è in corso,
cosa si può prendere adesso. È l'equivalente di `/context` per il tracker — si guarda prima di
decidere cosa fare, e al clock-in è l'unico passo di visibilità.

Non scrive niente. Nessun flag lo fa scrivere.

```bash
node "$SCRIPTS/status-cli.mjs" [--project-dir <path>] [--help]
```

## Dove sta il calcolo

Il riepilogo **rende**; a calcolare è `tracker-graph.mjs`, che non ha una riga di comando e non si
invoca da solo. Ci vivono le risposte sul grafo — quali issue sono lavorabili, quali dipendenze non
risolvono, se c'è un ciclo, e le catene su cui è scritta la regola 1-WIP. Il modulo nacque per
non tenere due copie della regola in due consumatori; oggi il consumatore che rende è uno solo,
e ciò che il modulo continua a dare è una regola provabile su oggetti invece che su una
schermata.

Nessuna funzione lì dentro legge o scrive un file: prendono issue e restituiscono dati. È ciò che
permette di provare la regola con oggetti in memoria invece che leggendo una schermata.

`--project-dir` serve solo se la cwd non è la radice del progetto. `--help` stampa l'uso ed
esce 0. Non ci sono altri flag e non ci sono sottocomandi: `parseArgs` è in modalità `strict`,
quindi un flag inventato fallisce invece di produrre un riepilogo che sembra giusto ma risponde
a un'altra domanda.

## Il canale è stdout, e il formato è testo

**Stdout porta tutto, anche gli errori. Su stderr non finisce mai niente.** Chi cattura solo
stderr per leggere il motivo di un fallimento non trova nulla e crede che il comando sia
rimasto muto.

**L'output è testo, mai JSON.** È una rottura dichiarata rispetto a `issue-manager.mjs`, che
stampa una riga JSON perché un agente la parsa: questo comando parla
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

## `--oneline`: il contratto qui si inverte

```bash
node "$SCRIPTS/status-cli.mjs" --oneline [--color]
```

```
1 in corso [2/9] | 4 backlog | 12 chiuse | T @ 16:34:50
1 in corso | 1 in verifica | 3 backlog | 9 chiuse ! | T @ 16:34:50
```

Una riga sola: i conteggi per stato, gli stati a zero omessi, `!` quando c'è un'allerta — un ciclo
o una dipendenza che non risolve — e in coda **l'ora di questa lettura**. Su un tracker vuoto la
riga è **vuota**: una barra di stato che dice «zero» spende per l'assenza di notizie la riga che le
era stata data, e «niente, alle 16:34:50» la spende lo stesso.

### Il conteggio dei task, e quando sparisce

`[2/9]` sono i task spuntati sul totale, e compaiono **solo quando c'è esattamente una issue in
volo** fra `in_progress` e `in_review`. Con due, quel numero sarebbe il progresso di quale? Un
numero che ha bisogno di una domanda per essere letto è peggio di nessun numero, e nella seconda
riga dell'esempio infatti non c'è.

**Quali task, dipende dallo stato.** Sotto `in_progress` sono i `tasks` di esecuzione, del worker.
Sotto `in_review` sono i `validation.tasks`, del verificatore: il worker ha finito — averli finiti è
ciò che ha portato la issue in verifica — quindi i suoi task sono spuntati per costruzione, e
l'unica checklist che si sta ancora muovendo è quella del giudizio. Contare i task di esecuzione lì
stampava `[6/6]` dall'istante in cui la issue entrava in verifica, e non era un conteggio sbagliato:
era il conteggio della cosa sbagliata.

Una issue `in_review` a **verifica leggera** non ha `validation.tasks`, quindi non porta parentesi:
non c'è niente da spuntare, ed è diverso da «è tutto spuntato».

Le parentesi quadre fanno da icona al posto di un glifo: in questo repository significano già
checklist — `- [x]` nell'export, `[x]` negli elenchi di task — quindi il numero si legge come task
senza bisogno di una legenda, e restano ASCII.

Una issue in volo **senza task** non stampa parentesi: `[-]` occuperebbe spazio per dire che non
c'è niente da dire. E una issue `blocked` da sola non porta il conteggio, perché non è ciò su cui
si sta lavorando.

### La coda della riga: `T @ 16:34:50`

Un dato solo: **l'ora in cui questa riga è stata prodotta**. La `T` è l'etichetta, abbreviata
perché in una barra di stato la riga è la risorsa scarsa, e l'ora accanto si spiega da sé.

Non ha rami: c'è sempre, su qualunque tracker, perché «adesso» è sempre conoscibile. Niente di
quello che sta scritto in `issues.json` la cambia.

Per un tratto la coda ha portato anche da quanto il tracker non veniva riscritto. Rispondeva a una
domanda che nessuno pone a una barra di stato, e per rispondere chiedeva due sguardi — una durata
va guardata muoversi. Non c'è più, e il capitolo qui sotto è la ragione per cui quella che resta è
la metà giusta.

#### L'ora del render, e perché è lei a fare il lavoro

**L'ospite può smettere di invocare il comando.** Non è un'ipotesi: il 2026-08-13 è stato misurato
con una sonda strumentata — 23 invocazioni regolari, poi **zero per otto minuti**, mentre il
tracker veniva scritto tre volte. Il comando non veniva ucciso a metà: non veniva chiamato. Il
referto sta in [docs/superpowers/analisi/2026-08-13-riga-di-stato-ferma.md](../../../docs/superpowers/analisi/2026-08-13-riga-di-stato-ferma.md).

Quando succede, **tutta la riga si congela**, e ogni campo che si legge in un colpo d'occhio
somiglia ancora a un dato: per smascherarlo bisognerebbe guardarlo due volte, a quindici secondi di
distanza, e sapere già che c'è qualcosa da sospettare.

L'ora del render no. Si confronta con l'**orologio che hai già sotto gli occhi**, in un colpo
d'occhio e senza aspettare: se la riga dice `16:34:50` e sono le 16:45, quella riga è di dieci
minuti fa e non c'è altro da stabilire.

E funziona per una ragione precisa, non per fortuna: **questo comando non ha cache**. Rilegge
`issues.json` a ogni esecuzione e il processo esce, quindi l'istante del render *è* la freschezza
dei conteggi. Un solo dato risponde a entrambe le domande.

Il caso peggiore, che il 2026-08-13 si è presentato davvero: la riga congelata mostrava
`7 backlog | 12 chiuse`, e il tracker in quel momento aveva **esattamente** sette backlog e dodici
chiuse. Numeri giusti su una riga morta da dieci minuti. Senza qualcosa che dicesse *quando*,
nessun numero di sguardi avrebbe potuto rivelarlo.

### `--color`

Aggiunge ANSI: ciano su ciò che si muove, giallo su ciò che aspetta il giudizio di qualcun altro,
rosso su ciò che è fermo e sul marcatore `!`, grigio sul backlog che nessuno ha ancora toccato,
verde sulle chiuse. Grigia anche la coda — etichetta e ora insieme, come un blocco solo — ma per
un'altra ragione: non è una cosa contata, è metadato della lettura, e non deve competere per
l'attenzione con il lavoro.

**È opt-in, e resta tale.** Il default non emette un solo byte di escape, perché l'ospite può
essere un prompt che li rende alla lettera invece di interpretarli — e una riga di stato piena di
`\x1b[36m` è peggio di una riga senza colore. Il colore aggiunge **vernice, non contenuto**:
togliendo gli escape si riottiene esattamente la riga in chiaro.

L'ordine non è quello della barra. La barra risponde a «quanto è arrivato avanti il progetto» e
apre col lavoro chiuso; questa riga risponde a «dove siamo adesso», e il lavoro chiuso è la cosa
meno urgente che ci sta sopra.

**Tutto quello che la tabella qui sopra dice, per `--oneline` non vale.**

| caso | uscita |
|---|---|
| qualunque cosa accada | **0**, e mai niente su stderr |
| `--project-dir` inesistente | 0, riga vuota |
| `issues.json` illeggibile o non valido | 0, riga vuota |

**Perché**, e non è un dettaglio d'implementazione. Questo comando gira a ogni aggiornamento di una
barra di stato, cioè di continuo. Un messaggio d'errore ripetuto lì è **peggio del silenzio**:
occupa la riga che esisteva per mostrare il lavoro, non si può chiudere, e non porta nessuna
informazione che chi guarda non possa ottenere lanciando il riepilogo intero. Quindi non fallisce
mai, non scrive mai su stderr, e degrada a riga vuota.

Il separatore è `|` e non `·`, e vale la stessa ragione per cui `--color` non è il default: il
riepilogo a schermo intero può permettersi caratteri non ASCII perché finisce in un blocco di
codice markdown, questa riga finisce in una barra di tmux o in un prompt PowerShell, dove né la
codifica né il supporto agli escape sono garantiti.

**È un'eccezione deliberata, non una svista da correggere.** Chi la trova e la "sistema"
riportandola al contratto generale rompe l'unica cosa per cui il flag esiste.

### L'ospite mostra, harness stampa

Harness non implementa una statusline: implementa un comando che stampa una riga. Tutto il resto è
configurazione dell'ospite, e non è codice di harness — è anche il motivo per cui staccarsi da
Claude Code non costa niente.

Le ricette qui sotto sono complete: **si copiano e si sostituiscono solo i due path**.

- `<plugin>` — la radice del plugin harness, cioè la directory che contiene `scripts/`. È quella
  che la skill chiama `$SCRIPTS` una volta aggiunto `/scripts`.
- `<progetto>` — la radice del progetto, cioè la directory che contiene `issues.json`.

`--project-dir` c'è in tutte e tre **apposta**: la cwd con cui l'ospite lancia il comando non è
garantita, e senza il flag una barra configurata una volta stampa la riga vuota appena la si guarda
da un'altra directory. Su un tracker che non c'è la riga esce vuota e basta, quindi un path
sbagliato non urla: si riconosce dal fatto che la barra tace.

**Claude Code** — `.claude/settings.json` del progetto, oppure `~/.claude/settings.json` per averla
ovunque:

```jsonc
{
  "statusLine": {
    "type": "command",
    "command": "node \"<plugin>/scripts/status-cli.mjs\" --oneline --project-dir \"<progetto>\"",
    "refreshInterval": 10
  }
}
```

`refreshInterval` è in secondi e **va messo**: senza, il comando gira solo sui trigger a evento, e
dentro un turno lungo — che è quando il tracker si muove di più — di eventi può non arrivarne
nessuno. Misurato: col timer attivo scatta a **10,0 secondi esatti**.

E **non basta**, il che è la ragione della raccomandazione qui sotto: nella stessa misura, con lo
stesso `refreshInterval: 10`, c'è stata una finestra di **otto minuti senza una sola invocazione**.
Quando succede non c'è niente da correggere nella configurazione — si riconosce dall'ora ferma, e
si esce riavviando la sessione.

**tmux** — in `~/.tmux.conf`. La seconda riga non è decorativa: il default di `status-interval` è
15 secondi, ed è quello, non harness, a decidere quanto fine sia il battito.

```bash
set -g status-right '#(node "<plugin>/scripts/status-cli.mjs" --oneline --project-dir "<progetto>")'
set -g status-interval 5
```

**Un pannello a fianco, e questa è la rete di sicurezza.** `--color` qui ha senso: un terminale gli
escape li rende.

```bash
watch -n 5 node "<plugin>/scripts/status-cli.mjs" --oneline --color --project-dir "<progetto>"
```

Su Windows `watch` non esiste, e il ciclo equivalente in PowerShell è una riga:

```powershell
while ($true) { Clear-Host; node "<plugin>\scripts\status-cli.mjs" --oneline --project-dir "<progetto>"; Start-Sleep 5 }
```

**Non è la terza ricetta alla pari: è l'unica che non dipende dall'ospite.** Il ciclo è un processo
tuo, e continua a girare anche quando la statusline di Claude Code smette di invocare il comando —
che è il modo di fallire misurato il 2026-08-13. Se hai bisogno di un dato di cui fidarti mentre
lavori, è questo, e la statusline è la comodità che ci sta accanto.

**Il refresh non coincide con i momenti in cui i conteggi cambiano.** È la cosa che questo
documento dichiarava e che la misura ha smentito: dentro un solo turno lungo il tracker è stato
scritto cinque volte, e tre di quelle scritture sono cadute in una finestra in cui il comando non è
stato invocato nemmeno una volta. Il refresh lo decide l'ospite, e l'ospite può anche fermarsi:
per questo la coda della riga porta l'ora, e per questo il pannello qui sopra esiste.

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
  + 4f2a1b8c  in_progress  $$   4/7    vista albero delle catene
  ~ 9c31e07d  in_review    $    3/3    filtri per tier nel tracker, con sc...
  ! a47813e7  blocked      $$$  2/5    corsie lunghe contro archi corti

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
directory del progetto.

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

Ogni riga porta il **conteggio dei task**, `spuntati/totali`, fra il tier e il titolo. È l'unico
dato che mancava a chi riprende il lavoro dopo un'interruzione, e compare nel punto e nel momento in
cui il riepilogo gira davvero: a un confine di sessione, che è dove ogni ripresa comincia.

Come in `--oneline`, il conteggio misura **chi ha in mano la issue adesso**: i `tasks` di
esecuzione sotto `in_progress`, i `validation.tasks` del verificatore sotto `in_review`. Una issue
`blocked` torna al worker, quindi torna ai task di esecuzione — anche se il `fail` ha lasciato
qualche task di giudizio spuntato.

Un `-` al posto del conteggio dice che la issue non ha task da mostrare in quello stato. Su una
issue `blocked` scritta prima del campo è la normalità; su una `in_progress` non può succedere,
perché la CLI rifiuta quel passaggio di stato senza almeno un task; su una `in_review` significa
verifica leggera, cioè nessuna checklist di giudizio. Un conteggio a tre cifre allunga la riga
invece di essere troncato: un numero tagliato mente, una riga lunga no.

Il conteggio **non** compare fra le lavorabili, e non è una dimenticanza: una issue in `backlog`
non ha ancora task, perché i passi li materializza chi la prende.

`LAVORABILI · 3 di 7` significa **tre righe mostrate su sette issue lavorabili**, dalla più
vecchia (`created_at` crescente). Lavorabile è una issue in `backlog` le cui dipendenze sono
tutte `done`; una senza `depends_on` lo è per definizione. Una dipendenza che punta a un id
inesistente **non** rende lavorabile la issue: non si sa cosa manchi, e autorizzare lavoro che
dipende dal nulla è il modo di partire dalla parte sbagliata.

Il numero a destra non è il totale del backlog — quello compare nell'allerta di stallo.

I titoli si troncano a **38 caratteri** con tre punti ASCII (`...`, mai `…`, per la stessa
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
- `backlog fermo: <n> issue, nessuna lavorabile — tutte attendono qualcosa` — stallo: il
  backlog non è vuoto e nessuna delle sue issue è prendibile. `<n>` è il **totale del backlog**.
  Questa riga non usa la forma `N di M` apposta: la userebbe due righe sopra `LAVORABILI · 0 di
  0`, dove gli stessi due numeri contano le lavorabili e non il backlog, e sullo schermo non ci
  sarebbe modo di distinguerle.

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
