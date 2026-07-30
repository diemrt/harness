---
name: harness
description: Usa quando lavori allo sviluppo di un progetto con il workflow harness — issue tracciate su issues.json, una sola issue in corso per catena di dipendenza, verifica indipendente obbligatoria prima di ogni commit. Si attiva su "clock in", "clock out", "lavora la issue", "apri una issue", "board delle issue", o quando il progetto contiene un issues.json.
---

# Harness

Harness impone un modo di lavorare, non una libreria: ogni pezzo di lavoro è una issue
tracciata, ogni issue viene verificata da un agente **diverso** da chi l'ha svolta, e si
committa solo dopo quella verifica.

**Cosa harness scrive nel progetto:** `issues.json` alla radice (i dati del tracker, l'unico
file condiviso) e `.harness/` (configurazione e log locali, che si auto-ignora e non finisce
mai in git). Nient'altro: script, regole e board vivono in questo plugin.

Nel resto del documento `$SCRIPTS` sta per `${CLAUDE_PLUGIN_ROOT}/scripts`.

## Clock in (inizio sessione)

1. **Contesto di progetto** — leggi quello che il progetto ha già (`CLAUDE.md`, `AGENTS.md`,
   `README`, `docs/`). Non creare documenti: harness non semina file nel progetto.
2. **Configurazione** — leggi `.harness/config.json` (comando di setup, comando di verifica,
   worker esterno). Se manca, vedi [references/config.md](references/config.md): va proposta
   all'utente e confermata, mai indovinata in silenzio.
3. **Ambiente** — esegui il comando di setup dichiarato in configurazione. Se fallisce,
   **fermati e segnala**: non consumare token su un ambiente rotto.
4. **Board** — avvia il board delle issue e stampa l'URL una volta sola (vedi
   [references/board.md](references/board.md)). Non aprire il browser da solo.
5. **Stato del tracker**:
   ```bash
   node "$SCRIPTS/issue-manager.mjs" --get-all --status in_progress
   node "$SCRIPTS/issue-manager.mjs" --get-all --status backlog
   ```
6. **Scelta del lavoro** — identifica le issue su cui lavorare rispettando la regola 1-WIP
   qui sotto.

Leggi solo la documentazione necessaria alla richiesta: contesto in più costa token e non
migliora la risposta.

## Regola 1-WIP per catena di dipendenza

**Una sola issue `in_progress` per catena di dipendenza.** Issue scorrelate (catene distinte)
possono procedere in parallelo. Dentro una stessa catena si va in ordine, una alla volta.

**Overlap verifica → next:** puoi iniziare la issue successiva mentre la verifica della
precedente è ancora in corso, purché le catene lo consentano. Evita attese inutili su lavori
brevi. Se il lavoro successivo modifica gli **script del plugin**, però, aspetta: un
verificatore che chiude una issue mentre `issue-manager.mjs` è a metà di una modifica fallisce
per un errore che non è suo.

## Dispatch: subagent o inline

Un subagent per issue **non è un obbligo**. Su lavoro piccolo l'unico beneficio reale è tenere
pulito il contesto dell'orchestratore, e non sempre ripaga il costo di istanziare un agente e
di rispiegargli i vincoli.

La modalità sta in `.harness/config.json`, campo `execution.mode`
([references/config.md](references/config.md)): `auto` (default), `inline`, `subagent`. Sotto
`auto` decidi issue per issue:

- **subagent** — superficie ampia o output rumoroso (inquinerebbe il contesto), giudizio
  architetturale, oppure catene indipendenti da far avanzare in parallelo. Può essere un
  subagent interno o un worker esterno
  ([references/external-worker.md](references/external-worker.md)): harness non prescrive come
  si istanzia.
- **inline** — catena unica, superficie piccola, contesto dell'orchestratore ancora sano,
  lavoro meccanico o implementazione ordinaria.

In dubbio, guarda quanto output ti tornerebbe addosso: è quello il costo che il subagent ti
risparmia. Skill esterne di orchestrazione possono aiutare a spezzare il lavoro, ma i criteri
di scelta restano questi: harness non dipende da nessuna skill di terze parti.

### Lavorando inline, il ruolo va dichiarato

Il guard tecnico contro la self-validation vive nell'**environment del processo**:
`issue-manager.mjs` rifiuta `status=done` e `validation.state=pass` solo se chi lo invoca ha
`HARNESS_ROLE=worker`. Un subagent ce l'ha; l'orchestratore che lavora inline no, e potrebbe
chiudere la issue che ha appena svolto.

Quindi, lavorando inline, **ogni mutazione del tracker si lancia col ruolo esplicito**:

```powershell
$env:HARNESS_ROLE='worker'; node "$SCRIPTS/issue-manager.mjs" --update --issue-id <id> --issue-data-file <file>
```

```bash
HARNESS_ROLE=worker node "$SCRIPTS/issue-manager.mjs" --update --issue-id <id> --issue-data-file <file>
```

Su PowerShell la forma `VAR=x comando` non esiste: la variabile va assegnata nella stessa
chiamata, altrimenti il guard non c'è e non te ne accorgi.

### Il dispatch non tocca la verifica

`execution.mode` riguarda **solo** come si svolge il lavoro. La chiusura spetta sempre
all'agent `harness-verifier`, che è un agente distinto, e le verifiche di issue diverse
restano parallele fra loro. Anche con `mode: "inline"`: `inline` non si legge mai come
"verifica inline".

### Invarianti, non negoziabili

- **verifica indipendente su OGNI issue** — mai auto-verifica;
- **commit SOLO dopo `validation.state = pass`** assegnato dal verificatore;
- **nessun `pass` auto-assegnato** da chi ha svolto il lavoro.

Questi tre punti valgono qualunque sia il grado di parallelismo e qualunque sia il tipo di
subagent usato. Nel modello plugin non esiste più un hook git che li imponga a livello di
processo: reggono perché li applichi tu.

## Tier: quanto costa il lavoro di una issue

Harness non pinna modelli per nome: definisce tier che l'orchestratore mappa sui modelli
disponibili. A parità di esito atteso, scegli il tier che consuma meno token.

Il tier sta **sulla issue**, nel campo `tier` ([references/issues.md](references/issues.md)),
così la decisione si prende una volta e la legge chi dispatcha, invece di ridedurla dalla
description a ogni giro.

| `tier` | Quando | Come si mappa |
|---|---|---|
| `economy` | lavoro meccanico, deterministico, a basso rischio | modello economico, reasoning minimo |
| `standard` | implementazione ordinaria, decisioni locali limitate | modello di default, reasoning medio |
| `reasoning` | ragionamento esteso, giudizio architetturale, trade-off critici | modello più capace, reasoning alto |

`tier` assente vale `standard`: è il default, non un dato mancante da riempire.

Segnali per scegliere: numero di file toccati e superficie di impatto; ambiguità di
`description` e `validation.criteria`; esecuzione meccanica vs decisioni di design; posizione
nella catena (bloccante o terminale); trade-off in conflitto.

In dubbio fra due tier, **sali**: un fail in verifica costa più della differenza di token.
Il verificatore usa un tier **>=** a quello del worker, mai inferiore — con il campo valorizzato
è un confronto, non una stima. Policy di efficienza, non invariante.

Il tier è un **hint**, non un vincolo: se lo scope cambia, il tier scritto resta indietro e non
è un difetto. Chi dispatcha può scegliere diversamente, e in quel caso aggiorna il campo
(`--update` con il nuovo valore, o `null` per azzerarlo) invece di lasciare un dato che
contraddice la realtà.

## Verifica leggera: issue che nascono senza criteri

Su una issue banale i criteri di accettazione sono rumore: inventarne tre per rispettare una
regola non aggiunge nessun controllo. Per questi casi `validation` può essere `null` alla
creazione — lo schema lo ammette già ([references/issues.md](references/issues.md)).

La lista è **chiusa**, e si allarga modificando questa skill, non a discrezione di chi apre la
issue:

- typo o riformulazione in documentazione o commenti, senza toccare codice eseguibile;
- rename meccanico senza cambio di comportamento;
- bump di versione o di dipendenza senza cambio d'API;
- spostamento di file a contenuto identico.

Fuori da questi quattro casi i `validation.criteria` sono **obbligatori**.

Decide **chi crea la issue**, e lo motiva con una riga nella description: `Verifica leggera:
<motivo>`. Senza quella riga la issue si tratta come una normale, con criteri richiesti.

**Al worker è vietato declassare a posteriori** una issue che ha già dei criteri: cancellare i
criteri che rendono il proprio lavoro giudicabile è self-validation travestita da
semplificazione.

La verifica **non** si salta. Con `criteria` null il gate resta il comando `verify` più il
controllo del diff contro la classe dichiarata, e la chiusura scrive comunque `validation` come
oggetto, con `state` e l'evidenza: vedi
[references/verification.md](references/verification.md).

## Verifica indipendente

A fine lavoro il worker porta la issue a `status = in_review` con
`validation.state = unknown`, e si ferma. **Non chiude la propria issue.**

La chiusura spetta a un agente dedicato: usa l'agent **`harness-verifier`** (vedi
[references/verification.md](references/verification.md)). Il verificatore:

- controlla i `validation.criteria` della issue contro gli artefatti reali;
- esegue il **comando di verifica** dichiarato in `.harness/config.json` — il suo esito *è*
  il gate;
- **verifica soltanto, non corregge**;
- chiude la issue: superata → `status = done`, `validation.state = pass`, `criteria` con
  l'evidenza; fallita → `status = blocked`, `validation.state = fail`, `criteria` con il
  motivo.

## Gate sul commit

Committa **una issue alla volta**, come snapshot, **solo** dopo il `pass` del verificatore.
Nessun commit di una issue `done`/`pass` non verificata da un altro agente, né di una issue
`blocked`. Se la verifica fallisce: nessun commit finché la issue non viene ripresa,
corretta e riverificata.

Convenzioni di branch e messaggi: [references/git.md](references/git.md).

## Dopo il commit: gate documentale

Subito dopo ogni commit, controlla i file che conteneva. Se il commit tocca **file di
codice** (secondo `docsGate.include`/`exclude` in `.harness/config.json`), apri una issue
docs con `--insert`, che verrà lavorata poi col workflow normale — clock-in, verifica
indipendente, gate sul commit come qualsiasi altra.

Non blocca mai il commit: è un promemoria tracciato, non un veto. Nel modello plugin questo
controllo lo fai tu, non un hook `post-commit`.

## Clock out (fine sessione)

Per ogni issue lavorata: lavoro concluso → `in_review` → verifica indipendente → `pass` →
commit dedicato. Poi ferma il board server avviato al clock-in.

## Reference

- [references/issues.md](references/issues.md) — CLI del tracker: comandi, schema, contratto
  di output, codici di errore.
- [references/verification.md](references/verification.md) — come si delega e cosa deve fare
  il verificatore indipendente.
- [references/git.md](references/git.md) — branch, commit, checklist prima del merge.
- [references/config.md](references/config.md) — `.harness/config.json`: comandi, docs gate,
  worker esterno.
- [references/board.md](references/board.md) — board delle issue con aggiornamento live.
- [references/external-worker.md](references/external-worker.md) — delega opt-in a una CLI
  esterna.
