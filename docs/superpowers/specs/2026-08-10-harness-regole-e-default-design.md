# Regole e default che harness non aveva

Data: 2026-08-10

Nasce da un'analisi del progetto `activitymanager`, primo consumer esterno di harness: la
migrazione Angular 17 → 21 di `FrontEnd/manage-hours`, tracciata su 33 issue, condotta fra il
2026-08-05 e il 2026-08-10 con harness e `superpowers` in combinazione.

Il materiale letto: il tracker in tutti gli stati, i dieci ADR, il registro del debito, i referti
di smoke e di run CI, e le tredici sessioni di Claude Code del progetto — da cui sono stati
estratti i 150 turni umani, che sono il posto dove le correzioni al workflow compaiono per prime.

Questa spec copre **il primo dei tre deliverable** emersi. Gli altri due sono dichiarati in §4.

## Problema

Tre difetti distinti, con prove nel progetto reale, non impressioni.

### 1. Harness non dice quando si apre una issue, e il vuoto costa

Il primo tentativo di tradurre il piano di migrazione in issue ne ha prodotte **21**, una per
task. Il difetto è emerso prima di scriverle: 21 issue significano 21 esecuzioni del
verificatore, ognuna un giro d'agente completo su criteri che il livello sotto già controllava
inline. La verifica sarebbe costata più del lavoro verificato.

Il progetto se l'è risolto da sé scrivendo `ADR-001`, che ha prodotto una regola generale: *si
apre una issue dove un errore sarebbe **costoso e invisibile***. Applicata, ha portato quel
primo tentativo da 21 issue a 12.

Quella regola in harness non c'è. Peggio: la premessa di `SKILL.md` dice l'opposto — «ogni pezzo
di lavoro è una issue tracciata» — e chi legge solo la premessa riparte da 21.

### 2. Un criterio può chiedere una prova che il verificatore non può raccogliere

`references/issues.md` chiede oggi che ogni criterio sia «verificabile da un altro agente che non
ha visto la conversazione». Non dice **che ha gli stessi accessi del worker**, ed è lì che il
progetto si è rotto.

La issue `[F2.3]` portava un criterio che chiedeva di verificare `yarn` e Playwright sull'agent
Jenkins — un server Windows self-hosted a cui nessun agente ha accesso. Il verificatore ha
bloccato la issue, correttamente. Si è sbloccata solo perché il committente ha riformulato il
criterio a mano e ha firmato la riformulazione: un ciclo di `blocked` più una firma, e nessuna
regola che impedisse al caso di ripresentarsi al criterio successivo.

Anche qui il progetto ha scritto la propria regola, `ADR-008`:
il criterio nomina un artefatto committato, non l'azione irraggiungibile, e il verificatore legge
un file che ha in mano. Prevenzione in scrittura invece di correzione a valle.

### 3. Il clock-in impone un processo che l'unico consumer reale ha vietato

Il passo 4 di `Clock in` dice «avvia il board delle issue e stampa l'URL una volta sola». La
memoria di progetto di `activitymanager` dice l'esatto contrario: non avviarlo mai di iniziativa
propria, e stampare `/harness:status` fra una issue e l'altra in ogni caso.

Il motivo è misurato, non un'antipatia. In una prima sessione il processo del board è morto tre
volte — durate di circa 50, 25 e 16 minuti, quindi non un timeout fisso da configurare —
lasciando ogni volta un URL annunciato come attivo e già morto. In una sessione successiva ha
retto 55 minuti, fermato deliberatamente al clock-out. L'instabilità non è sistematica, il che è
la cosa peggiore: non se ne può nemmeno diffidare sempre.

Il risultato pratico è che un passo obbligatorio della skill viene disobbedito per iscritto, e
la fonte affidabile è diventata il riepilogo testuale, che non dipende da un processo che deve
sopravvivere fra un turno e l'altro.

## Cosa cambia, in una riga

Harness ammette che non tutto il lavoro è una issue, che un criterio deve stare dentro la portata
di chi lo verifica, e che il board è uno strumento che si chiede — non un passo del clock-in.

Nessuno script viene toccato. Si scrivono tre file: `skills/harness/SKILL.md`,
`skills/harness/references/issues.md`, `skills/harness/references/verification.md`, più un
paragrafo in `skills/harness/references/board.md`.

## 1. La bussola: cosa diventa una issue

### 1.1 La premessa cambia

`SKILL.md` apre oggi con tre clausole: ogni pezzo di lavoro è una issue tracciata, ogni issue è
verificata da un agente diverso, si committa solo dopo. La seconda e la terza sono invarianti e
restano intatte. **La prima non lo è mai stata**, e viene riscritta: è una issue il lavoro che
vale la pena far guardare a qualcun altro, con rimando al capitolo che dice quale.

Il resto della premessa — cosa harness scrive nel progetto, cosa vive nel plugin — non si tocca.

### 1.2 Capitolo nuovo, e dove va

Titolo: **`Cosa diventa una issue`**. Collocazione: subito **prima** di «Verifica leggera: issue
che nascono senza criteri», e dopo «Tier».

La collocazione è il punto. I due capitoli sono la stessa domanda a due stadi — *questo lavoro
entra nel tracker?*, e poi *quanta cerimonia gli serve una volta entrato?* — e leggerli separati
li fa sembrare due argomenti. «Verifica leggera» oggi si apre nel vuoto, perché presuppone una
issue già decisa senza aver mai detto come si decide.

### 1.3 Il contenuto

**La domanda unica.**

> Se qui venisse commesso un errore, sarebbe **costoso e invisibile**?

Servono entrambe le cose. Un errore costoso ma rumoroso non ha bisogno di uno sguardo
indipendente: il comando `verify` lo urla al primo tentativo. Un errore invisibile ma innocuo non
vale il prezzo. È l'intersezione a giustificare una issue.

**Il prezzo, detto in numeri.** Una issue è un giro di verificatore, cioè un agente intero. È
l'unità di costo di harness, ed è ciò che rende la domanda decidibile invece che filosofica: una
issue per passo di piano vuol dire che il controllo costa più della cosa controllata, e si vede
contando gli agenti. La bussola non è un invito alla parsimonia in astratto — è il modo di
spendere quel budget dove rende.

**Il corollario, e il confine con le altre skill.** Sotto il tracker esiste un livello a grana
fine: passi da pochi minuti, ognuno con la propria verifica fatta **inline dallo stesso agente
che lavora**, che costa quasi niente proprio perché non cambia agente. Harness **non prescrive
come lo produci** — un piano scritto, una lista di todo, o niente di scritto. Prescrive una cosa
sola: il tracker non è quel livello, e non deve inseguirlo. La corrispondenza fra issue e passi
non è uno a uno e non deve esserlo.

Questa formulazione è deliberatamente agnostica. In `activitymanager` quel livello è il piano di
`superpowers:writing-plans`, ma harness non dipende da nessuna skill di terze parti e non può
nominarla.

**L'ordine per il lavoro che emerge a metà.** Quando durante il lavoro compare qualcosa di non
previsto, nell'ordine:

1. rientra in qualcosa di già previsto → è un passo in più lì dentro, nessuna issue;
2. è nuovo, ma il suo errore sarebbe **rumoroso** → è un passo nuovo, nessuna issue;
3. il suo errore sarebbe **costoso e invisibile** → è una issue, **e serve un criterio eseguibile
   che renda visibile il fallimento**. Se non riesci a scriverlo, il problema non è la issue: è
   che non sai ancora come si riconosce il fallimento, e va capito prima;
4. cambia una decisione già presa e scritta → prima il documento, poi la issue.

Il punto 3 è il più utile dei quattro, perché trasforma un giudizio in una prova di scrittura:
la bussola chiede di stimare l'invisibilità di un errore, il criterio chiede di renderlo visibile.
Se il secondo non si scrive, la stima era ottimistica.

**Cosa la bussola non dice.** Non dice quanto lavoro sta dentro una issue. Una issue larga è una
finestra più larga fra due verifiche: se il tratto va storto a metà, se ne accorge il verificatore
alla fine e non prima. È un rischio che si accetta guardandolo — mitigato dalle verifiche del
livello sotto, che restano — non un difetto da correggere spezzettando, che riporterebbe a 21.

### 1.4 Rapporto con «Verifica leggera»

Il capitolo esistente non cambia. Guadagna una riga di raccordo che dice che la sua lista chiusa
di quattro casi si applica **dopo** che la bussola ha detto sì: sono issue vere, che meritavano di
entrare nel tracker, e per cui inventare tre criteri sarebbe rumore.

## 2. Il criterio deve stare nella portata del verificatore

### 2.1 In `references/issues.md`

Fra le «Regole che la CLI non può misurare» c'è oggi:

> ogni criterio è una cosa verificabile da un altro agente che non ha visto la conversazione:
> "funziona bene" non lo è, "il comando X esce 0 e stampa Y" sì;

Guadagna la sua metà mancante: **e che quell'agente può controllare con i propri accessi.** Il
verificatore ha l'ambiente del worker, non di più. Un criterio che chiede di guardare un server
a cui non arriva, una console web o un ambiente in linea non è verificabile, ed è un criterio
scritto male — non un verificatore limitato. Si riformula su un artefatto che entra nel
repository, e il come sta in `verification.md`.

La regola resta fra quelle **non misurabili dalla CLI**: nessun controllo automatico può sapere
se un criterio nomina qualcosa di raggiungibile. Il valore è tutto nel momento in cui la issue
si scrive.

### 2.2 In `references/verification.md`, capitolo nuovo

Titolo: **`Quando la prova sta fuori dalla portata dell'agent`**.

**Quando scatta.** La prova è *impossibile* da raccogliere dall'ambiente di lavoro — non soltanto
scomoda. Se è scomoda, si fa. La distinzione è la prima cosa da scrivere, perché è quella che
impedisce alla regola di diventare una scorciatoia per delegare all'umano lavoro che l'agente
poteva fare.

**In scrittura: il criterio nomina l'artefatto, non l'azione.** Non «il job X esce verde», ma
«esiste `<path>` con esito verde su …, per la revisione `<SHA>`». Chi verifica legge un file che
ha già in mano, e non gli serve nessun accesso che non ha.

Harness non prescrive né il formato dell'artefatto né la cartella dove vive: quelle le decide il
progetto, e harness non semina file. Prescrive tre proprietà:

| proprietà | perché |
|---|---|
| **committato** | un artefatto fuori dal repository non è raggiungibile dal verificatore più della cosa che sostituisce |
| **dichiara su quale revisione è stato misurato** | una misura fatta altrove misura ciò che era stato spinto, non ciò che sta nel working tree. Senza la revisione l'artefatto non dice se ha misurato la cosa che si crede |
| **porta le righe decisive verbatim, più un puntatore alla fonte** | il log intero è rumore — in un caso reale, 3 righe decisive su 234 — ma senza le righe e senza la fonte l'artefatto è il racconto di qualcuno |

**La richiesta all'umano ha quattro voci, tutte obbligatorie.**

1. **Cosa lanciare** — comandi esatti e copiabili, o nome del job e parametri.
2. **Cosa serve indietro** — quale output, e quanto: tutto, o da un certo punto in poi.
3. **Su cosa si prosegue intanto** — l'assunzione con cui il lavoro continua mentre la risposta
   non c'è, scritta, così che un esito contrario dica subito che cosa cade.
4. **Perché non si può fare da qui** — una riga. Se non è scrivibile, la richiesta non va fatta:
   significa che era eseguibile senza disturbare nessuno.

**Il lavoro non si ferma ad aspettare.** Si chiede appena la necessità è nota e si prosegue su
tutto ciò che non ne dipende. L'eccezione è una sola, e va scritta: quando l'assunzione è così
portante che proseguire significherebbe rifare tutto in caso di esito contrario.

**La valvola, per i criteri fuori portata già scritti.** La regola sopra previene; questa
gestisce i casi in cui non ha funzionato.

- Il worker dichiara l'impossibilità e si ferma. **Non riformula il criterio.**
- Il verificatore **blocca** la issue. È la condotta giusta, non un incidente da evitare: un
  verificatore che passa oltre un criterio che non ha potuto controllare è un verificatore che
  non serve a niente.
- La riformulazione la firma **il committente, mai il worker a cui gioverebbe**, e la firma resta
  nella `description` della issue.

Va detto esplicitamente che questa è l'**eccezione disciplinata** al divieto già scritto in
`SKILL.md` di declassare a posteriori i criteri — non una contraddizione. Stessa logica e stesso
motivo: chi trae vantaggio da un criterio più debole non è chi può indebolirlo. Cambia solo chi
tiene la penna.

## 3. Il board esce dal clock-in

- **`SKILL.md`, `Clock in`:** il passo 4 sparisce, i successivi si rinumerano. Il riepilogo di
  `status-cli` resta e diventa **l'unico** passo di visibilità: è testo, sta nella sessione, e non
  dipende da un processo che deve sopravvivere fra un turno e l'altro.
- **`SKILL.md`, `Clock out`:** «Poi ferma il board server avviato al clock-in» diventa
  condizionale — se è stato avviato, si ferma.
- **`references/board.md`:** un paragrafo che dice perché il default è questo, con le durate
  misurate (16, 25 e 50 minuti in una sessione, 55 in un'altra), e la regola che ne discende: un
  URL non si annuncia come attivo senza saperlo tale, perché un URL morto spacciato per vivo è
  peggio di nessun board.

**Cosa non cambia:** `/harness:board` resta identico e il board non viene deprecato. La memoria
del progetto reale dice «lo chiede caso per caso, non è escluso», ed è esattamente il
comportamento che questo default produce.

## 4. Cosa non è qui

Dichiarato per confine, non per dimenticanza. Ognuno di questi ha il proprio giro di spec.

**Le perdite del tracker.** Il gate documentale non è più un hook `post-commit`: è una riga di
`SKILL.md` che dice «questo controllo lo fai tu», e in `activitymanager` ha retto una volta su
tre — esistono issue docs per gli hop 18 e per la Fase 2, non per gli hop 19 e 20, e
`ARCHITECTURE.md` dichiara ancora Angular 18 con la 20.3.27 installata. Accanto a questo, il
2026-08-10 è servito un audit manuale dell'intero corpus documentale
(`docs/debt/occasioni-non-tracciate.md`) per recuperare circa venticinque occasioni scritte in
spec, piani e referti e mai diventate issue — fra cui due difetti vivi rimasti in due referti di
smoke per due hop, e una voce di debito che una spec aveva **deciso** di scrivere e che nel
registro non c'è. È il deliverable con le prove più dure, ed è l'unico che vuole codice.

**La continuità del lavoro.** Non c'è posto dove congelare una issue interrotta a metà — «congela
tutto in modo che possa riprendere domani», più tre sessioni aperte con «riprendiamo da dove ci
eravamo fermati» — e rovesciare il grafo delle dipendenze quando una decisione lo impone costa N
update a mano, come è successo quando la migrazione si è fermata alla 21 e otto issue hanno
cambiato verso in un colpo.

**La stabilità del processo del board.** È codice, non documentazione, e resta fuori da qui per
questo. Diventa una issue di questo tracker: lasciarla in un paragrafo di questa spec sarebbe
esattamente il difetto che il deliverable sulle perdite esiste per chiudere.

## 5. Come si verifica

Il gate resta il comando `verify` di `.harness/config.json`, cioè `npm run test`.

`test/plugin-skill.test.mjs` copre già la struttura, e continua a valere senza modifiche:
frontmatter di `SKILL.md`, ogni link a una reference che risolve, ogni reference raggiungibile
dalla skill, nessun rimando ai macchinari rimossi in v1, invocazioni del tracker sempre via
`$SCRIPTS`. Una modifica doc-only che rompesse un link o una reference orfana diventerebbe rossa.

Sopra ci vanno criteri di contenuto, controllabili da un altro agente con `grep` e con la lettura
del file, e tutti dentro la portata del verificatore:

- `SKILL.md` contiene il capitolo `Cosa diventa una issue`, collocato fra `Tier` e
  `Verifica leggera`;
- la premessa di `SKILL.md` non contiene più la formula «ogni pezzo di lavoro è una issue
  tracciata»;
- `SKILL.md`, capitolo `Clock in`, non contiene più il passo che avvia il board, e `Clock out` lo
  cita in forma condizionale;
- `references/issues.md` lega la verificabilità di un criterio agli **accessi** del verificatore,
  e rimanda a `verification.md`;
- `references/verification.md` contiene il capitolo sulle prove fuori portata con le quattro voci
  della richiesta e la regola su chi firma la riformulazione;
- `references/board.md` dice perché il board non è più un passo del clock-in;
- `npm run test` esce 0.

Nessuno di questi criteri richiede accessi che il verificatore non ha: è il primo posto dove la
regola di §2 si applica a sé stessa.

**Nota sul gate documentale di questo repository.** `docsGate.exclude` contiene `**/*.md`, quindi
un commit doc-only non genera issue di documentazione a cascata. È il comportamento voluto.

## 6. Alternative scartate

**La bussola solo in `references/issues.md`, lasciando la premessa com'è.** Meno invasivo, e
`issues.md` è il posto dove le regole di scrittura di una issue già vivono. Scartata perché il
difetto è nella premessa: chi legge `SKILL.md` e si ferma lì legge che ogni lavoro è una issue, e
riparte da 21. Una correzione che sta solo dove va cercata non corregge chi non la cerca.

**Bussola e protocollo delle prove entrambi in `SKILL.md`.** Massima probabilità di essere letti,
perché la skill si carica sempre. Scartata per asimmetria: la bussola **deve** stare nella skill
perché ne contraddice la premessa, il protocollo no — serve nel momento in cui si sbatte contro
il muro, ed è esattamente il momento in cui una reference la si va a cercare. Metterlo nella
skill farebbe pagare a ogni sessione di ogni progetto un costo che serve ad alcuni.

**Una reference nuova, `references/out-of-reach.md`.** Terrebbe `verification.md` concentrato sul
verificatore e ogni file corto. Scartata perché il protocollo non è un argomento a sé: è la
risposta alla domanda «e se il verificatore non può controllare?», che è una domanda su
`verification.md`. Un file separato aggiungerebbe una voce all'indice e un posto in più dove
guardare, per un contenuto che è già in tema dov'è.

**Portare anche le convenzioni di ADR-008 — cartella dei log grezzi e cartella dei referti — con
i percorsi dichiarati in `.harness/config.json`.** Coprirebbe di più, e renderebbe la regola
eseguibile invece che raccomandata. Scartata su due motivi: farebbe smettere P1 di essere
doc-only, e soprattutto harness inizierebbe a dire ai progetti come si chiamano le loro cartelle,
che è la cosa che ha deliberatamente evitato di fare finora (non scrive `.gitignore`, non semina
file, non crea documenti).

**Il board opt-in dichiarato in `.harness/config.json` con un campo `autostart`.** Renderebbe la
scelta del progetto invece che della sessione, e non si ridiscuterebbe. Scartata perché tocca
`harness-config.mjs` e i suoi test, quindi lo stesso motivo di sopra; e perché il default
proposto — si avvia se qualcuno lo chiede — non ha bisogno di essere configurato per essere
rispettato.

**Lasciare il board al clock-in, aggiungendo solo la regola che un URL non si annuncia senza
verificarlo.** Difende dal difetto peggiore senza rinunciare al board. Scartata perché non
risponde all'osservazione vera: l'unico consumer reale ha smesso di usarlo e ha trovato il
riepilogo testuale sufficiente. Un passo obbligatorio che viene disobbedito per iscritto è un
default sbagliato, non un default da rinforzare.

## Collegate

- `activitymanager/docs/adr/ADR-001-grana-delle-issue-harness.md` — la bussola, come è stata
  derivata sotto pressione e cosa ha prodotto applicata.
- `activitymanager/docs/adr/ADR-008-referto-per-le-misure-fuori-portata.md` — il protocollo delle
  prove fuori portata, e il caso `[F2.3]` che è il costo che evita.
- `activitymanager/docs/debt/occasioni-non-tracciate.md` — l'audit che ha reso misurabile il
  deliverable sulle perdite del tracker (§4).
- `skills/harness/SKILL.md`, `references/issues.md`, `references/verification.md`,
  `references/board.md` — i file che questa spec modifica.
