# Spunti da DeepSeek Harness per l'evoluzione di harness

Data: 2026-08-20
Stato: **ricerca conclusa, direzioni selezionate; design e implementazione ancora da svolgere**.

Questo documento conserva il risultato di uno spike comparativo su
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Non è una spec: registra le
decisioni prese e il lavoro che merita un brainstorming separato prima di diventare design.

## Confine del confronto

DeepSeek Harness è un runtime agente completo, basato su servizi e plugin sostituibili; harness è
un protocollo di sviluppo portabile che si appoggia agli host esistenti. Non si vuole importare il
runtime DeepSeek. Si vogliono invece riusare quattro principi che rafforzano lo stato del tracker,
la delega e la distribuzione su host diversi.

Il progetto DeepSeek è ancora in developer preview e dichiara cambiamenti incompatibili: le fonti
servono come spunto, non come API da seguire o codice da copiare.

## Direzioni selezionate

### 1. P0 — Revisioni atomiche delle issue

Ogni issue deve portare una revisione monotona. Un aggiornamento deve dichiarare la revisione che
ha letto e fallire se nel frattempo qualcun altro ha modificato la issue. Il modello di riferimento
è il compare-and-set usato dai goal di DeepSeek Harness: id e revisione identificano uno stato
esatto, non soltanto la stessa entità.

La direzione comprende almeno: campo `revision`, incremento a ogni mutazione, aggiornamento con
revisione attesa, errore distinto per update stantio, migrazione dello storage e prove sulle corse
fra checklist concorrenti.

Fonte: [goal tools di DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.md#update_goal).

### 2. P0 — Criteri immutabili ed evidenza separata

`validation.criteria` non deve più cambiare significato alla chiusura. I criteri restano il
contratto originario; pass, fail, comandi eseguiti ed evidenza vivono in uno storico distinto dei
tentativi di verifica. Un retry aggiunge un fatto invece di cancellare il giudizio precedente.

La forma esatta è ancora da progettare. Deve conservare i criteri, restare leggibile nel Markdown,
non far crescere il tracker senza limiti e poter nominare in modo strutturato le revisioni realmente
giudicate. La revisione atomica della direzione 1 è un prerequisito naturale per evitare che due
tentativi si sovrascrivano.

Fonte: [session log append-only di DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md).

### 3. P2 — Preflight delle capacità prima del dispatch

Un worker o verificatore non deve partire per poi scoprire di non avere shell, accesso agli
artefatti, capacità di modifica o possibilità di aggiornare il tracker. La rotta scelta dichiara le
proprie capacità e una richiesta incompatibile fallisce prima del dispatch e prima della
transizione di stato.

Il design deve restare portabile: le capacità dell'host non vanno inventate né ridotte ai nomi dei
tool di Claude Code. Il preflight deve coprire worker interni, CLI esterne e verificatori, mantenendo
il fallimento esplicito senza degradazione silenziosa.

Fonte: [capability negotiation dei subagent di DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.md#two-kinds-of-capability-discovered-two-ways).

### 4. Provider multipli e plugin multi-host

Harness deve evolvere da plugin centrato su un solo ecosistema a plugin utilizzabile dai principali
host agentici: almeno Claude Code, Codex e GitHub Copilot, sulle superfici CLI e desktop quando
esistono e sono estensibili. Più provider di esecuzione devono poter coesistere, essere nominati e
selezionati senza cambiare gli invarianti del workflow.

Questa direzione non promette ancora una matrice di supporto. La prima fase deve verificare, per
ogni host, formato del plugin, primitive di subagent, passaggio del contesto, permessi, installazione,
aggiornamento e limiti delle applicazioni desktop. Da quella matrice discenderanno il contratto dei
provider e l'eventuale separazione fra nucleo portabile e adapter.

Fonte: [provider multipli dei subagent di DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.md).

## Ordine e dipendenze

Il lavoro si divide in due catene indipendenti:

1. revisioni atomiche → criteri immutabili e storico delle verifiche;
2. contratto e preflight delle capacità → provider multipli e distribuzione multi-host.

Le due catene possono avanzare in parallelo. Dentro ogni catena la seconda decisione dipende dalla
prima: lo storico richiede aggiornamenti concorrenti sicuri; la distribuzione multi-provider
richiede prima un contratto di capacità che impedisca adapter nominali ma incompleti.

## Vincolo per il lavoro futuro

Ogni direzione nasce come issue distinta soltanto se passa la bussola di harness. In ciascuna issue
la **prima fase obbligatoria** è un nuovo brainstorming con `superpowers:brainstorming`, svolto sul
problema specifico prima di scrivere design o implementazione. Questo referto fissa il perché e
l'ordine; non sostituisce quei brainstorming.

Per la direzione multi-host il primo risultato atteso è una decisione architetturale e una matrice
di supporto verificata. Le issue di implementazione degli adapter vanno aperte dopo quella
decisione, non indovinate da questo spike.

## Cosa non viene adottato

- nessun runtime agente parallelo a quelli degli host;
- nessun event sourcing della conversazione: si conserva soltanto la storia del workflow che
  harness possiede;
- nessun loop autonomo che permetta al worker di certificare la propria conclusione;
- nessuna rinuncia alla verifica indipendente o alla regola di pubblicazione dopo il `pass`.

DeepSeek Harness dichiara che il proprio Ralph loop usa ancora completion e blocker auto-dichiarati
dal worker e rimanda l'evaluatore indipendente. Su questo punto harness conserva deliberatamente il
proprio modello più rigoroso.

Fonte: [limiti dichiarati del Ralph workflow](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md#known-limitations-and-deferred-work).
