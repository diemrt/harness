# `.harness/` — configurazione del progetto

Quello che serve per lavorare vive in `.harness/` alla radice del progetto.

```
.harness/
  config.json       # comandi e opzioni
  issues/           # il tracker: un file Markdown per issue
  archive/          # gli originali che --compact e --upgrade tolgono dal tracker
  runs/             # log dei worker esterni
```

`config.json` porta anche `schema_version`, come prima chiave: la versione dello schema del
tracker ([issues.md](issues.md)). La scrivono solo `issue-manager --init` e
`issue-manager --upgrade`; `harness-config.mjs` non la inventa mai e si limita a **preservarla**
quando riscrive il file.

**Cosa di tutto questo va versionato lo decide il progetto, non harness.** Lo script non
scrive nessun `.gitignore`: né quello del progetto, che non tocca mai, né uno proprio dentro
`.harness/`. La directory compare fra gli untracked e la scelta è di chi possiede il
repository — committare `config.json` perché la squadra condivida un solo gate di verifica
oppure tenerlo per clone, committare `archive/` perché i blocchi del tracker continuino a
puntare a qualcosa dopo un clone fresco oppure no. Su `issues/` la decisione è già presa nei
fatti: è il tracker, e un tracker che non si condivide non traccia niente per nessun altro.

Uno strumento che ignora file al posto tuo quella decisione te l'ha tolta, in un file che non
hai chiesto e che potresti non notare mai.

## Dove sta la configurazione

`.harness/` viene risolta contro la **directory del progetto**, mai accanto allo script:

- default: la directory corrente del processo;
- `--project-dir <path>`: override esplicito, quando non controlli la cwd.

Vale per tutti i comandi, `--detect` e `--get` compresi: una sola copia installata configura
progetti diversi senza confonderli.

## `config.json`

```json
{
  "setup": "npm install",
  "verify": "npm test",
  "externalWorker": {
    "enabled": false,
    "command": "copilot --yolo --model auto -p {promptFile}"
  },
  "docsGate": {
    "enabled": true,
    "include": ["**/*.mjs", "**/*.ts", "**/*.py", "**/*.go", "**/*.cs"],
    "exclude": ["docs/**", "test/**", "tests/**", "**/*.md", ".harness/**"]
  },
  "execution": { "mode": "auto" }
}
```

- **`setup`** — comando eseguito al clock-in per preparare l'ambiente. Se fallisce, ci si
  ferma e si segnala.
- **`verify`** — **il gate**. È il comando che il verificatore indipendente esegue per
  decidere `pass`/`fail`. Deve essere deterministico e significativo: se passa sempre, la
  verifica non verifica niente.
- **`externalWorker`** — vedi [external-worker.md](external-worker.md).
- **`docsGate`** — glob che stabiliscono quali file contano come "codice" per il gate
  documentale dopo il commit.
- **`execution.mode`** — come viene dispatchato il lavoro di una issue: `auto` (default,
  decide l'euristica della skill), `inline` (lo svolge l'orchestratore), `subagent` (sempre un
  subagent). **Non riguarda la verifica**, che resta un agente distinto qualunque sia il mode:
  `inline` non si legge mai come "verifica inline".

L'esempio sopra è **abbreviato**. Quello che `--init` scrive davvero per i campi che ometti:

| Campo omesso | Valore scritto |
|---|---|
| `setup` | `null` — nessun comando di preparazione |
| `externalWorker` | `{ "enabled": false, "command": null }` |
| `docsGate.include` | `**/*.mjs`, `**/*.js`, `**/*.cjs`, `**/*.ts`, `**/*.tsx`, `**/*.jsx`, `**/*.py`, `**/*.go`, `**/*.cs`, `**/*.java`, `**/*.rb`, `**/*.rs`, `**/*.php` |
| `docsGate.exclude` | `docs/**`, `test/**`, `tests/**`, `**/*.md`, `.harness/**` |
| `docsGate.enabled` | `true` |
| `execution` | `{ "mode": "auto" }` |

Tredici linguaggi nell'`include` di default, non i cinque dell'esempio: se restringi i glob
copiando l'esempio, stai anche decidendo che gli altri otto non contano come codice per il
gate documentale. `verify` non ha default: è obbligatorio.

`--detect` non propone `execution`: nel progetto non c'è niente da ispezionare che suggerisca
come dispatchare il lavoro, e un mode indovinato sarebbe una decisione presa senza dati. Il
default `auto` lascia la scelta all'euristica della skill, issue per issue.

Il merge è **per campo**, non per oggetto: la tabella sopra vale non solo quando ometti
`docsGate`, `externalWorker` o `execution` del tutto, ma anche quando ne ometti solo alcuni
campi. Passare
`{"docsGate":{"enabled":true}}` scrive `enabled: true` **insieme** a `include`/`exclude`
riempiti coi default sopra, mai un `docsGate` con `enabled: true` e `include` assente — quel
caso produrrebbe un gate che sembra attivo e non segnala mai niente, perché niente
combacerebbe con un `include` mancante. Allo stesso modo, `{"externalWorker":{"command":"cmd
{promptFile}"}}` scrive `enabled: false` esplicito accanto al `command` fornito, non un
oggetto a cui manca la chiave `enabled`. Ogni campo esplicito nell'input sovrascrive il
default corrispondente; i campi omessi prendono il default; non c'è merge dentro gli array
(`include`/`exclude` forniti sostituiscono l'intero array di default, non si sommano ad
esso).

I campi di `docsGate`, quando presenti, sono tipizzati: `enabled` deve essere booleano,
`include`/`exclude` array di stringhe. Un tipo sbagliato (`"include": "**/*.js"` invece di
un array) è rifiutato con `INVALID_INPUT` invece di essere scritto e ignorato in silenzio a
valle. Stesso rifiuto per un `include` esplicitamente vuoto a gate acceso: `include: []` con
`enabled: true` — o con `enabled` omesso, che vale `true` per default — è lo stesso gate
inerte del caso a `include` mancante, solo scritto apposta invece che per omissione; o elenchi
dei glob, o metti `enabled: false`. Un `exclude: []` resta legittimo (non escludere niente è
una scelta), e così un `include: []` a gate spento.

Non c'è un task runner: i comandi vengono eseguiti direttamente. La configurazione li
**dichiara**, così il gate è lo stesso a ogni verifica e non dipende da cosa si ricorda
l'agente in quel momento.

## Comandi

`$SCRIPTS` = `${CLAUDE_PLUGIN_ROOT}/scripts`. Stesso contratto di output del tracker: una
riga JSON su stdout, `ok`/`error`/`code`, exit 0/1.

```bash
# leggere la configurazione corrente
node "$SCRIPTS/harness-config.mjs" --get

# proporre i comandi ispezionando il progetto (non scrive niente)
node "$SCRIPTS/harness-config.mjs" --detect

# scriverla, dopo la conferma dell'utente
node "$SCRIPTS/harness-config.mjs" --init --config-file ./proposed.json
node "$SCRIPTS/harness-config.mjs" --init --config-data '{"setup":"npm ci","verify":"npm test"}'

# operare su un altro progetto
node "$SCRIPTS/harness-config.mjs" --get --project-dir /path/to/project

# elenco completo di comandi e flag
node "$SCRIPTS/harness-config.mjs" --help
```

`--init` rifiuta di sovrascrivere una configurazione esistente (`CONFIG_EXISTS`) se non passi
`--force`. `--get` su un progetto non configurato risponde `CONFIG_NOT_FOUND` e **non crea
niente**.

| `code` | Quando |
|---|---|
| `CONFIG_NOT_FOUND` | `.harness/config.json` non esiste |
| `CONFIG_EXISTS` | configurazione già presente e nessun `--force` |
| `INVALID_INPUT` | campo sconosciuto, `verify` mancante o vuoto, `setup` non stringa/`null`, `schema_version` non intero non negativo, worker abilitato senza `{promptFile}`, `docsGate`/`externalWorker`/`execution` non un oggetto, `docsGate.enabled` non booleano, `docsGate.include`/`exclude` non un array di stringhe, `docsGate.include` vuoto a gate acceso, `execution.mode` fuori enum, campo sconosciuto dentro `execution` |
| `INVALID_JSON` | payload non JSON valido |
| `FILE_NOT_FOUND` | `--config-file` o `--project-dir` inesistente |
| `MISSING_ARGS` | payload assente, o `--config-data` e `--config-file` insieme |
| `UNKNOWN_COMMAND` | nessun comando riconosciuto (vedi `--help`) |
| `ERROR` | catch-all per errori imprevisti |

## Primo uso su un progetto

Se `.harness/config.json` non esiste:

1. esegui `--detect`. Ispeziona `package.json` (script `test`, `build`, `check`, `ci`),
   `Makefile`, `pyproject.toml`/`requirements.txt`, `*.csproj`/`*.sln`, `go.mod`,
   `Cargo.toml`, e riporta **ogni** stack riconosciuto con l'`evidence` da cui deriva la
   proposta — non sceglie per te e non scrive niente (`confirmed: false`);
2. **proponi i comandi all'utente e aspetta conferma.** Un gate sbagliato è peggio di nessun
   gate: dà l'illusione della verifica. Se `--detect` non riconosce niente, `suggested` è
   `null`: chiedi, non indovinare;
3. `--init` crea `.harness/` se manca e ci scrive `config.json`. Crea **solo quello che manca**:
   log, archivi o un `.gitignore` che il progetto ci ha messo restano come sono, e una
   `config.json` già presente si sovrascrive solo con `--force`.

`verify` è l'unico campo obbligatorio: senza, non c'è niente da eseguire al gate e la
verifica indipendente diventa teatro.
