# La continuità del lavoro, e l'invariante che la rendeva impossibile

Data: 2026-08-10

Terzo e ultimo dei deliverable emersi dall'analisi di `activitymanager`. I primi due sono
[2026-08-10-harness-regole-e-default-design.md](2026-08-10-harness-regole-e-default-design.md)
(la bussola, le prove fuori portata, il board fuori dal clock-in) e
[2026-08-10-harness-perdite-tracker-design.md](2026-08-10-harness-perdite-tracker-design.md)
(il gate documentale, il campo `covers`, il setaccio).

Dipende da entrambi: dal primo prende la bussola, dal secondo la migrazione di schema su cui la
propria si innesta.

È il più grosso dei tre, ed è cresciuto in corso d'opera. Era nato come «congelare e riprendere
una issue interrotta»; l'analisi ha mostrato che metà di quel perimetro non era rotto, e che
sotto ci stava una contraddizione più profonda.

## Problema

### 1. L'invariante centrale contraddice il modello di verifica

`SKILL.md` dichiara tre invarianti non negoziabili. Il secondo è **commit solo dopo
`validation.state = pass`**.

Il 2026-08-10, sulla issue `ef4f419b` di `activitymanager`:

| ora (UTC) | fatto |
|---|---|
| 08:12:44 | issue creata |
| 08:18:18 | **commit `f5cb4c8`** — ADR-010 e il ripuntamento delle dipendenze |
| 08:20:56 | il committente chiede `in_review` e il verificatore |
| 08:27:50 | `done` / `pass` |

Il commit precede il `pass` di nove minuti e precede persino l'`in_review`. Il verificatore lo ha
rilevato e registrato come riserva non bloccante: *«`f5cb4c8` è stato committato prima della
verifica, contro la regola di harness: strappo di processo»*.

Ma non è distrazione. Il criterio C4 di quella issue recita, testualmente:

> `git show f5cb4c8 --numstat` sulla spec madre: 67 aggiunte, 0 cancellazioni

**Un criterio formulato sulla revisione non è controllabile prima che la revisione esista.** Non
è un'infrazione a una regola: è una contraddizione fra due regole di harness, e chi lavora la
risolve come può, in silenzio, ogni volta.

E le altre due spec la **peggiorano**. P1 §2.2 prescrive che una prova fuori dalla portata
dell'agent sia un artefatto *committato* che *dichiara la revisione su cui è stato misurato*; P2
introduce `covers`, che nomina revisioni che devono esistere. Senza scioglierla qui, entrambi i
deliverable nascerebbero in conflitto con l'invariante che dovrebbero rispettare.

### 2. Il tracker sa quale issue è in volo, mai dove sta

Il 2026-08-06 alle 16:05 il committente scrive: «Devo interrompere il lavoro, congela tutto in
modo che possa riprendere il lavoro fatto domani».

Il congelamento **ha funzionato**, e interamente fuori da harness. L'agente ha scritto una
sezione «Stato dell'esecuzione — congelato il 2026-08-06» dentro il **piano**, con: ramo, sette
commit oltre la base, otto non spinti, albero pulito, tabella task per task, cosa manca, e — la
parte che si è rivelata più preziosa — *la decisione lasciata aperta dall'umano*, che era il vero
punto di ripresa.

Il contributo di harness è stato **zero**. Il tracker sapeva solo che `[F3.2]` era
`in_progress`; il riepilogo stampa `in corso` e nient'altro. Chi riprende deve già sapere che
esiste un piano e dove sta — in un progetto senza piano non c'è nessun posto.

Il caso non è isolato: nelle tredici sessioni ci sono **quattro riprese** («riprendiamo da dove
ci eravamo fermati», «riprendiamo il lavoro dove lo avevamo lasciato»), ognuna delle quali
comincia con «rileggi i documenti di plan e spec e adr». Il costo della ripresa è la rilettura
del corpus, ogni volta.

### 3. L'albero dei task viene ricostruito a runtime, ogni volta

È l'osservazione che ha riaperto il perimetro, e viene dall'uso prolungato della skill.

`description` e `validation.criteria` sono **prosa**. Ogni agente che prende una issue li rilegge
e ne ricava un albero di attività — a runtime, di nuovo da capo, e in modo leggermente diverso
dall'agente precedente. Quell'albero è la cosa su cui il lavoro procede davvero, e non esiste in
nessun posto: vive nella testa della sessione, e muore con lei.

È anche il motivo per cui il congelamento del punto 2 ha dovuto essere *scritto a mano* in un
documento: non c'era nessuna struttura che lo contenesse già.

## Cosa cambia, in una riga

L'invariante si sposta dal commit alla **pubblicazione**, e la issue guadagna due array di task
strutturati — uno per l'esecuzione, uno per la validazione — che rendono il congelamento un
**sottoprodotto del lavorare** invece di un rito da ricordare.

## 1. L'invariante si sposta dal commit alla pubblicazione

Il secondo invariante diventa: **nulla raggiunge il ramo condiviso prima del `pass`.** Il commit
locale su un ramo di lavoro è un punto fermo, non una pubblicazione; è il `push` — o il merge —
che il `pass` autorizza.

- **Il verificatore ci guadagna.** Lavora su un commit che esiste, e può usare `git show` e
  `git diff --stat`: che è esattamente ciò che il verificatore reale ha fatto in `ef4f419b`,
  senza poterlo dichiarare legittimo.
- **Il capitolo «Gate sul commit» diventa «Gate sulla pubblicazione»**, e `references/git.md`
  dice che i commit locali sul ramo di lavoro sono liberi mentre il `push` è il confine.
- **Il caso `fail` va scritto**, perché è l'obiezione principale. Una issue bloccata lascia
  commit sul ramo: restano lì, si corregge con altri commit, e si pubblica dopo il `pass`. È il
  funzionamento normale di git — ma non dirlo lascerebbe credere che serva riscrivere la storia,
  e qualcuno lo farebbe.
- **Cade la corrispondenza uno-a-uno fra issue e commit.** La regola «un commit per issue, come
  snapshot» si sposta al confine di pubblicazione: harness non prescrive di schiacciare la
  storia, prescrive che niente attraversi quel confine senza `pass`.

Questo **retro-giustifica** una scelta di P2: `covers` è un array, e ora ha un secondo motivo per
esserlo — una issue docs può coprire i sei commit locali di un tratto di lavoro, non uno solo.

## 2. I due array di task

```json
{
  "tasks": [
    { "id": 1, "short_title": "…", "full_description": "…", "checked": false }
  ],
  "validation": {
    "tasks": [ { "id": 1, "short_title": "…", "full_description": "…", "checked": false } ],
    "criteria": "…",
    "state": "unknown"
  }
}
```

`description` e `validation.criteria` **restano invariati e restano prosa**: sono il registro con
cui una issue spiega a una persona cosa vuole e perché. I due array sono la loro decomposizione a
uso dell'agente. Non è duplicazione: è la stessa cosa a due grane, e §3 impedisce che divergano.

**I task di validazione stanno dentro `validation`**, non accanto: è lì che vive tutto ciò che
riguarda il giudizio, guard compreso, e tenerli fuori spargerebbe la stessa nozione in due punti
dello schema.

### 2.1 Rapporto col livello a grana fine

I task **indicizzano, non sostituiscono**. `full_description` porta quanto serve ad agire —
comandi, esito atteso, il riferimento al passo di piano — non l'analisi che ci sta dietro.

Non contraddice la bussola di P1, e va detto esplicitamente perché a prima vista sembra farlo:
la bussola governa **dove scatta la verifica indipendente**, cioè dove si spende un agente
intero. Una checklist dentro la issue non crea nessun giro di verificatore in più. Il tracker
guadagna l'avanzamento, non diventa il documento.

L'alternativa — task autosufficienti, piano facoltativo — è scartata in §8: `issues.json` è
committato e condiviso, quello di `activitymanager` è già 109 KB, e ogni lettura del tracker lo
paga.

### 2.2 Limiti di formato

Tre decisioni prese in sede di design, non ereditate:

- **`short_title` si misura in caratteri, non in parole.** La proposta iniziale diceva «massimo
  dieci parole»; il vincolo vero però è che entri in una riga del riepilogo — già troncato a 45
  colonne — e in una riga del board. Contare parole è ambiguo fra lingue, trattini e sigle;
  contare caratteri no, ed è ciò che il rendering misura davvero.
- **`full_description` ha un tetto generoso, non è illimitato.** Abbastanza alto da non mordere
  mai un indice, abbastanza basso da fermare un manuale. Senza nessun tetto, la regola di §2.1
  sarebbe l'unica difesa — e questa analisi ha misurato tre volte quanto reggono le regole senza
  controllo. Vale qui la stessa logica già scritta in `references/issues.md`: un
  `LIMIT_EXCEEDED` non dice «comprimi», dice «quel contenuto non è una issue».
- **Nessun tetto al numero di task di descrizione.** La grana del livello sotto varia da progetto
  a progetto, e un limite spingerebbe ad accorpare passi veri per far passare il payload — lo
  stesso motivo per cui `depends_on` non ne ha. Il riepilogo mostra comunque un conteggio, non
  l'elenco.

`id` è un intero, unico nell'array e stabile: è locale e ordinale, e un GUID lo renderebbe
illeggibile in un contesto dove il riferimento utile è «il task 4».

## 3. Quando si scrivono, e chi può toccarli

### 3.1 I due momenti

**`validation.tasks` nascono con la issue**, come i criteri oggi: chi apre sa cosa deve essere
vero alla fine. Se `validation` è `null` — i quattro casi chiusi della verifica leggera di P1 —
non ci sono task di validazione, e la coerenza si mantiene da sé.

**`tasks` li materializza chi prende la issue**, al clock-in, prima di iniziare a lavorarla: è
chi sa *come* arrivarci. La CLI lo impone — portare una issue a `in_progress` senza almeno un
task viene rifiutato. È il punto in cui «predefinito a monte» smette di essere un'intenzione e
diventa un dato.

L'asimmetria non è un compromesso: è la stessa che la bussola di P1 già descrive al punto 3, dove
non riuscire a scrivere un criterio significa non sapere ancora come si riconosce il fallimento.
Chiedere a chi apre di indovinare anche i passi produrrebbe passi inventati, che il worker
riscriverebbe comunque.

### 3.2 Il guard si estende

Con `HARNESS_ROLE=worker`, spuntare un `validation.tasks[].checked` è `FORBIDDEN_ROLE`,
esattamente come `status=done` e `validation.state=pass`. Il worker spunta i propri task di
**esecuzione** e mai quelli di **giudizio**: spuntare un criterio che misura il proprio lavoro è
self-validation con un'altra sintassi.

Per lo stesso motivo si estende il divieto già scritto in `SKILL.md`: il worker non cancella né
riscrive i propri task di validazione, come già non può declassare i criteri. Cancellare ciò che
ti giudica e dichiararlo soddisfatto sono la stessa mossa.

### 3.3 Prosa e task si toccano insieme

Un `--update` che modifica `description` senza toccare `tasks` — o viceversa — viene rifiutato,
salvo un flag esplicito che dichiara invariata la decomposizione. Idem per `validation.criteria`
e `validation.tasks`.

È la stessa filosofia con cui la CLI difende già il DAG dai cicli: **impossibile per costruzione,
non sconsigliato a parole**. Senza, la deriva sarebbe silenziosa e peggiore dell'assenza dei
task — il verificatore misurerebbe una cosa e l'umano ne leggerebbe un'altra, e nulla lo direbbe.

## 4. L'ancoraggio al commit

**Prima di ogni commit, i task si allineano.**

Il punto è scelto sui numeri, non per eleganza: nelle tredici sessioni ci sono **82 commit contro
41 invocazioni di `status-cli`**. Il commit è l'azione osservata più frequente del workflow, il
doppio del riepilogo, ed è già un momento presidiato da harness.

**Cosa questo compra, detto onestamente: è una prescrizione, non una garanzia.** Quello che la
distingue dal gate documentale fallito è la forma del danno quando salta. Un gate saltato *perde*
un promemoria; un allineamento saltato lascia il tracker **indietro di un commit, non sbagliato**.

E ai due momenti che sono atti dichiarati — il clock-out, e l'istante in cui un umano dice
«congela» — l'allineamento è completo ed esplicito. Non sono riti impliciti: sono richieste.

## 5. Il congelamento diventa un sottoprodotto

### 5.1 `status-cli`

La riga sotto `IN CORSO` guadagna il conteggio:

```
 IN CORSO
 ───────────────────────────────────────────────────────────────────────────────
  [F3.2] Hop Angular 18 -> 19                          4/7   $$$
```

È l'unico dato che mancava a chi riprende, e compare nel punto e nel momento in cui il riepilogo
gira davvero — le riprese avvengono a un confine di sessione, quattro volte su quattro, ed è
esattamente lì che `status-cli` è affidabile (P2 §1).

Il troncamento a 45 colonne del titolo va rivisto per far posto alla colonna del conteggio.

### 5.2 Il board

**Resta in sola lettura.** Nessun endpoint di scrittura: si spunta solo dalla CLI.

La decisione era già presa e motivata in `references/board.md` — «le issue si cambiano con la
CLI, così ogni scrittura passa dalle stesse validazioni» — ma qui c'è un argomento più stringente
della coerenza. Il guard anti-self-validation **vive nell'environment del processo**: rifiuta
perché chi invoca ha `HARNESS_ROLE=worker`. Un click nel browser non porta con sé nessun ruolo.
Per rispettarlo, il server dovrebbe deciderlo per conto proprio, cioè reimplementare in un
secondo posto l'unica difesa tecnica che harness possiede.

La card guadagna due righe e nient'altro; i task compaiono solo espandendo:

```
┌───────────────────────────────────┐
│ [F3.2] Hop Angular 18 → 19        │
│ in_progress   reasoning           │
│                                   │
│ Porta il frontend dalla 18 alla   │
│ 19 con ng update, senza toccare…  │
│                                   │
│ ▸ task  ▓▓▓▓▓▓░░░░  4/7           │
│ ▸ validazione        0/3          │
└───────────────────────────────────┘
```

Il vincolo che governa la scelta: **oggi la card non nasconde niente** — mostra la `description`
intera, tutti i criteri, un chip per dipendenza — e non esiste nessun meccanismo di collasso.
Aggiungere dodici task di esecuzione e sei di validazione sempre visibili produrrebbe card che da
sole riempiono lo schermo, e la board perderebbe la cosa per cui esiste: vedere dove sta il
progetto in un colpo d'occhio. L'espansione è quindi una capacità **nuova** della pagina, non un
ritocco.

### 5.3 La decisione aperta non ha bisogno di un campo

Nel congelamento reale la parte più preziosa era la decisione lasciata in sospeso — 82 errori di
lint, tre strade, nessuna scelta. Nel modello nuovo è **un task non spuntato**, il cui
`short_title` è la decisione da prendere. Il modello la copre già, e aggiungere un campo apposta
sarebbe rappresentare due volte la stessa cosa.

### 5.4 Lo stato git non entra nel tracker

Ramo, commit avanti, commit non spinti: è a un comando di distanza, cambia a ogni commit, e
duplicarlo in `issues.json` produrrebbe un dato stantio con l'aria di essere fresco. Il tracker
dice cosa è fatto e cosa è aperto; git dice dov'è.

## 6. Cosa non è qui

### 6.1 Il rovesciamento del grafo delle dipendenze — e perché esce

Era metà del perimetro iniziale di P3. **Esce, e con una prova.**

Il ripuntamento imposto da ADR-010 ha toccato dieci issue in un colpo: nove hanno perso l'arco
verso `[F3.5]`, e `[F3.5]` ne ha acquistati cinque. È stato fatto come **una issue tracciata**
(`ef4f419b`), con sette criteri, verificata da un agente indipendente che ha girato uno script
read-only su `issues.json` per DFS, cicli e riferimenti pendenti — e che ha trovato tre residui
veri, fra cui una description rimasta disallineata e una maiuscola sbagliata da una sostituzione.

Gli strumenti esistenti hanno retto l'operazione più invasiva che quel tracker abbia subito.
**Non c'è nessuna primitiva mancante da costruire**, e costruirne una sarebbe costruire contro
l'evidenza. Questa spec lo registra perché la prossima volta la domanda tornerà.

### 6.2 Il resto

- **L'automazione della spunta.** Agganciarla a un hook riporterebbe il modello v1 che il
  passaggio a plugin ha rimosso deliberatamente.
- **La stabilità del processo del board**, dichiarata fuori scope fin da P1 e destinata a una
  issue di questo tracker.

## 7. Come si verifica

`SCHEMA_VERSION` va a `3`. P2 porta `covers` con la migrazione `1 → 2`, P3 porta i due array con
la `2 → 3`: sono migrazioni sequenziali nella lista ordinata che `--upgrade` già percorre, si
applicano solo se comprese fra la versione del file e `SCHEMA_VERSION`, e non si intralciano. Un
tracker fermo a `1` le prende entrambe in un giro solo.

Test nuovi su quattro superfici:

- **forma e integrità dei task** — `id` unico e intero, limiti di `short_title` e
  `full_description`, `checked` booleano, chiave assente letta come `[]`, migrazione `2 → 3`
  idempotente, `--compact` che preserva i campi negli originali archiviati;
- **i guard** — `validation.tasks[].checked` rifiutato con `HARNESS_ROLE=worker`, aggiornamento
  appaiato prosa/task, `in_progress` rifiutato senza task;
- **la resa in `status-cli`** — il conteggio, il nuovo troncamento, il caso senza task, dati in
  memoria come già fa `buildSnapshot`;
- **il board** — le due righe di riepilogo e l'espansione, sulla suite `plugin-board.test.mjs`
  che già esiste, più la conferma che nessun endpoint di scrittura è comparso.

**Lezione di P2 applicata subito:** il contratto dei campi nuovi va in `references/issues.md`,
che è già la reference che possiede lo schema, e il flusso — quando si materializzano, chi può
spuntarli, l'ancoraggio al commit — in `SKILL.md`. Nulla di tutto questo dentro un comando.

## 8. Alternative scartate

**Task autosufficienti, con il piano facoltativo.** `full_description` conterrebbe tutto il
necessario a eseguire, e chi riprende leggerebbe solo il tracker. Scartata per il peso:
`issues.json` è committato, condiviso e riletto a ogni comando; quello di `activitymanager` è già
109 KB con la sola prosa. E dissolverebbe la separazione che P1 ha appena stabilito fra il
tracker e il livello sotto.

**Forma dei task lasciata libera al progetto.** Massima adattabilità. Scartata perché due issue
dello stesso tracker potrebbero essere una un indice e l'altra un manuale, e nessun lettore —
umano, agente o `status-cli` — saprebbe cosa aspettarsi.

**I criteri non nominano mai una revisione**, così l'invariante «commit dopo il pass» resta
intatto alla lettera. Scartata perché contraddice la regola di P1 sulle prove fuori portata, che
richiede un artefatto committato con la sua revisione, e svuoterebbe `covers` di P2.

**Un'eccezione dichiarata caso per caso**: quando un criterio nomina una revisione, il commit
precede la verifica e la issue lo dichiara. Meno invasiva, e la deroga resterebbe visibile.
Scartata perché introduce una seconda strada accanto alla prima, e chi ha fretta sceglierà sempre
quella con meno attriti — finché la prima non è più la regola ma il caso raro.

**Spunta continua senza ancoraggio, con harness che mostra quando è vecchia.** Nessun vincolo
nuovo, visibilità invece di garanzia — la stessa forma del gate documentale cumulativo di P2.
Scartata perché lì la staleness è misurabile contro git, qui no: un `2/7` fermo da tre ore non si
distingue da un `2/7` vero, e un dato che sembra fresco è peggio di un dato assente.

**Task dichiarati solo ai passaggi di stato.** Il tracker sarebbe sempre coerente e non ci
sarebbe nessun rito durante il lavoro. Scartata perché non coprirebbe il caso per cui il modello
nasce: l'interruzione a metà.

**Solo la checklist di cosa un congelamento deve catturare, senza campi nuovi.** Doc-only e
coerente con P1. Scartata perché lascerebbe il tracker muto: chi riprende dovrebbe comunque già
sapere dove guardare, che è esattamente il costo misurato in §2 del problema.

**Un puntatore sulla issue al documento che contiene lo stato congelato.** Una riga, nessuna
duplicazione. Scartata perché è stata superata: con i task strutturati lo stato *è* nel tracker,
e un puntatore a un documento esterno sarebbe un'indirezione verso qualcosa che può essere
rinominato, spostato o non esistere affatto.

**Board scrivibile**, in tutto o per i soli task di esecuzione. Scartata in §5.2: il guard vive
nell'environment del processo e un click non porta un ruolo.

## Collegate

- [2026-08-10-harness-regole-e-default-design.md](2026-08-10-harness-regole-e-default-design.md)
  — la bussola che §2.1 non deve contraddire, e la regola sulle prove committate che §1 rende
  finalmente coerente.
- [2026-08-10-harness-perdite-tracker-design.md](2026-08-10-harness-perdite-tracker-design.md)
  — `covers` e la migrazione `1 → 2` su cui si innesta la `2 → 3`.
- `skills/harness/references/issues.md` — lo schema, i limiti di formato, il guard
  `FORBIDDEN_ROLE`, la difesa del DAG come precedente dell'aggiornamento appaiato.
- `skills/harness/references/board.md` — la sola lettura, decisa e motivata prima di questa spec.
- `skills/harness/references/git.md` — il ramo di lavoro e il confine di pubblicazione.
