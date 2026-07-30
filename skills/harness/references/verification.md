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
