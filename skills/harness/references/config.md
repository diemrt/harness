# `.harness/` — configurazione locale

> **Stato:** contratto definito, implementazione in corso (issue "Config locale .harness/
> auto-ignorante con rilevamento dei comandi"). Finché non è pronta, chiedi i comandi
> all'utente e non dare per scontato che il file esista.

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

Non c'è un task runner: i comandi vengono eseguiti direttamente. La configurazione li
**dichiara**, così il gate è lo stesso a ogni verifica e non dipende da cosa si ricorda
l'agente in quel momento.

## Primo uso su un progetto

Se `.harness/config.json` non esiste:

1. deduci `setup` e `verify` da quello che il progetto mostra — `package.json` (script
   `test`, `build`), `Makefile`, `pyproject.toml`, `*.csproj`, `go.mod`, README;
2. **proponi i comandi all'utente e aspetta conferma**. Non scriverli in silenzio: un gate
   sbagliato è peggio di nessun gate, perché dà l'illusione della verifica;
3. scrivi `.harness/config.json` e `.harness/.gitignore` (con `*`) insieme, mai il primo
   senza il secondo.
