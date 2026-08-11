# Setaccio dei documenti

Il lavoro **incontra** un'occasione — un difetto visto di sfuggita, una decisione che andava
scritta, un rischio — la annota dove sta lavorando, e la rimanda. Funziona finché qualcuno
rilegge. A fine progetto nessuno rilegge.

Il setaccio è il giro che rilegge. Su un progetto reale, un audit manuale dell'intero corpus —
quattro spec, quattro piani, tre referti di smoke, tre audit, nove ADR e un registro del debito —
ha recuperato circa **venticinque occasioni** scritte da qualche parte e mai arrivate al tracker.
Fra queste due difetti vivi con tanto di file e riga, una voce di debito che una spec aveva
*deciso* di scrivere e non era stata scritta, e una segnalazione di sicurezza fatta a voce.

**Non c'è nessuno script.** Il setaccio è tutto giudizio: raccoglie, verifica, propone, chiede
conferma, e solo dopo scrive. Usa `--get-all` e `--insert`, che esistono già
([issues.md](issues.md)); non serve nessuna primitiva nuova.

## Quando si lancia

**Su richiesta, mai da solo.** Resta on-demand di proposito: la verifica contro il codice del
punto 2 costa un agente, e farla a ogni clock-out sarebbe un controllo che costa più di ciò che
controlla — lo stesso errore che la bussola in [SKILL.md](../SKILL.md) esiste per evitare.

Il momento buono è la fine di un tratto di lavoro lungo, o l'ingresso in un progetto di cui non si
conosce la storia scritta.

## 1. Cosa legge

**I percorsi passati come argomento.** Se non ce ne sono, propone quelli che trova e **li fa
confermare**: harness non sa come un progetto organizza i propri documenti e non lo indovina.
Tipicamente sono spec, piani, ADR, registri del debito, referti di test o di audit, note di
release — tutto ciò che qualcuno ha scritto durante il lavoro e nessuno rilegge.

Il corpus va nominato per esteso prima di leggerlo: un setaccio che ha guardato metà dei documenti
e non lo dice produce un elenco che sembra completo.

## 2. Cosa fa su ogni occasione

Due controlli, **entrambi prima di proporla**:

- **la incrocia col tracker, in tutti gli stati.** Non solo `backlog`: un'occasione già tracciata
  e chiusa non è un'occasione, e riproporla insegna a non fidarsi dell'elenco.
- **la verifica contro il codice.** È il passo che nell'audit reale ha eliminato le occasioni già
  risolte da un tratto di lavoro successivo. Senza, il setaccio propone lavoro già fatto, e chi lo
  legge smette di fidarsene al secondo giro.

Un'occasione che il codice smentisce non si propone: si **riporta come risolta**, così chi legge
sa che il documento che la conteneva è vecchio.

## 3. Cosa promuove

**Solo ciò che passa la bussola** di [SKILL.md](../SKILL.md): se un errore lì sarebbe *costoso **e**
invisibile*. Nell'audit reale sono state **8 occasioni su 25**.

Le issue proposte si mostrano tutte insieme, con il documento e il punto da cui vengono, e si
aprono **solo dopo conferma esplicita**. Ognuna porta i propri `validation.criteria`: se un
criterio eseguibile non si riesce a scrivere, il problema non è la issue — è che non si sa ancora
come si riconosce il fallimento, e va capito prima di aprirla.

## 4. Cosa fa delle altre

Le **riporta in sessione, e si ferma lì.**

Harness non crea documenti nel progetto, nemmeno quando sarebbe comodo: se quelle occasioni
meritano un registro, lo scrive un'altra skill — quelle di documentazione presenti nell'ambiente,
che harness propone e non invoca. La proprietà che chiude il cerchio è che quel registro, una
volta scritto, entra nel corpus che il **setaccio successivo** legge: niente si perde, e harness
non allarga la propria superficie.

Metterle nel tracker come issue di `backlog` sarebbe la scorciatoia ovvia, e contraddice
direttamente la bussola: non sono costose-e-invisibili, e riempirebbero il riepilogo di righe che
nessuno prenderà — esattamente il difetto contro cui la bussola esiste.

## Cosa il setaccio non è

- **Non è un controllo del gate documentale.** Quello guarda i commit e ha il proprio script
  ([docs-gate.md](docs-gate.md)). Il setaccio guarda i documenti, e i due si incontrano solo nel
  fatto che entrambi finiscono in issue.
- **Non è automatico e non entra nel clock-out.**
- **Non riscrive i documenti che legge.** Li legge e basta.
