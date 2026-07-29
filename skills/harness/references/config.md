# `.harness/` — configurazione locale

Harness non mette file di configurazione nel repository condiviso. Quello che serve per
lavorare vive in `.harness/` alla radice del progetto, una directory che **ignora sé stessa**:
contiene un `.gitignore` con `*`, quindi git non la vede e il `.gitignore` del progetto non
viene mai toccato.

```
.harness/
  .gitignore        # contiene "*": la cartella si auto-ignora
  config.json       # comandi e opzioni, per-macchina
  runs/             # log dei worker esterni
```

Conseguenza voluta: la configurazione è **per clone**, non condivisa. Un collega che non usa
harness non vede niente; tu la ricrei se ricloni.

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
    "exclude": ["docs/**", "test/**", "tests/**", "**/*.md", "issues.json"]
  }
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

L'esempio sopra è **abbreviato**. Quello che `--init` scrive davvero per i campi che ometti:

| Campo omesso | Valore scritto |
|---|---|
| `setup` | `null` — nessun comando di preparazione |
| `externalWorker` | `{ "enabled": false, "command": null }` |
| `docsGate.include` | `**/*.mjs`, `**/*.js`, `**/*.cjs`, `**/*.ts`, `**/*.tsx`, `**/*.jsx`, `**/*.py`, `**/*.go`, `**/*.cs`, `**/*.java`, `**/*.rb`, `**/*.rs`, `**/*.php` |
| `docsGate.exclude` | `docs/**`, `test/**`, `tests/**`, `**/*.md`, `issues.json` |
| `docsGate.enabled` | `true` |

Tredici linguaggi nell'`include` di default, non i cinque dell'esempio: se restringi i glob
copiando l'esempio, stai anche decidendo che gli altri otto non contano come codice per il
gate documentale. `verify` non ha default: è obbligatorio.

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
| `INVALID_INPUT` | campo sconosciuto, `verify` mancante o vuoto, worker abilitato senza `{promptFile}` |
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
3. `--init` scrive `.harness/.gitignore` (con `*`) **prima** di `config.json`: la directory
   non è mai visibile a git nemmeno per un istante.

`verify` è l'unico campo obbligatorio: senza, non c'è niente da eseguire al gate e la
verifica indipendente diventa teatro.
