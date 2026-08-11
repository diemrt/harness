---
name: harness
description: Usa quando lavori allo sviluppo di un progetto con il workflow harness — issue tracciate su issues.json, una sola issue in corso per catena di dipendenza, verifica indipendente obbligatoria prima di ogni commit. Si attiva su "clock in", "clock out", "lavora la issue", "apri una issue", "board delle issue", o quando il progetto contiene un issues.json.
---

# Harness

Harness impone un modo di lavorare, non una libreria: il lavoro che vale la pena far guardare a
qualcun altro è una issue tracciata — quale sia, lo dice il capitolo «Cosa diventa una issue» —,
ogni issue viene verificata da un agente **diverso** da chi l'ha svolta, e si committa solo dopo
quella verifica.

**Cosa harness scrive nel progetto:** `issues.json` alla radice (i dati del tracker) e
`.harness/` (configurazione, archivi di `--compact`, log dei worker). Nient'altro: script,
regole e board vivono in questo plugin. Cosa di tutto questo entri in git lo decide il
progetto — harness non scrive nessun `.gitignore`
([references/config.md](references/config.md)).

Nel resto del documento `$SCRIPTS` sta per `${CLAUDE_PLUGIN_ROOT}/scripts`.

## Clock in (inizio sessione)

1. **Contesto di progetto** — leggi quello che il progetto ha già (`CLAUDE.md`, `AGENTS.md`,
   `README`, `docs/`). Non creare documenti: harness non semina file nel progetto.
2. **Configurazione** — leggi `.harness/config.json` (comando di setup, comando di verifica,
   worker esterno). Se manca, vedi [references/config.md](references/config.md): va proposta
   all'utente e confermata, mai indovinata in silenzio.
3. **Ambiente** — esegui il comando di setup dichiarato in configurazione. Se fallisce,
   **fermati e segnala**: non consumare token su un ambiente rotto.
4. **Stato del tracker** — stampa il riepilogo e ristampalo verbatim in un blocco di codice:
   ```bash
   node "$SCRIPTS/status-cli.mjs"
   ```
   Una schermata sola: conteggi, cosa è in corso, cosa si può prendere adesso, più le allerte
   su cicli e dipendenze rotte. Serve un dettaglio che il riepilogo non porta (description,
   `validation.criteria`)? `issue-manager.mjs --get --issue-id <id>` sulla singola issue, non
   l'elenco intero.
   È l'unico passo di visibilità del clock-in: è testo, sta nella sessione, e non dipende da un
   processo che deve sopravvivere fra un turno e l'altro.
5. **Scelta del lavoro** — identifica le issue su cui lavorare rispettando la regola 1-WIP
   qui sotto.

Leggi solo la documentazione necessaria alla richiesta: contesto in più costa token e non
migliora la risposta.

## Regola 1-WIP per catena di dipendenza

**Una sola issue `in_progress` per catena di dipendenza.** Issue scorrelate (catene distinte)
possono procedere in parallelo. Dentro una stessa catena si va in ordine, una alla volta.

**La catena è un dato, non una deduzione.** Ogni issue dichiara da cosa dipende nel campo
`depends_on` ([references/issues.md](references/issues.md)), e la catena è la **componente
connessa** di quel grafo: due issue stanno nella stessa catena se un cammino di dipendenze le
collega, in un verso o nell'altro. Prima la ricostruiva l'orchestratore a giudizio e nessuno
poteva controllarla; ora si calcola dal tracker, e il board la disegna. La regola non cambia:
cambia che ora è verificabile.

La CLI non fa da guard: portare `in_progress` una issue con dipendenze aperte è tecnicamente
possibile ([references/issues.md](references/issues.md)). È la valvola di sfogo per il caso in
cui la dipendenza dichiarata non morda davvero — e resta una decisione da motivare, non il modo
normale di procedere.

**Al worker è vietato togliere una dipendenza per sbloccarsi.** Cancellare l'arco che rende la
propria issue non ancora lavorabile è la stessa mossa del cancellare i criteri che la rendono
giudicabile: il lavoro sembra procedere perché è sparito ciò che lo misurava. Le dipendenze le
mette chi apre la issue; chi le cambia lo motiva nella description, e non è mai chi ne sta
traendo il permesso di partire.

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

### Il tier si applica quando il subagent nasce

Deciso `subagent`, il passo non è completo finché non fissi il modello dal `tier` della issue
(mappatura nel capitolo Tier più sotto) nell'istante stesso in cui lo crei: è lì che la
mappatura tier → modello smette di essere un dato scritto sulla issue e diventa una scelta
fatta. Dimenticarlo non produce nessun errore né un test rosso: senza quella scelta esplicita
il subagent eredita il modello della sessione dell'orchestratore, quasi sempre il più capace, e
il `tier` resta un campo che nessuno ha letto.

Lavorando inline il modello non lo scegli tu al dispatch: è già quello fissato per la sessione
in corso. Il `tier` resta comunque il segnale da confrontare con quella sessione — se il lavoro
chiede più di quanto la sessione offra, è un motivo per passare a `subagent`, non per procedere
ignorando il tier.

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

## Cosa diventa una issue

Non tutto il lavoro è una issue. La domanda è una sola:

> Se qui venisse commesso un errore, sarebbe **costoso e invisibile**?

Servono entrambe le cose. Un errore costoso ma **rumoroso** non ha bisogno di uno sguardo
indipendente: il comando `verify` lo urla al primo tentativo. Un errore invisibile ma innocuo non
vale il prezzo. È l'intersezione a giustificare una issue.

**Il prezzo, detto in numeri.** Una issue è un giro di verificatore, cioè un agente intero. È
l'unità di costo di harness, ed è ciò che rende la domanda decidibile invece che filosofica: una
issue per ogni passo di un piano vuol dire che il controllo costa più della cosa controllata, e
si vede contando gli agenti.

**Sotto il tracker c'è un livello a grana fine**, fatto di passi da pochi minuti, ognuno con la
propria verifica svolta *inline dallo stesso agente che lavora* — e che costa quasi niente
proprio perché non cambia agente. Harness **non prescrive come lo produci**: un piano scritto,
una lista di todo, o niente di scritto. Prescrive una cosa sola, che il tracker non è quel
livello e non deve inseguirlo. La corrispondenza fra issue e passi non è uno a uno, e non deve
esserlo.

**Per il lavoro che emerge a metà**, nell'ordine:

1. rientra in qualcosa di già previsto → è un passo in più lì dentro, nessuna issue;
2. è nuovo, ma il suo errore sarebbe **rumoroso** → è un passo nuovo, nessuna issue;
3. il suo errore sarebbe **costoso e invisibile** → è una issue, **e serve un criterio eseguibile
   che renda visibile il fallimento**. Se non riesci a scriverlo, il problema non è la issue: è
   che non sai ancora come si riconosce il fallimento, e va capito prima;
4. cambia una decisione già presa e scritta → prima il documento, poi la issue.

Il punto 3 è il più utile dei quattro, perché trasforma un giudizio in una prova di scrittura: la
bussola chiede di stimare quanto un errore sarebbe invisibile, il criterio chiede di renderlo
visibile. Se il secondo non si scrive, la stima era ottimistica.

**Cosa questa regola non dice.** Non dice quanto lavoro sta dentro una issue. Una issue larga è
una finestra più larga fra due verifiche: se il tratto va storto a metà, se ne accorge il
verificatore alla fine e non prima. È un rischio che si accetta guardandolo — mitigato dalle
verifiche del livello sotto, che restano — non un difetto da correggere spezzettando, che
riporterebbe a una issue per passo.

## Verifica leggera: issue che nascono senza criteri

Quanto segue si applica **dopo** che la bussola qui sopra ha detto sì: sono issue vere, che
meritavano di entrare nel tracker.

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
[references/verification.md](references/verification.md)). Istanzialo con il modello fissato
dal `tier` della issue, mai inferiore a quello con cui è stato svolto il lavoro (regola nel
capitolo Tier più sopra): è lo stesso passo del dispatch del worker, applicato qui perché è qui
che la verifica si delega. La stessa dimenticanza qui costa di più — un verificatore che
eredita un modello più debole di quello del worker rischia di validare un lavoro che non ha la
capacità di giudicare davvero. Il verificatore:

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
commit dedicato. Se durante la sessione hai avviato il board, fermalo adesso col `pid` della
riga di avvio.

Chiudi ristampando il riepilogo (`node "$SCRIPTS/status-cli.mjs"`, verbatim in un blocco di
codice): è il confronto con quello del clock-in, e dice in una schermata cosa si è mosso.

## Reference

- [references/issues.md](references/issues.md) — CLI del tracker: comandi, schema, contratto
  di output, codici di errore.
- [references/verification.md](references/verification.md) — come si delega e cosa deve fare
  il verificatore indipendente.
- [references/git.md](references/git.md) — branch, commit, checklist prima del merge.
- [references/config.md](references/config.md) — `.harness/config.json`: comandi, docs gate,
  worker esterno.
- [references/docs-gate.md](references/docs-gate.md) — gate documentale: finestra, copertura,
  come si legge l'output.
- [references/status.md](references/status.md) — riepilogo del tracker a riga di comando: come
  si legge l'output, canali, codici di uscita.
- [references/sweep.md](references/sweep.md) — setaccio dei documenti: cosa legge, cosa promuove,
  cosa fa delle occasioni che non promuove.
- [references/board.md](references/board.md) — board delle issue con aggiornamento live.
- [references/external-worker.md](references/external-worker.md) — delega opt-in a una CLI
  esterna.
