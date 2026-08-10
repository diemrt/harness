# Il tracker non perde più quello che il lavoro scopre

Data: 2026-08-10

Secondo dei tre deliverable emersi dall'analisi di `activitymanager` (il primo è
[2026-08-10-harness-regole-e-default-design.md](2026-08-10-harness-regole-e-default-design.md),
che ne dichiara la decomposizione). È l'unico dei tre che vuole codice.

Dipende da quello: il setaccio di §4 decide cosa merita una issue, e quella decisione è la
bussola *costoso e invisibile* che P1 introduce. Senza, il setaccio proporrebbe tutto.

## Problema

Due perdite distinte, con la stessa forma: harness sa cosa andrebbe fatto, lo scrive, e non ha
nessun modo di accorgersi che non è stato fatto.

### 1. Il gate documentale è un'istruzione che qualcuno deve ricordarsi di eseguire

`SKILL.md` dice oggi: dopo ogni commit, se tocca file di codice secondo `docsGate`, apri una
issue docs. E dichiara esplicitamente il cambio di regime: «Nel modello plugin questo controllo
lo fai tu, non un hook `post-commit`».

In `activitymanager` ha retto una volta su tre. Esistono issue docs per la Fase 2 e per l'hop 18;
per gli hop 19 e 20 nessuna — l'hop 21 è ancora in corso e non si conta. Il risultato misurabile è che `ARCHITECTURE.md`
dichiara Angular 18 con la 20.3.27 installata, e il suo §4 descrive Protractor, `ng test` che non
compila e «non esiste alcuna pipeline CI» — tutte cose false da mesi.

**Perché è fallito, misurato invece che supposto.** Sulle tredici sessioni del progetto:

| | |
|---|---|
| invocazioni di `status-cli` | 41 |
| commit | 82 |
| invocazioni prima che la memoria di progetto le prescrivesse | 21 |
| dopo | 20 |

La prima ipotesi — «il riepilogo è il rito che regge, appoggiamoci il controllo» — non sopravvive
al secondo taglio. Il riepilogo gira **ai confini**: clock-in, clock-out, fine di un blocco di
lavoro. *Dentro* le sessioni lunghe collassa. Il 2026-08-06 fra le 15:23 e le 16:02 ci sono
**undici commit consecutivi senza un solo `status`**; il 2026-08-10 fra le 08:18 e le 11:18 ce ne
sono **quindici**.

E quella finestra di undici commit **è l'hop 19**, cioè esattamente l'hop la cui issue docs non è
mai nata. Non è una correlazione da interpretare: è lo stesso intervallo di tempo.

La conclusione che ne discende non è «serve un rito migliore». È che **nessun rito è affidabile
durante il lavoro**, e quindi il controllo non può essere puntuale: dev'essere cumulativo, e
rispondere su una finestra di storia invece che sull'ultimo commit.

### 2. Le occasioni scritte nei documenti non arrivano al tracker

Il 2026-08-10 è servito un audit manuale dell'intero corpus documentale — quattro spec, quattro
piani, tre referti di smoke, tre audit dei peer, nove ADR e un registro del debito — per
recuperare circa venticinque occasioni scritte da qualche parte e mai diventate issue. Il
documento che ne è uscito è `docs/debt/occasioni-non-tracciate.md`.

Fra quelle venticinque:

- due **difetti vivi** (`dashboard.component.ts:62` che indicizza un array che la riga 59 sa
  vuoto; `auth.service.ts:264`, un `forkJoin(...).subscribe()` senza callback d'errore), scritti
  in due referti di smoke e rimasti lì per due hop;
- una voce di debito che una spec aveva **deciso** di scrivere nel registro — «va nel registro
  del debito, e si rimuove quando non c'è un hop in corso» — e che nel registro non c'è, né lì né
  nel tracker;
- una segnalazione di sicurezza (credenziale in chiaro nella console di un job, canale di
  rilascio con verifica TLS disattivata) fatta a voce e mai messa su carta operativa.

Il meccanismo è sempre lo stesso: il lavoro **incontra** un'occasione, la scrive dove sta
lavorando, e la rimanda. Funziona finché qualcuno rilegge. A fine progetto nessuno rilegge.

## Cosa cambia, in una riga

Harness guadagna un modo di **accorgersi** che il gate documentale è saltato, e un modo di
**setacciare** i documenti per ciò che hanno scoperto e non tracciato.

Un file nuovo (`scripts/docs-gate.mjs`), un campo nuovo nello schema (`covers`), **due reference
nuove** che ne possiedono i contratti (`references/docs-gate.md`, `references/sweep.md`), due
comandi nuovi che vi rimandano (`/harness:docs-gate`, `/harness:sweep`), e un capitolo riscritto
in `SKILL.md`.

La collocazione dei contratti non è un dettaglio editoriale: §5 spiega perché un procedimento
scritto dentro un comando, per metà dei suoi lettori, non esiste.

## 1. `scripts/docs-gate.mjs`

Autonomo come gli altri script del plugin: risolve il progetto e legge `issues.json` per conto
suo, non esporta niente e non importa niente da loro. Legge tre cose — la storia git della
finestra, `docsGate.include`/`exclude` da `.harness/config.json`, il tracker — e risponde a una
domanda sola:

> quali commit hanno toccato codice senza che nessuna issue li nomini.

Nessuna configurazione nuova: `docsGate.include`/`exclude` esistono già e servono già
esattamente a questo. Con `docsGate.enabled: false` lo script lo dichiara e si ferma.

### 1.1 Cumulativo, mai puntuale

È il vincolo che viene dai numeri del problema. Un controllo su `HEAD`, lanciato a mano dopo
quindici commit, direbbe la cosa giusta sul commit sbagliato.

### 1.2 La finestra si autocalibra

La finestra parte dal **più vecchio commit nominato da una issue**. Harness conosce solo il
periodo in cui è stato usato: su `activitymanager` una finestra «tutta la storia» produrrebbe
migliaia di righe da un repository che precede harness di anni.

Al primo uso, quando nessuna issue nomina niente, lo script **si ferma e chiede `--since <rev>`
esplicito** invece di indovinare un punto di partenza. Un default sbagliato qui non produce un
errore: produce un elenco plausibile e inutile, che è peggio.

### 1.3 I riferimenti si risolvono, non si confrontano come stringhe

Ogni riferimento dichiarato passa per `git rev-parse`, così uno SHA corto e uno lungo sono la
stessa revisione. Un riferimento che non risolve viene **riportato come irrisolto**, non
silenziosamente ignorato: è la differenza fra un dato sbagliato che si vede e uno che passa.

### 1.4 Copertura significa "esiste", non "chiusa"

Una issue in `backlog` che nomina quel commit basta a considerarlo coperto. Il gate è un
promemoria tracciato, non un veto — è già scritto così in `SKILL.md`, e cambiarlo qui
trasformerebbe un promemoria in un blocco.

### 1.5 Canale e codici d'uscita

Testo su stdout, mai JSON, come `status-cli`: è output che una persona legge attraverso un
comando. Esce **0 anche quando trova commit scoperti**, 1 solo sugli errori (progetto
inesistente, `issues.json` illeggibile, flag sconosciuto, git non disponibile).

Un codice d'uscita diverso per «ho trovato scoperti» sarebbe comodo in CI, ma romperebbe il
contratto che ogni altro script del plugin rispetta, dove `1` significa *la richiesta non è stata
eseguita*. Chi vuole un gate di CI legge l'output.

## 2. Il campo `covers` nello schema

Un campo nuovo sulla issue: `covers`, array di riferimenti git. Dichiara quali revisioni quella
issue copre.

### 2.1 Perché è scrivibile senza un passo in più

Una issue non può registrare il **proprio** commit: quello nasce dopo il `pass` del verificatore,
e servirebbe un update post-commit — cioè un altro passo dimenticabile, con la stessa identica
forma di quello che questa spec sta riparando.

Una issue docs invece nasce **dopo** il commit di codice che deve documentare. Quello SHA esiste
già nel momento in cui la issue si apre, e si scrive all'`--insert`. Nessun aggiornamento
successivo, nessuna disciplina in più rispetto a quella che il gate già chiede.

È questo che rende il campo praticabile invece che teorico, ed è il motivo per cui la variante
«ogni issue registra il proprio commit» è scartata (§8).

### 2.2 Forma

- **Generale, non specifico delle docs.** Qualunque issue può dichiarare di coprire una
  revisione; il gate chiede solo che *qualcuno* la nomini.
- **Assente vale `[]`**, come `depends_on`. `null` non è ammesso, per lo stesso motivo già
  scritto in `references/issues.md`: due grafie per «nessuna» obbligano chi legge a indovinare
  quale delle due è memorizzata.
- **Validazione volutamente lasca:** stringhe non vuote, niente duplicati. Harness non è una
  libreria git e non prova a riconoscere uno SHA valido — un riferimento sbagliato semplicemente
  non risolve, e §1.3 lo riporta. Una validazione stretta rifiuterebbe tag e riferimenti
  simbolici legittimi per difendere da un errore che si vede comunque.
- Nessun tetto al numero di elementi, come per `depends_on`: un limite spingerebbe a togliere una
  revisione vera per far passare il payload.

### 2.3 Migrazione

`SCHEMA_VERSION` passa da `1` a `2`. La migrazione `1 → 2` materializza `covers: []` dove la
chiave manca, e si comporta come la `0 → 1` che ha fatto lo stesso con `depends_on`: aggiunge
soltanto, è idempotente, e non è mai automatica — né `--insert` né `--update` la eseguono al
posto di nessuno.

Un tracker a `schema_version: 1` continua a funzionare senza `--upgrade`: la chiave assente vale
`[]` in lettura, e il primo `--update` la materializza. Il gate su un tracker non migrato vede
zero revisioni dichiarate e chiede `--since`, che è il comportamento corretto.

## 3. `references/docs-gate.md` e il comando che ci rimanda

**Il contratto sta nella reference**, non nel comando: come si legge l'output, la finestra e il
suo autocalibrarsi, la risoluzione dei riferimenti, cosa conta come coperto, canali e codici
d'uscita — cioè tutto quanto scritto in §1. È la stessa divisione che `references/status.md` ha
già con `/harness:status`, ed è l'unica che raggiunge anche i lettori che non sono l'utente (§5).

`commands/docs-gate.md` resta sottile: lancia lo script, ne ristampa l'output **verbatim in un
blocco di codice**, e rimanda alla reference. Accetta `--since` e `--project-dir`. Nient'altro,
nessun sottocomando.

**Cosa questa scelta compra e cosa no.** Un comando dedicato non difende dal dimenticarsene: è la
stessa forma dell'istruzione che è già fallita. Quello che lo rende comunque utile è la
cumulatività di §1.1 — chi se ne ricorda una volta a fine giornata recupera tutti e quindici i
commit, non l'ultimo. **Il costo del dimenticarsene diventa un ritardo, non una perdita**, ed è
questo, non la puntualità, il difetto che si stava riparando.

## 4. `references/sweep.md`: il setaccio dei documenti

**Nessuno script.** Il setaccio è tutto giudizio: raccoglie, propone, chiede conferma esplicita,
e solo dopo scrive. Usa `--get-all` e `--insert`, che esistono già; non serve nessuna primitiva
nuova.

Ma **il procedimento vive nella reference**, non in `commands/sweep.md`. Quest'ultimo diventa un
guscio di poche righe: come si lancia, e il rimando. Il perché è in §5, e non è un gusto
editoriale: un procedimento scritto dentro un comando è invisibile a metà di chi dovrebbe
seguirlo.

Il contratto che la reference possiede:

- **Cosa legge.** I percorsi passati come argomento. Se non ce ne sono, propone quelli che trova
  e li fa confermare: harness non sa come un progetto organizza i propri documenti e non lo
  indovina.
- **Cosa fa su ogni occasione.** La incrocia col tracker **in tutti gli stati**, e la verifica
  contro il codice prima di proporla. È il passo che nell'audit reale ha eliminato le occasioni
  già risolte da un hop successivo; senza, il setaccio propone lavoro già fatto e chi lo legge
  smette di fidarsene al secondo giro.
- **Cosa promuove.** Solo ciò che passa la bussola di P1 — *costoso e invisibile*. Nell'audit
  reale sono state 8 occasioni su 25.
- **Cosa fa delle altre.** Le riporta in sessione, e si ferma lì. Harness non crea documenti,
  nemmeno quando sarebbe comodo: se quelle occasioni meritano un registro, lo scrive un'altra
  skill. La proprietà che chiude il cerchio è che quel registro, una volta scritto, entra nel
  corpus che il **setaccio successivo** legge — quindi niente si perde e harness non allarga la
  propria superficie.

## 5. Perché i contratti stanno nelle reference, e cosa cambia in `SKILL.md`

### 5.1 Il fatto strutturale

**I comandi slash sono una superficie dell'utente, non dell'agente.** Un subagent, o un agente
che carica la skill `harness` da fuori, non ha `/harness:sweep` fra le cose che può invocare:
legge `SKILL.md`, e da lì segue i link alle `references/`. Un procedimento che vive solo dentro
`commands/sweep.md`, per quel lettore, non esiste.

Il caso più netto è già in piedi oggi. Un agente che deve aprire una issue arriva a
`references/issues.md` — il contratto della CLI — e chiama `--insert` direttamente. Qualunque
criterio di qualità stia scritto in `commands/issue.md` non lo attraversa mai.

Verificato sul repository:

| fatto | esito |
|---|---|
| `SKILL.md` nomina un comando slash | **mai**, zero occorrenze |
| reference che nominano un comando | due: `status.md` (`/harness:status`), `issues.md` (`/harness:compact`) |
| script CLI nominati dalla reference che li possiede | **tutti e cinque** |
| script nominati direttamente in `SKILL.md` | due: `status-cli.mjs`, `issue-manager.mjs` |

La convenzione quindi **esiste già ed è rispettata al 100%**: il contratto sta nella reference,
il comando è un guscio che ci rimanda, e `SKILL.md` nomina direttamente solo gli script che i
suoi capitoli prescrivono di lanciare.

### 5.2 Ed è già difesa da un test

`test/plugin-commands.test.mjs:110`, *«commands point at the skill instead of restating it»*,
impone a ogni comando di linkare una `skills/harness/references/*.md` e ne cappa il corpo a 4000
caratteri, con la motivazione: *«is long enough to be a second copy of the workflow; the skill is
the source»*.

Una prima stesura di questa spec metteva il procedimento del setaccio dentro il comando.
**Avrebbe fatto fallire quel test**, perché non ci sarebbe stata nessuna reference da linkare.
Non era una convenzione nuova da introdurre: era quella in vigore, violata.

L'asimmetria che invece **manca davvero** è la direzione opposta.
`test/plugin-skill.test.mjs` impedisce la reference orfana — *«exists but SKILL.md never links
it, so it will never be read»* — ma niente impedisce lo **script orfano**: nulla obbligherebbe
`docs-gate.mjs` a essere nominato da qualche parte. Che oggi lo siano tutti e cinque è una
disciplina, non un invariante. Questa spec la rende un invariante (§7).

### 5.3 Cosa cambia in `SKILL.md`

- Il capitolo «Dopo il commit: gate documentale» descrive oggi un controllo a occhio. Diventa
  due cose: la issue docs si apre **dichiarando in `covers` la revisione che copre**, e
  `docs-gate.mjs` è come ci si accorge che è saltato. Lo script si nomina **direttamente**, come
  `status-cli.mjs`, perché è un capitolo che prescrive di lanciarlo.
- Una riga sul setaccio fra gli strumenti disponibili, senza prescrivere quando lanciarlo.
- L'indice delle reference guadagna le due voci nuove — che è anche ciò che le rende non orfane
  per il test esistente.

### 5.4 Il retrofit dei due comandi che hanno il difetto oggi

`/harness:issue` e `/harness:compact` soffrono dello stesso difetto **adesso**, non in futuro:
il giudizio che sta sopra le primitive — i criteri di qualità di una issue, il raggruppamento in
blocchi da far confermare — vive nei comandi, e un agente che arriva dalla skill impara
l'esistenza della primitiva senza quella del giudizio.

`references/issues.md:215` lo dice già a metà: «il giro che `--compact` non fa — leggere le
`done`, proporre i blocchi, farli confermare — è il comando `/harness:compact`». Nomina il giro e
non lo descrive.

Il retrofit è **in scope per questa spec**, perché la correzione è la stessa e farla due volte a
distanza di tempo costa il doppio: il contenuto di giudizio dei due comandi si sposta nelle
reference che già ne possiedono le primitive, e i comandi si accorciano. Il test dei 4000
caratteri li tiene onesti da qui in avanti.

## 6. Cosa non è qui

- **La continuità del lavoro** — congelare una issue interrotta, e rovesciare il grafo delle
  dipendenze quando una decisione lo impone. È P3.
- **La stabilità del processo del board**, già dichiarata fuori scope in P1 e destinata a una
  issue di questo tracker.
- **L'automazione del setaccio.** Resta on-demand. La verifica contro il codice di §4 costa un
  agente, e farla a ogni clock-out sarebbe lo stesso errore delle 21 issue: un controllo che
  costa più di ciò che controlla.

## 7. Come si verifica

Il gate resta `npm run test`. Servono test nuovi su tre superfici, che seguono la separazione già
in uso nel repository:

- **la funzione che decide** quali commit sono scoperti — dati in memoria, provata come
  `buildSnapshot` di `status-cli`: nessun repository finto, nessun processo;
- **il campo `covers` in `issue-manager.mjs`** — `--insert`, `--update`, rifiuto di `null` e dei
  duplicati, chiave assente letta come `[]`, migrazione `1 → 2`, idempotenza dell'`--upgrade`,
  `--compact` che preserva il campo negli originali archiviati;
- **lo script end-to-end** con `spawnSync` su un repository git temporaneo — la finestra
  autocalibrata, `--since` esplicito, uno SHA corto che risolve, un riferimento che non risolve,
  `docsGate.enabled: false`, i codici d'uscita.

Sulla struttura, i test esistenti fanno quasi tutto da soli, purché i file nuovi rispettino la
convenzione di §5:

- `plugin-commands.test.mjs` copre i due comandi nuovi appena entrano nella lista `COMMANDS`:
  frontmatter, `argument-hint`, caso senza argomenti, invocazione via `CLAUDE_PLUGIN_ROOT`,
  percorsi che risolvono, rimando a una reference e tetto dei 4000 caratteri;
- `plugin-skill.test.mjs` copre le due reference nuove col test della reference orfana, e i loro
  link incrociati.

Va aggiunto **un test che oggi non esiste**, quello dell'asimmetria di §5.2: ogni script CLI
sotto `scripts/` dev'essere nominato da `SKILL.md` o da una reference linkata. Oggi passerebbe
già su tutti e cinque — è una disciplina rispettata che diventa un invariante, e impedisce che
`docs-gate.mjs` finisca invisibile a chi legge la skill.

Il retrofit di §5.4 non ha bisogno di test nuovi: i due comandi accorciati restano coperti dal
test dei 4000 caratteri, e il contenuto spostato entra in reference già sotto controllo.

**Nota sul gate documentale di questo repository.** Questa spec introduce script e quindi i suoi
commit di implementazione ricadranno sotto `docsGate` di harness stesso: sono i primi commit che
il gate nuovo dovrà vedere coperti, ed è il primo posto dove si applica a sé stesso.

## 8. Alternative scartate

**Un'allerta git-aware dentro `status-cli`.** Il controllo comparirebbe nel riepilogo, cioè in
quello che i numeri del problema mostrano essere il punto più guardato. Scartata perché
`status-cli` oggi non tocca git in nessun punto ed è una funzione pura di `issues.json` — è per
questo che le sue decisioni si provano con array di oggetti in memoria, e la sua spec lo dichiara
come il motivo per cui è fatto così. Un bordo impuro, anche sottile, sposta il costo su ogni
invocazione di un comando che oggi non ha dipendenze esterne.

**Lanciare `docs-gate.mjs` dal comando `/harness:status`, insieme al riepilogo.** Terrebbe i due
script separati e appoggerebbe comunque il controllo al punto più guardato. Scartata dal
committente in favore del comando dedicato. Il costo accettato è quello scritto in §3: nessuna
difesa contro il dimenticarsene, mitigata dalla cumulatività.

**Lanciarlo come passo di `Clock out` in `SKILL.md`.** Stessa forma dell'istruzione che è già
fallita tre volte su quattro, e per lo stesso motivo.

**Un hook git `post-commit`.** È il modello v1, rimosso deliberatamente col passaggio a plugin, e
richiederebbe di scrivere un file dentro il repository del progetto — che harness non fa.

**Accoppiare per euristica: un commit di soli documenti che segue un commit di codice.** Nessun
campo nuovo, nessuna migrazione, funzionerebbe sui progetti già esistenti. Scartata perché è una
supposizione: un commit di documentazione può non avere nulla a che vedere col codice che lo
precede, e il gate direbbe verde dove non lo è. Un controllo che sbaglia in direzione
rassicurante è peggio di nessun controllo.

**Il gate elenca e non accoppia:** riporta i commit di codice della finestra e le issue docs
esistenti, e chi legge giudica. Onesto e a costo zero sullo schema. Scartata perché su quindici
commit produce una lista che nessuno legge, cioè lo stesso esito del non averla.

**Ogni issue registra il proprio commit.** Il campo esisterebbe comunque, ma andrebbe scritto
*dopo* il commit, che nasce dopo il `pass`. Sarebbe un passo post-commit dimenticabile con la
stessa forma esatta del difetto che questa spec ripara: il gate perderebbe dati proprio nelle
sessioni in cui serve di più. §2.1 è il motivo per cui la variante scelta funziona e questa no.

**Il setaccio produce un documento delle non promosse**, col percorso chiesto all'utente.
Conserverebbe la parte più duratura dell'audit reale — dove ogni occasione era scritta, se è
stata verificata, perché non urge. Scartata perché harness non crea documenti nel progetto, e
un'eccezione per un comando invocato di proposito resta un'eccezione a un principio che finora ha
retto senza. Il compito spetta alle skill di documentazione già presenti nell'ambiente, e il loro
esito rientra comunque nel corpus del setaccio successivo.

**Il procedimento del setaccio scritto dentro `commands/sweep.md`, senza reference.** Era la
prima stesura di questa spec. Scartata perché sbagliata su due piani: rende il procedimento
invisibile a ogni lettore che non sia l'utente che digita il comando (§5.1), e fa fallire un test
che il repository ha già (§5.2). Vale la pena tenerne memoria proprio perché sembrava la scelta
economica — un file invece di due.

**Le non promosse entrano nel tracker come issue di backlog.** Nessun file nuovo e nessuna
eccezione al principio. Scartata perché contraddice direttamente la bussola di P1 — non sono
costose-e-invisibili — e riempirebbe il riepilogo di righe che nessuno prenderà: esattamente il
difetto contro cui la bussola esiste.

## Collegate

- [2026-08-10-harness-regole-e-default-design.md](2026-08-10-harness-regole-e-default-design.md)
  — P1, da cui il setaccio prende la bussola. Va implementato prima.
- `activitymanager/docs/debt/occasioni-non-tracciate.md` — l'audit manuale che questo deliverable
  esiste per non dover rifare a mano.
- `docs/superpowers/specs/2026-08-04-status-cli-design.md` — la purezza di `status-cli`, e il
  motivo per cui non la si tocca.
- `skills/harness/references/issues.md` — lo schema, `depends_on` come precedente di `covers`, il
  meccanismo di `--upgrade`.
- `skills/harness/references/status.md` — la divisione fra reference che possiede il contratto e
  comando che ci rimanda, cioè il modello che §3 e §4 copiano.
- `test/plugin-commands.test.mjs` e `test/plugin-skill.test.mjs` — i test che quella divisione
  già difende, e quello che §7 aggiunge per lo script orfano.
