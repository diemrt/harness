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
