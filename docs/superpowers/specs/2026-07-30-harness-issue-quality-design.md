# Qualità delle issue e scelta del dispatch — design

Data: 2026-07-30
Stato: approvato, da implementare

Copre le quattro voci a priorità **ALTA** di `NEW-FEATURES.txt`: limiti di formato sul testo
delle issue, validazione leggera per il lavoro banale, un campo che dichiara il costo di
sviluppo, e la scelta fra subagent e lavoro inline. Le voci MEDIA (catena di dipendenza,
revisione della UI) e BASSA (installazione su altri provider) sono fuori scope.

## Perché

I dati reali del tracker (59 issue, tutte `done`) dicono dove sta il problema:

| Campo | min | mediana | max |
|---|---|---|---|
| `title` | 34 | 59 | 99 |
| `description` | 303 | 841 | 4150 |
| `validation.criteria` | 260 | 1827 | 6482 |

Una description da 4150 caratteri non è una issue, è un documento senza titolo. Un `criteria`
da 6482 caratteri non è un criterio, è l'output di un comando: `references/verification.md`
pretende che alla chiusura il campo porti l'**evidenza** ("l'output di un comando lo è"), e
l'evidenza è legittimamente lunga.

Da qui la decisione che regge tutta la sezione A: **`validation.criteria` è un campo
sovraccarico**, e i limiti valgono solo sulla fase in cui porta criteri.

## Decisioni

1. I limiti li impone la **CLI**, non la prosa della skill: una regola scritta soltanto in un
   markdown drifta. Quello che il codice non può misurare (leggibilità, paragrafi, rimando a
   un documento) resta regola nella skill, dichiarata come tale.
2. `criteria` diventa una **lista** vera (array di stringhe), non una stringa con dei trattini
   davanti: solo così il limite per elemento è verificabile.
3. I limiti si applicano quando `validation.state` è `unknown`. Con `pass`/`fail` il campo
   porta evidenza e non è limitato.
4. La validazione leggera **non** aggiunge campi: `validation: null` è già nello schema. Serve
   una regola stretta su quando è ammesso, non un knob nuovo.
5. Il costo di sviluppo è **un** enum (`tier`), non due assi ortogonali: il mapping su modello
   e reasoning effort vive nella skill, non nei dati.
6. La scelta subagent/inline è **configurabile per progetto** con un default euristico, e non
   tocca in nessun caso la verifica.

## A. Limiti di formato

### Costanti

Fisse nel modulo, non configurabili (un limite per progetto sarebbe un limite negoziabile):

| Cosa | Limite |
|---|---|
| `title` | 80 caratteri |
| `description` | 1200 caratteri |
| singolo criterio | 200 caratteri |
| numero di criteri | 7 |

La lunghezza si misura sulla stringa **trimmata**, in caratteri JavaScript (`String.length`).

### Forma di `validation.criteria`

- `state: "unknown"` (creazione) → `criteria` **deve** essere un array di stringhe non vuote,
  da 1 a 7 elementi, ognuno ≤ 200 caratteri. Una stringa con `state: "unknown"` è rifiutata.
- `state: "pass"` o `"fail"` (chiusura) → `criteria` accetta stringa **o** array, senza alcun
  limite di lunghezza né di conteggio. È evidenza.
- La forma fornita viene salvata così com'è: un array resta array, una stringa resta stringa.
  Nessuna normalizzazione, nessuna riscrittura.

### Compatibilità

Le 59 issue esistenti hanno `criteria` stringa e restano leggibili: **nessuna migrazione**,
`issues.json` non viene toccato (CLAUDE.md: sono dati reali, non un fixture).

I limiti valgono su `--insert` e sui soli campi **presenti** in `--update`. Il merge non
rivalida i campi omessi, quindi aggiornare lo `status` di una vecchia issue con una
description da 4150 caratteri continua a funzionare.

### Errori

Nuovo codice **`LIMIT_EXCEEDED`**, distinto da `INVALID_INPUT` (che resta per la forma:
`criteria` né stringa né array, array vuoto, elemento non stringa o vuoto). Serve la
distinzione perché l'agente reagisce in modo diverso: su una violazione di forma corregge il
payload, su un `LIMIT_EXCEEDED` deve spezzare il testo o rimandare a un documento.

Il messaggio nomina campo, valore misurato e massimo:

```
'title' is 94 characters long, the maximum is 80.
'validation.criteria[3]' is 240 characters long, the maximum is 200.
'validation.criteria' has 9 items, the maximum is 7.
```

### Regole nella skill (non codificabili)

- La description va in paragrafi separati da riga vuota, non un blocco unico.
- Sopra il limite non si comprime: si tiene un riassunto nella description e si punta a un
  documento del progetto, col path scritto nella description.
- Se nell'ambiente sono installate skill di spec (per esempio `superpowers:brainstorming` o
  `core-dev-toolkit:spec`), la skill segnala che si possono usare per produrre quel documento.
  **Harness non le invoca e non crea file da sé**: continua a valere "harness non semina file
  nel progetto".

### Board

`criteria` array → lista `<ul>`, un elemento per criterio, ognuno escapato. `criteria` stringa
→ il paragrafo `preserve-newlines` di oggi (percorso legacy).

## B. Validazione leggera

Nessun campo nuovo. `validation: null` è già ammesso dallo schema; cambia la regola su quando
usarlo.

### Whitelist chiusa

Una issue può nascere con `validation: null` solo in questi quattro casi:

- typo o riformulazione in documentazione o commenti, senza toccare codice eseguibile;
- rename meccanico senza cambio di comportamento;
- bump di versione o di dipendenza senza cambio d'API;
- spostamento di file a contenuto identico.

Fuori da questi casi i criteri sono obbligatori. La lista è chiusa: si allarga modificando la
skill, non a discrezione di chi crea la issue.

### Chi decide

Decide **chi crea la issue**, e lo motiva con una riga in description: `Verifica leggera:
<motivo>`. Il worker non può declassare a posteriori una issue che ha già dei criteri — sarebbe
self-validation travestita da semplificazione.

### Cosa fa il verificatore

La verifica **non** si salta. Con `criteria` null il verificatore:

1. esegue il comando `verify` di `.harness/config.json` — resta il gate;
2. controlla il diff (`git diff`, `git status`) contro la classe dichiarata: un "typo in un
   commento" che tocca codice eseguibile è un `fail`;
3. chiude comunque la issue scrivendo `validation` come oggetto, con `state` e l'evidenza —
   quindi il campo passa da `null` a popolato alla chiusura.

I tre invarianti (verifica indipendente su ogni issue, commit solo dopo `pass`, nessun `pass`
auto-assegnato) restano intatti.

## C. Campo `tier`

Nuovo campo input **opzionale**: `tier`, valori `economy | standard | reasoning`.

- Assente all'insert → salvato `null`, che si legge come `standard`.
- In `--update` un `tier` presente deve essere valido; un `null` esplicito lo azzera.
- Valore fuori enum → nuovo codice **`INVALID_TIER`**, coerente con `INVALID_STATUS` e
  `INVALID_STATE` (un codice per campo, così l'agente sa dove guardare).

SKILL.md guadagna la tabella `tier` → (classe di modello, reasoning effort); i segnali per
scegliere il tier ci sono già nella sezione "Scelta del tier per i subagent". La policy
esistente "tier del verificatore >= tier del worker" adesso legge un dato invece di
ridedurlo a ogni dispatch.

Il campo è un **hint**, non un vincolo: se lo scope cambia il tier resta stantio, e non è un
difetto — chi dispatcha può sovrascriverlo e aggiornare il campo.

Board: badge sulla card, nascosto quando `tier` è `null`.

## D. Dispatch: subagent o inline

### Configurazione

`.harness/config.json` guadagna un blocco:

```json
"execution": { "mode": "auto" }
```

`mode` ∈ `auto | inline | subagent`, default `auto`. Merge **per campo**, come `docsGate` e
`externalWorker`: un `execution` omesso viene scritto con il default, un `mode` fuori enum è
`INVALID_INPUT`, e i campi sconosciuti dentro `execution` sono rifiutati. `--detect` non
propone `execution`: non c'è niente da ispezionare nel progetto che lo suggerisca.

### Euristica sotto `auto`

**Subagent** quando: la superficie della issue è ampia o l'output è rumoroso (inquinerebbe il
contesto dell'orchestratore), `tier` è `reasoning`, oppure ci sono catene indipendenti da far
avanzare in parallelo.

**Inline** quando: la catena è una sola, la superficie è piccola, il contesto
dell'orchestratore è sano, `tier` è `economy` o `standard`.

La regola 1-WIP viene riscritta di conseguenza: "avvia un subagent per issue" diventa la scelta
di default per il lavoro ampio, non un obbligo. Nessun invariante cambia, perché gli invarianti
parlano di **indipendenza della verifica**, non di come si istanzia il worker.

### Il guard di ruolo lavorando inline

Il guard tecnico `HARNESS_ROLE=worker` di `issue-manager.mjs` vive nell'environment del
processo del subagent. Lavorando inline quel processo non esiste, e l'orchestratore potrebbe
tecnicamente chiudere la propria issue: la self-validation torna possibile.

Quindi, lavorando inline, **ogni mutazione del tracker va lanciata col ruolo esplicito**:

```powershell
$env:HARNESS_ROLE='worker'; node "$SCRIPTS/issue-manager.mjs" --update ...
```

```bash
HARNESS_ROLE=worker node "$SCRIPTS/issue-manager.mjs" --update ...
```

Su PowerShell la forma `VAR=x comando` non esiste: va assegnata la variabile nella stessa
chiamata. Va scritto sia in SKILL.md sia in `references/verification.md`.

### La verifica non è negoziabile

`execution.mode` **non riguarda la verifica**. Anche con `mode: "inline"`: la chiusura spetta
sempre all'agent `harness-verifier`, che è un agente distinto, e le verifiche di issue diverse
restano parallele. `mode: "inline"` non si legge mai come "verifica inline".

### Skill esterne

Skill di orchestrazione di terze parti (per esempio `superpowers:subagent-driven-development`)
vengono **menzionate** come opzione, non integrate: i criteri di scelta stanno in harness, così
la regola resta valida in un ambiente dove quelle skill non sono installate.

## Superficie toccata

| File | Cosa cambia |
|---|---|
| `scripts/issue-manager.mjs` | limiti, forma di `criteria`, campo `tier`, codici `LIMIT_EXCEEDED` e `INVALID_TIER`, `--help` |
| `scripts/harness-config.mjs` | blocco `execution`, merge e validazione |
| `scripts/board.html` | `criteria` array come lista, badge `tier` |
| `skills/harness/SKILL.md` | regola 1-WIP riscritta, euristica di dispatch, guard inline, tabella `tier`, whitelist verifica leggera |
| `skills/harness/references/issues.md` | schema, limiti, forma di `criteria`, `tier`, nuovi codici |
| `skills/harness/references/verification.md` | gate con `criteria` null, guard inline |
| `skills/harness/references/config.md` | blocco `execution` |
| `commands/issue.md` | limiti, forma dei criteri, regole di prosa, rimando a documenti, `tier` |
| `agents/harness-verifier.md` | gate con `criteria` null |
| `test/*` | copertura dei nuovi rifiuti, del merge di `execution`, del render del board |

## Non obiettivi

- Nessuna migrazione di `issues.json`, né riscrittura dei 59 record esistenti.
- Nessuno split di `criteria` in due campi (`criteria` + `evidence`): la condizione su `state`
  risolve il sovraccarico senza toccare schema, board, agent e comandi.
- Nessun campo `dependsOn` e nessuna revisione della UI per le catene (priorità MEDIA).
- Nessun supporto ad altri provider (priorità BASSA).
- Limiti non configurabili per progetto.

## Split in issue

Quattro catene scorrelate: possono avanzare in parallelo, dentro ognuna si va in ordine.

| # | Catena | Issue | Dipende da |
|---|---|---|---|
| 1 | limiti | CLI: limiti `title`/`description` + `LIMIT_EXCEEDED` | — |
| 2 | limiti | CLI: `criteria` array, regole condizionate a `state` | 1 |
| 3 | limiti | board: render `criteria` array e legacy stringa | 2 |
| 4 | limiti | docs: `references/issues.md`, `commands/issue.md` | 2 |
| 5 | tier | CLI: campo `tier` + `INVALID_TIER` | — |
| 6 | tier | board: badge `tier` | 5 |
| 7 | tier | docs: SKILL.md, `issues.md`, `commands/issue.md` | 5 |
| 8 | verifica leggera | SKILL.md + `verification.md`: whitelist e gate con `criteria` null | — |
| 9 | verifica leggera | `agents/harness-verifier.md`: gate con `criteria` null | 8 |
| 10 | dispatch | `harness-config.mjs`: blocco `execution` + `config.md` | — |
| 11 | dispatch | SKILL.md: regola 1-WIP, euristica, guard inline | 10 |
