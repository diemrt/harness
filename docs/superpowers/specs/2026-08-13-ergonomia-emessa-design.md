# L'ergonomia si emette, non si serve

Data: 2026-08-13

Nasce dall'analisi in [analisi/2026-08-13-substrato-del-tracker.md](../analisi/2026-08-13-substrato-del-tracker.md),
che ha misurato il progetto per capire quanto costasse mantenere un tracker proprio invece di
appoggiarsi a uno strumento affermato. La risposta ha spostato il bersaglio: il substrato — CRUD,
DAG, persistenza — è il secchio **più piccolo**, 637 righe. Il più grosso è l'**ergonomia**,
~1.737 righe, cioè il codice che non è né la tesi di harness né i dati.

Questa spec copre l'ergonomia. Le domande sullo storage (beads e affini) restano aperte in quel
referto e **non** sono in scope qui: nulla di quanto segue le anticipa o le preclude.

## Problema

Quattro difetti, con prove nel repository e nella sua documentazione, non impressioni.

### 1. Il board è un servizio, e un servizio muore

`scripts/board-server.mjs` più `scripts/board.html` sono 891 righe di sorgente e 982 di test:
**1.873, il 16,6% delle 11.249 righe di superficie mantenuta.**

La spec del 2026-08-10 ha già registrato come si comporta: in una sessione il processo è morto tre
volte — durate di circa 50, 25 e 16 minuti, quindi nemmeno un timeout fisso da configurare —
lasciando ogni volta un URL annunciato come attivo e già morto. «L'instabilità non è sistematica,
il che è la cosa peggiore: non se ne può nemmeno diffidare sempre.» Da lì il board è uscito dal
clock-in ed è diventato uno strumento che si chiede.

Il componente più caro del progetto è quello di cui il progetto stesso ha scritto di diffidare.

### 2. Il board copre due bisogni, e nessuno dei due chiede un server

Dichiarato dal committente il 2026-08-13, ed è il dato che rende decidibile il resto:

- **~80% del tempo — dettaglio, su richiesta, senza bisogno di live.** Leggere descrizioni,
  validazioni, stati e completamento dei task: ai checkpoint, davanti a una issue `blocked`, prima
  di far partire uno sviluppo, quando si ferma tutto per capire cosa era stato fatto, e alla fine
  per la pulizia con `--compact`. Per questo uso il dato **fuori** dalla CLI va bene, e forse
  meglio — anche accanto a una CLI diversa da Claude Code.
- **~20% — avanzamento live, e di una cosa sola: i conteggi per stato.** Il motivo dichiarato non
  è che serva il board: è che **la CLI non offre un punto fisso da guardare** mentre il lavoro
  procede.

Il primo bisogno è servito meglio da un file che da un processo. Il secondo non è un board: è una
riga sempre visibile. **Il board come servizio resta senza nessuno dei due usi da coprire.**

### 3. È l'unico componente di harness che dipende dalla rete

`scripts/board.html` carica tre dipendenze a runtime:

```
https://cdn.tailwindcss.com
https://cdn.jsdelivr.net/npm/daisyui@4.12.10/dist/full.min.css
https://unpkg.com/lucide@latest        ← non pinnato
```

Il board **non funziona offline**, e il suo aspetto può cambiare senza un commit perché `lucide` è
a `@latest`. Harness dichiara di lasciare nel progetto solo `issues.json` e `.harness/`, e di
vivere col repository: questo è il solo punto in cui quella promessa non regge.

### 4. Il grafo delle catene è calcolato e non viene mai disegnato

`status-cli.mjs` contiene 111 righe — `dependsOn`, `danglingDeps`, `isWorkable`, `findCycle`,
`buildAlerts` — che sono la **regola 1-WIP resa calcolabile**. `SKILL.md` lo dice: «Prima la
ricostruiva l'orchestratore a giudizio e nessuno poteva controllarla; ora si calcola dal tracker, e
il board la disegna.»

Ma il board **non la disegna**: `renderDependsOn` mostra le dipendenze come lista su una card.
Nessun artefatto di harness mostra il grafo come grafo. Si paga il calcolo e non se ne vede il
risultato.

## Cosa cambia, in una riga

L'ergonomia smette di essere servita da un processo e comincia a essere **emessa** come artefatti:
una riga per i conteggi, un insieme di file markdown per il dettaglio, un diagramma Mermaid per il
grafo. Il calcolo resta di harness, perché è tesi; il rendering diventa di chi già lo sa fare.

## Il principio, che è anche il criterio per dire di no

> **Servire richiede un processo, e un processo muore. Emettere richiede un formatter, che non ha
> stato e non può morire.**

Da qui discende il confine con gli ospiti: **harness calcola ed emette, l'ospite mostra.** Harness
non implementa una statusline, una UI o un viewer. Emette testo, e chi ha una barra di stato o un
renderer lo consuma.

Questo rende la portabilità un non-problema. Fuori da Claude Code non serve riscrivere niente:

| Ospite | Cosa serve, e non è codice di harness |
|---|---|
| Claude Code | `statusLine` in `settings.json` → il comando |
| tmux | `set -g status-right '#(node … --oneline)'` |
| starship | un modulo `custom`, ~4 righe di TOML |
| bash/zsh `PS1`, PowerShell `prompt` | una chiamata nella funzione di prompt |
| ovunque, senza integrazione | `watch -n 5 node … --oneline` in un pannello |

È la stessa architettura che `AGENTS.md` dichiara già per il resto del plugin — CLI più
documenti — applicata all'ergonomia.

## Architettura

Tre canali, uno per bisogno, nessuno con un processo da tenere vivo.

| Bisogno | Canale | Chi renderizza |
|---|---|---|
| Conteggi live (il 20%) | `status-cli.mjs --oneline` | statusline, tmux, prompt |
| Grafo e catene | blocco Mermaid nell'indice esportato | GitHub, GitLab, Obsidian, artifact |
| Dettaglio delle issue (l'80%) | un file markdown per issue | qualunque viewer, e qualunque agente |

### I componenti

**`scripts/tracker-graph.mjs` — nuovo, estratto.** Le 111 righe di calcolo che oggi vivono dentro
`status-cli.mjs`: `dependsOn`, `danglingDeps`, `isWorkable`, `findCycle`, `buildAlerts`, più i
conteggi e le componenti connesse (le catene). Diventa un modulo perché **compaiono due
consumatori**, non per eleganza: il riepilogo e l'esportatore ne hanno bisogno entrambi, e
duplicarlo farebbe divergere la regola 1-WIP fra due file. Estraendolo, la parte di `status-cli`
che è tesi smette di essere mescolata a quella che è presentazione.

**`status-cli.mjs` — invariato, più un flag.** Continua a stampare il riepilogo a schermo intero,
che resta il passo di visibilità del clock-in e del clock-out. Guadagna `--oneline`.

**`scripts/export-md.mjs` — nuovo.** Legge il tracker, usa `tracker-graph.mjs` e scrive gli
artefatti markdown. Sostituisce `board-server.mjs`, che viene rimosso.

**Perché non dentro `issue-manager.mjs`.** Quel file è già a 1.707 righe e possiede un contratto
preciso — mutazioni validate del tracker. L'export è una **proiezione in sola lettura**: metterlo
lì allargherebbe un file già largo con una responsabilità di natura diversa. `status-cli.mjs` è il
precedente: anche lui legge e proietta, e vive per conto suo.

## `--oneline`

Una riga, sempre la stessa forma, pensata per stare in una barra di stato accanto ad altro.

- **Contenuto**: i conteggi per stato, omettendo gli stati a zero, più `!` quando `buildAlerts` ha
  prodotto qualcosa (ciclo, dipendenza rotta). Il marcatore c'è perché un ciclo nel grafo è
  esattamente la cosa che si vuole scoprire senza andarla a cercare.

  ```
  1 in corso | 2 in verifica | 4 backlog | 12 chiuse
  1 in corso | 3 backlog | 9 chiuse !
  ```

  Il separatore è `|` e non `·`: il riepilogo a schermo intero può permettersi caratteri non
  ASCII perché finisce in un blocco di codice markdown, questa riga finisce in una barra di tmux o
  in un prompt PowerShell, dove la codifica non è garantita.

  Su un tracker senza nessuna issue la riga è **vuota**: tutti gli stati sono a zero e vengono
  omessi. È il comportamento voluto — una barra di stato che dice «zero» occupa spazio per non
  dire niente.
- **ASCII puro, nessun ANSI di default.** Gli ospiti sono troppi e troppo diversi per assumere il
  supporto ai colori o ai glifi; chi ne vuole li abilita con un flag.
- **Nessuna informazione che non cambi.** Il nome del progetto e i totali storici occupano spazio e
  non dicono niente di nuovo a chi guarda.

### Contratto invertito, e va motivato dove vive il contratto

Il resto della CLI risponde «una riga JSON, exit 1 sull'errore». `--oneline` fa **l'opposto**:

- **esce sempre 0**;
- un tracker **assente** non è un caso d'errore: si legge come tracker vuoto, come già fa
  `issue-manager.mjs`, e la riga esce vuota perché tutti i conteggi sono a zero;
- un tracker **illeggibile o malformato** stampa una riga vuota e basta — è l'unico caso di vera
  degradazione, e resta silenzioso;
- **non scrive mai su stderr**;
- non stampa mai un messaggio d'errore.

Il motivo è la frequenza del chiamante: questo comando gira a ogni aggiornamento della barra, e un
errore ripetuto lì è peggio del silenzio — occupa la riga che serviva a vedere il lavoro, e non si
può nemmeno chiudere. È un'eccezione deliberata, e senza una riga che la dichiari in
`references/status.md` qualcuno la "aggiusterà" riportandola al contratto generale.

`export-md.mjs`, al contrario, **segue il contratto normale**: è invocato di proposito da una
persona o da un agente, e se fallisce deve dirlo.

## Il formato dell'export

Scritto sotto `.harness/export/`, accanto a `.harness/archive/`, coerente con quanto `SKILL.md`
dichiara già come impronta di harness nel progetto.

```
.harness/export/
  index.md              indice: conteggi, grafo Mermaid, tabella delle issue
  issues/<short-id>.md  un file per issue
```

**`short-id`** sono i primi 8 caratteri esadecimali del GUID, senza trattini. Un identificatore
solo fa due lavori: è lo **slug** del file (quindi l'URL, se un domani un sito lo consuma) ed è
l'**id del nodo** nel diagramma Mermaid, dove un GUID intero renderebbe il grafo illeggibile. È
derivato dall'`id` e non dal titolo, quindi **non cambia quando il titolo cambia**.

In caso di collisione fra due `short-id`, l'esportatore **rifiuta e nomina le due issue**. È un
evento remoto, e allungare gli id in silenzio muterebbe URL già pubblicati.

### Frontmatter: il record, non un riassunto

Il frontmatter YAML porta l'oggetto issue **intero** — `id`, `short_id`, `title`, `status`, `tier`,
`depends_on`, `covers`, `tasks`, `validation`, `created_at`, `updated_at` — con **array che
restano array e oggetti annidati che restano annidati**.

È il criterio che ha guidato tutta l'analisi, applicato alla proiezione: se il frontmatter
appiattisce `tasks` o `validation` in stringhe, chi lo consuma dovrà riparsarli, e si è tornati al
testo. È esattamente il difetto per cui Backlog.md è stato scartato come sostituto — i suoi criteri
di accettazione sono checkbox dentro un commento HTML — e non va reintrodotto dalla porta di
servizio.

### Corpo: solo la prosa, resa leggibile

`# <title>`, la `description`, i criteri, i task come `- [x]`, le dipendenze come link relativi
agli altri file. Serve ai viewer che non sanno leggere il frontmatter: **un consumatore strutturato
userà il frontmatter e ignorerà il corpo.**

Regola che tiene insieme le due cose: **mai semantica nella formattazione.** `status: blocked` sta
nel frontmatter; non si scrive il titolo in grassetto rosso per dire che è bloccata. È ciò che
permette a due renderer diversi di mostrare lo stesso dato in modi diversi senza due export.

### Il grafo Mermaid

Un blocco ```` ```mermaid ```` dentro `index.md`, `flowchart LR`.

- **Solo le issue non chiuse, di default.** Questo repository ha superato le 88 issue: un flowchart
  di 88 nodi è rumore, non informazione.
- **Un `subgraph` per catena** — la componente connessa del grafo `depends_on`, che è la definizione
  che `SKILL.md` dà di catena. È il primo artefatto di harness che la disegna.
- **L'arco va dalla dipendenza alla issue che la dichiara**, che è il verso documentato in
  `references/issues.md`.
- **`classDef` per stato**, così il colore è funzione del dato e non scritto a mano nodo per nodo.
- Etichetta del nodo: `short-id` più il titolo troncato.

Il blocco è una **comodità per i viewer stupidi**, non la fonte: un consumatore strutturato
rigenera il grafo dal frontmatter e lo rende cliccabile. Va scritto sapendo che verrà ignorato.

### Proprietà della directory, e cosa succede alle issue sparite

L'esportatore possiede `.harness/export/` e la riscrive per intero a ogni giro: scrive il set
completo e **rimuove i `.md` che non ha appena scritto**, così una issue cancellata o compattata
non lascia un file fantasma.

Per non trasformare un errore di battitura in una cancellazione, **rifiuta se trova nella directory
qualcosa che non sia un `.md` che si aspetta**, invece di ripulire.

### Versionamento

`index.md` porta `schema_version` nel frontmatter, letto dal tracker come già fa l'archivio di
`--compact`: l'export si autodescrive, e un consumatore futuro può pinnarcisi contro.

**Se versionarlo in git lo decide il progetto**, e harness non scrive nessun `.gitignore` — stessa
scelta già presa per `.harness/archive/`. L'export è **rigenerabile**, quindi non versionarlo non
perde niente; versionarlo dà uno storico leggibile in `git diff`, al prezzo di rumore a ogni giro.

## Cosa viene rimosso

- `scripts/board-server.mjs`, `scripts/board.html`, `test/plugin-board.test.mjs`;
- `commands/board.md` e `skills/harness/references/board.md`;
- i riferimenti al board in `skills/harness/SKILL.md` (elenco delle reference, e la riga del
  clock-out che dice di fermarlo), in `references/status.md`, `references/docs-gate.md`,
  `references/issues.md`, e nei commenti di `scripts/status-cli.mjs` e `scripts/issue-manager.mjs`;
- le righe `.harness/board.cmd` e `.harness/board.sh` da `.gitignore`: sono i lanciatori che il
  board scriveva, e senza il board non nascono più;
- la promessa **«live issue board»** nella `description` di `.claude-plugin/plugin.json`, e la sua
  eco in `README.md` e `CONTRIBUTING.md`;
- l'inventario dei componenti verificato da `test/plugin-skill.test.mjs`,
  `test/plugin-commands.test.mjs` e `test/smoke.test.mjs` va allineato.

**Non si tocca la documentazione storica.** Le spec, i piani e le approvazioni in `docs/`, le issue
chiuse in `issues.json` e gli archivi in `.harness/archive/` registrano cosa fu deciso allora:
riscriverli cancellerebbe il motivo per cui il board era stato scritto, che è la cosa che rende
questa decisione comprensibile fra sei mesi. Anche `proposals/board-minimal.html` resta dov'è.

**Nei progetti che hanno già usato il board** restano `.harness/board.cmd` e `.harness/board.sh`.
Harness non li cancella: sono file inerti, e un plugin che ripulisce da sé la directory di un
progetto fa più danni di quanti ne eviti. Va detto nelle note di rilascio, non automatizzato.

## Cosa non cambia

`issues.json` e il suo schema. Il contratto di `issue-manager.mjs`. Il workflow: clock-in,
1-WIP per catena, verifica indipendente, gate sulla pubblicazione, gate documentale. Il riepilogo a
schermo intero di `status-cli.mjs`, che resta il passo di visibilità del clock-in e del clock-out.

## Errori e degradazione

| Situazione | `--oneline` | `export-md.mjs` |
|---|---|---|
| `issues.json` assente | tracker vuoto → riga vuota, exit 0 | tracker vuoto → indice con zero issue, exit 0 |
| `issues.json` illeggibile o malformato | riga vuota, exit 0 | errore JSON sul contratto normale, exit 1 |
| ciclo o dipendenza rotta nel grafo | marcatore nella riga | il grafo si disegna comunque, l'indice riporta l'allerta |
| collisione di `short-id` | non applicabile | rifiuta nominando le due issue, non scrive nulla |
| file estranei in `.harness/export/` | non applicabile | rifiuta, non rimuove nulla |

Un ciclo non impedisce l'export: la spec del riepilogo lo tratta già come **allerta da mostrare**,
non come errore fatale, e un artefatto che si rifiuta di nascere proprio quando il tracker ha un
problema è un artefatto inutile quando serve di più.

## Testing

Segue la prassi del repository: test prima, sul comportamento osservabile del comando.

- **`tracker-graph.mjs`** — i test oggi dentro `test/plugin-status-cli.test.mjs` che coprono
  prontezza, cicli, dipendenze rotte e catene si spostano su un test del modulo. È un'estrazione: il
  comportamento non cambia, e i test lo devono dimostrare restando verdi.
- **`--oneline`** — forma della riga; stati a zero omessi; `!` presente solo con allerte;
  **exit 0 su tracker assente, vuoto e malformato**, con riga vuota in tutti e tre i casi; stderr
  sempre vuoto; nessuna sequenza ANSI senza il flag.
- **`export-md.mjs`** — il frontmatter riletto come YAML è **uguale al record** del tracker (è il
  test che difende il criterio dei dati strutturati, e va scritto per primo); `short-id` stabile
  fra due giri e invariato dopo un cambio di titolo; i file delle issue sparite vengono rimossi;
  file estranei fanno rifiutare; il grafo esclude le `done` e produce un `subgraph` per catena;
  collisione di `short-id` rifiutata.
- **Rimozione** — `test/plugin-board.test.mjs` sparisce; gli inventari di skill e comandi tornano
  verdi senza il board.

## Fuori scope

- **Lo storage.** Beads e le altre strade restano aperte nel referto d'analisi. Niente qui le
  anticipa: `issues.json` non viene toccato.
- **MCP.** Chiuso nel referto come punto fermo: costa ~4× il plugin intero in token residenti,
  trasporta operazioni mentre harness è regole, e la portabilità è già risolta da `AGENTS.md`.
- **Il generatore statico.** Un eventuale sito (AstroJS o simile) che renderizzi meglio l'export è
  un progetto separato, e non è lavoro di harness. Questa spec ne rende però **possibile** la
  nascita: è il motivo per cui il frontmatter porta il record intero, gli slug sono stabili e
  `schema_version` viaggia con l'indice. Il formato si decide adesso perché è l'unica parte
  irreversibile; il sito si scrive quando si vuole.
