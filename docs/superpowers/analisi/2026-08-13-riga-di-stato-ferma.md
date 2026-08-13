# Referto — perché la riga di stato è rimasta ferma

Misura condotta il 2026-08-13 sulla sessione che stava lavorando la issue `6a0ee313`.

## La domanda

Il 2026-08-13 verso le 14:05Z la riga di stato mostrava:

```
1 in corso [0/7] | 6 backlog | 11 chiuse
```

mentre `issues.json` sul disco diceva altro, e per circa quaranta minuti non è cambiata. Due
segnali indipendenti dicono che il comando **non è stato rieseguito** in quella finestra:

- `[0/7]` è lo stato del tracker subito dopo il clock-in; nel frattempo era passato a `[6/7]` e
  poi a `[7/7]`;
- **l'età non compare affatto**, mentre il codice a quel punto la emetteva sempre (quando
  `last_updated` c'è, e c'era).

Cosa è stato escluso prima di misurare, leggendo il codice: `status-cli.mjs` non ha nessuna cache.
`onelineFor` fa `readFileSync` di `issues.json` a ogni invocazione e il processo esce. Non esiste
stato fra un lancio e l'altro, quindi non esiste niente che possa restare indietro. Verificato
anche dal vivo: la stessa riga lanciata a mano rifletteva immediatamente ogni scrittura.

Resta una sola domanda misurabile: **Claude Code invoca il comando, e lo lascia finire?**

## L'ipotesi da falsificare

La statusline di Claude Code, se un nuovo trigger arriva mentre il comando è ancora in esecuzione,
**interrompe il run in volo invece di accodarlo**. Con un subagent che genera trigger di continuo,
il comando potrebbe non arrivare mai in fondo, e l'ultimo render *completo* resterebbe appeso —
congelato per costruzione, non per lentezza.

Se è vera, nel log compaiono `START` senza il corrispondente `END`.

## Come è strumentata

Gli artefatti grezzi stanno accanto a questo documento, in
[`2026-08-13-riga-di-stato-ferma/`](2026-08-13-riga-di-stato-ferma/): il wrapper e il log
integro, non riassunti. Chi vuole rifare i conti non deve fidarsi delle tabelle qui sotto.

- [`probe.mjs`](2026-08-13-riga-di-stato-ferma/probe.mjs) — wrapper attorno a
  `status-cli.mjs --oneline --color`. Scrive una riga di log all'avvio e una all'uscita, con pid,
  durata e la riga esatta che ha restituito. Ogni fallimento degrada a riga vuota: una sonda che
  rompe ciò che osserva non è una sonda. I path assoluti che contiene sono quelli della directory
  temporanea in cui è girata, e sono lasciati com'erano.
- [`probe.log`](2026-08-13-riga-di-stato-ferma/probe.log) — 46 righe, la misura intera.
- Il tracker su cui la sonda ha letto era una **copia** di quello reale, in una directory
  temporanea, più una issue fittizia («SONDA»). Il tracker vero non è mai stato toccato: lo vieta
  `CLAUDE.md`, e la misura non ci perde niente perché la directory di lavoro è indifferente alla
  domanda. La riga della sonda si distingueva a colpo d'occhio da quella vera: **7 backlog**,
  non 6.
- `.claude/settings.local.json` del progetto — `statusLine.command` puntato al wrapper per la
  durata della misura, e **ripristinato dopo**. `refreshInterval: 10` lasciato com'era: si misura
  la configurazione reale, non un'altra.

Costo di un'esecuzione, misurato a vuoto: **71 ms**.

## Fasi

| # | cosa | cosa dovrebbe dire il log |
|---|---|---|
| 0 | ~90s senza scritture, con una chiamata di tool in corso | invocazioni ogni ~10s se `refreshInterval` morde |
| 1 | scritture sul tracker a orari noti, senza subagent | ogni scrittura si riflette nella riga della prima invocazione successiva |
| 2 | **la riproduzione**: subagent lungo in corso, e scritture sul tracker mentre gira | qui l'ipotesi vive o muore |
| 3 | ripristino del config, rimozione della sonda | |

Il log dice cosa il comando ha restituito. Cosa sia finito *sullo schermo* lo può dire solo chi
guarda: è l'altra metà della prova, e va annotata fase per fase.

---

## Esito

### Fase 0 — nessun subagent: la riga è sana

Dalle 14:33:24 alle 14:34:50, **23 invocazioni**, mai un buco superiore a 15 secondi.

`refreshInterval: 10` **morde davvero**, e si vede a occhio nudo nei timestamp:

```
14:33:30.033 START
14:33:40.038 START
14:33:50.042 START
```

Dieci secondi esatti, con lo scarto di qualche millisecondo del timer. In mezzo, invocazioni
extra a distanza irregolare: sono i trigger a evento, che si sommano al timer senza sostituirlo.

Durata di un'esecuzione: **71–117 ms**. **Zero `START` senza `END`** in tutto il log.

### Fase 2 — con un subagent in corso: la riga smette di essere chiamata

Ultima invocazione: **14:34:50.806**. Poi più niente.

Nel silenzio che segue, il tracker viene scritto tre volte, ognuna con un effetto visibile sulla
riga (misurato lanciando il comando a mano subito dopo ogni scrittura):

```
14:36:21Z  in_progress [0/3]  ->  1 in corso [0/3] | 6 backlog | 12 chiuse | 0s
14:37:11Z  in_progress [1/3]  ->  1 in corso [1/3] | 6 backlog | 12 chiuse | 0s
14:38:01Z  in_review   [3/3]  ->  1 in verifica [3/3] | 6 backlog | 12 chiuse | 0s
```

Alle **14:38:10** — **3 minuti e 20 secondi** dopo l'ultima invocazione — l'ultimo render
consegnato all'ospite era ancora quello delle 14:34:50:

```
7 backlog | 12 chiuse | 2m 43s
```

Tre scritture del tracker non recepite, e `refreshInterval: 10` che nella fase precedente aveva
fatto scattare il timer nove volte di fila.

### Cosa è dimostrato, e cosa no

**Dimostrato:**

1. **Non è harness.** `status-cli.mjs` non ha cache: `readFileSync` a ogni lancio, processo che
   esce. Ogni invocazione registrata nel log ha restituito il valore **corretto al millisecondo**
   in cui è avvenuta. Non esiste un solo campione in cui il comando abbia stampato un dato vecchio.
2. **Il comando non viene ucciso a metà: non viene proprio chiamato.** Zero `START` senza `END` su
   tutto il log, in entrambe le fasi. L'ipotesi del run interrotto in volo è **falsificata**.
3. **`refreshInterval` non è ignorato**, e non basta: fa scattare il timer in fase 0 e non ne fa
   scattare **nessuno** in fase 2.

**Non dimostrato:** la causa del blocco. Il congelamento comincia alle 14:34:50, cioè **circa un
minuto prima** che il subagent venga lanciato (14:35:51). Quindi «il subagent congela la riga» è
una correlazione, non una causa stabilita: nella finestra 14:34:50–14:35:51 c'erano solo chiamate
di tool e notifiche di task. Quello che si può affermare è più stretto e più solido: **l'ospite
smette di invocare il comando per minuti interi, anche con `refreshInterval` attivo**, e mentre
non lo invoca il lavoro procede e il tracker cambia.

### Fase 3 — il blocco sopravvive a tutto tranne al riavvio

Dopo la fase 2 sono state tolte, una alla volta, tutte le cause candidate. Nessuna ha rimesso in
moto la riga:

| alle | cosa è stato tolto | invocazioni dopo |
|---|---|---|
| 14:41:35 | il subagent, fermato con TaskStop | nessuna |
| ~14:41 | due confini di turno (messaggi dell'utente) | nessuna |
| 14:42:5x | il config, riportato al comando reale | nessuna |

Il ripristino del config è la prova più stretta: alle **14:33:24** una modifica dello stesso file
aveva provocato una raffica di tre invocazioni in un secondo e mezzo. Dieci minuti dopo, la stessa
azione non ne provoca nessuna.

Da **14:34:50** la statusline di quella sessione non è più stata invocata, e nessuna leva a
disposizione l'ha riportata in vita. Il rimedio è riavviare la sessione: non c'è niente da
correggere nella configurazione, che è già giusta.

### La coincidenza che vale più di tutto il resto

Alle 14:45 la riga congelata mostrava:

```
7 backlog | 12 chiuse | 2m 43s
```

e il tracker reale, in quel momento, diceva **esattamente sette backlog e dodici chiuse** — la
issue aperta sul difetto stesso aveva riportato il backlog a sette.

Cioè: una riga morta da dieci minuti stava mostrando **i numeri giusti**. Senza l'età non sarebbe
stata distinguibile da una riga viva in nessun numero di sguardi, perché non c'era niente di
sbagliato da vedere. L'unica cosa che la smascherava era quel `2m 43s` fermo.

È anche la confutazione dell'obiezione «meglio uno spinner»: qui l'età non è un'informazione in
meno, è **l'unica informazione vera presente sulla riga**.

## Cosa ne è seguito

La causa a monte non è di harness e non è riparabile da qui. Quello che era riparabile è il fatto
che **non ci fosse modo di accorgersene**, e le tre cose seguite sono tutte lì:

1. **La riga chiude con l'ora del render**: `T @ 16:34:50`. L'età si smaschera solo guardandola
   cambiare; l'ora si confronta con un orologio che chi guarda ha già, in un colpo d'occhio e
   senza aspettare. Funziona perché il comando non ha cache — l'istante del render *è* la
   freschezza dei conteggi. Per qualche ora la coda ha portato tutte e due (`3m 12s @ 16:34:50`);
   poi l'età è stata tolta, perché chiedeva il secondo sguardo che l'ora aveva appena reso
   inutile.
2. **Il pannello `watch` diventa la rete di sicurezza** in
   [references/status.md](../../../skills/harness/references/status.md), invece di essere la terza
   ricetta alla pari: è un processo dell'utente, e sopravvive a un ospite congelato.
3. **La ricetta di Claude Code porta `refreshInterval`**, col suo motivo e col suo limite
   misurato: aiuta, e non basta.

Lo stesso documento dichiarava che il refresh «coincide con l'unico momento in cui i conteggi
possono essere cambiati davvero». Questa misura lo smentisce, e quella frase è stata tolta: era la
frase che insegnava a considerare innocua una riga ferma.

### Nota sull'età, che qui si è misurata da sola

Durante il blocco la riga mostrava `2m 43s` fermo, ed è l'unica cosa che l'ha smascherata: senza,
avrebbe detto `7 backlog | 12 chiuse`, indistinguibile da un dato corretto **per sempre**. Il
costo di riconoscerla passava da «impossibile» a «due sguardi», ed è da qui che è nata l'idea che
la coda debba dire *quando*.

Non è però il motivo per cui l'età è rimasta, perché **non è rimasta**. La proprietà che qui la
salva — un'età congelata si riconosce guardandola non muoversi — chiede appunto due sguardi a
quindici secondi di distanza, e l'ora del render ne chiede uno solo. Fatto il confronto, la coda
ha tenuto solo l'ora: la decisione e la sua ragione stanno in
[references/status.md](../../../skills/harness/references/status.md).
