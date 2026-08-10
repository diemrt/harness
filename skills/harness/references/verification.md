# Verifica indipendente

Il principio che regge tutto l'harness: **chi ha svolto il lavoro non decide se il lavoro è
buono.** Un agente che verifica sé stesso trova quello che si aspetta di trovare.

## Chi fa cosa

| Ruolo | Può | Non può |
|---|---|---|
| **Orchestratore** | assegnare il lavoro, committare dopo il `pass` | dichiarare `pass` su lavoro proprio |
| **Worker** | implementare, portare la issue a `in_review` | chiudere la issue, committare |
| **Verificatore** | eseguire il gate, chiudere la issue `done`/`blocked` | correggere il lavoro |

Tre ruoli, tre agenti distinti. Se il worker è un worker esterno
([external-worker.md](external-worker.md)), l'invariante non cambia.

## Come si delega

A fine lavoro il worker lascia la issue a `status = in_review`, `validation.state = unknown`.
L'orchestratore avvia allora l'agent **`harness-verifier`** passandogli l'id della issue e il
contesto di cosa è stato prodotto.

Tier del verificatore **>=** tier del worker, mai inferiore.

## Cosa deve fare il verificatore

1. **Leggere i criteri** della issue (`validation.criteria`) e confrontarli con gli
   **artefatti reali**: i file, non il racconto di chi li ha scritti.
2. **Eseguire il comando di verifica** dichiarato in `.harness/config.json`
   ([config.md](config.md)). Il suo esito *è* il gate: se fallisce, la issue fallisce.
3. **Non correggere niente.** Se trova un problema lo riporta; non lo aggiusta. Un
   verificatore che ripara è tornato a essere il worker, e la verifica è persa.
4. **Chiudere la issue:**

```bash
# superata
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id> \
  --issue-data-file <file con {"status":"done","validation":{"criteria":"<evidenza>","state":"pass"}}>

# fallita
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --update --issue-id <id> \
  --issue-data-file <file con {"status":"blocked","validation":{"criteria":"<motivo>","state":"fail"}}>
```

Il campo `criteria` alla chiusura va riscritto con l'**evidenza**: quali comandi sono stati
eseguiti e con quale esito. "Verificato, tutto ok" non è evidenza; l'output di un comando lo è.

## Issue senza criteri: verifica leggera

Una issue della whitelist di verifica leggera (SKILL.md) nasce con `validation: null`. Non è una
issue esente da verifica: è una issue il cui contratto non sta nei criteri ma nella **classe di
lavoro dichiarata** nella description, dalla riga `Verifica leggera: <motivo>`.

Il gate diventa:

1. il comando `verify` di `.harness/config.json`, come sempre;
2. il **confronto del diff con la classe dichiarata**. Un "typo in un commento" che tocca codice
   eseguibile è un `fail`, non una nota: se il lavoro è uscito dalla classe, la classe era
   sbagliata e i criteri servivano.

La chiusura porta `validation` da `null` a oggetto popolato — `state` più l'evidenza — esattamente
come su una issue con criteri. Una issue che resta a `validation: null` dopo la chiusura non è
stata verificata, è stata archiviata.

Nessuno dei tre invarianti cambia: verifica indipendente su ogni issue, commit solo dopo il
`pass`, nessun `pass` auto-assegnato.

## Cosa rende una verifica reale

- comandi **eseguiti**, non descritti;
- confronto con lo stato precedente (`git diff`, `git status`) per accorgersi di modifiche
  fuori scope;
- controllo che il lavoro non abbia rotto altro: la suite intera, non solo i test nuovi;
- disponibilità a dire **fail**. Un verificatore che passa tutto non sta verificando.

## Quando la prova sta fuori dalla portata dell'agent

**Quando scatta.** La prova è *impossibile* da raccogliere dall'ambiente di lavoro — non
soltanto scomoda. Se è scomoda, si fa. La distinzione va tenuta ferma: è l'unica cosa che
impedisce a questa regola di diventare una scorciatoia per delegare a una persona lavoro che
l'agente poteva svolgere.

**In scrittura: il criterio nomina l'artefatto, non l'azione.** Non «il job X esce verde», ma
«esiste `<path>` con esito verde su …, per la revisione `<sha>`». Chi verifica legge un file che
ha già in mano, e non gli serve nessun accesso che non ha.

Harness non prescrive né il formato dell'artefatto né la cartella dove vive: quelle le decide il
progetto. Prescrive tre proprietà:

| proprietà | perché |
|---|---|
| **committato** | un artefatto fuori dal repository non è raggiungibile dal verificatore più della cosa che sostituisce |
| **dichiara su quale revisione è stato misurato** | una misura fatta altrove misura ciò che era stato spinto, non ciò che sta nel working tree; senza la revisione l'artefatto non dice se ha misurato la cosa che si crede |
| **porta le righe decisive verbatim, più un puntatore alla fonte** | il log intero è rumore, ma senza le righe e senza la fonte l'artefatto è il racconto di qualcuno |

**La richiesta a chi può eseguirla ha quattro voci, tutte obbligatorie:**

1. **Cosa lanciare** — comandi esatti e copiabili, o nome del job e parametri.
2. **Cosa serve indietro** — quale output, e quanto: tutto, o da un certo punto in poi.
3. **Su cosa si prosegue intanto** — l'assunzione con cui il lavoro continua mentre la risposta
   non c'è, scritta, così che un esito contrario dica subito che cosa cade.
4. **Perché non si può fare da qui** — una riga. Se non è scrivibile, la richiesta non va fatta:
   significa che era eseguibile senza disturbare nessuno.

**Il lavoro non si ferma ad aspettare.** Si chiede appena la necessità è nota e si prosegue su
tutto ciò che non ne dipende. L'eccezione è una sola: quando l'assunzione è così portante che
proseguire significherebbe rifare tutto in caso di esito contrario.

**La valvola, per i criteri fuori portata già scritti.** La regola qui sopra previene; questa
gestisce i casi in cui non ha funzionato.

- Il worker dichiara l'impossibilità e si ferma. **Non riformula il criterio.**
- Il verificatore **blocca** la issue. È la condotta giusta, non un incidente: un verificatore
  che passa oltre un criterio che non ha potuto controllare è un verificatore che non serve.
- La riformulazione la **firma il committente**, mai il worker a cui gioverebbe, e la firma resta
  nella `description` della issue.

È l'**eccezione disciplinata** al divieto — scritto in [SKILL.md](../SKILL.md) — di declassare a
posteriori i criteri, non una contraddizione: stessa logica e stesso motivo, cioè che chi trae
vantaggio da un criterio più debole non è chi può indebolirlo. Cambia solo chi tiene la penna.

## Perché non c'è più un hook

Nel modello plugin non esiste l'hook `pre-commit` che bloccava i commit del ruolo worker: gli
hook git sono stati eliminati perché imponevano `core.hooksPath` a tutto il clone, rompendo
husky/lefthook e la configurazione di colleghi che harness non lo usano nemmeno.

Resta un guard tecnico, quello che conta di più: `issue-manager.mjs` rifiuta con
`FORBIDDEN_ROLE` qualunque tentativo di impostare `status=done` o `validation.state=pass` da
un processo con `HARNESS_ROLE=worker`. Il resto è disciplina applicata dall'orchestratore.

Quel guard vive nell'**environment del processo**, quindi lo si ha solo se qualcuno lo mette:
un subagent sì, l'orchestratore che lavora inline no. Lavorando inline (`execution.mode`, vedi
[config.md](config.md)) ogni mutazione del tracker va lanciata col ruolo esplicito —
`$env:HARNESS_ROLE='worker'; node ...` su PowerShell, `HARNESS_ROLE=worker node ...` in bash —
altrimenti il divieto di auto-chiusura resta scritto solo nelle regole. Dettagli in
[SKILL.md](../SKILL.md), sezione sul dispatch.
