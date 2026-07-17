# ARCHITECTURE.md

## 1. Panoramica

`@diemrt/harness` è distribuito come pacchetto npm (`bin: harness`) e come libreria di
funzioni pure. Il codice sorgente vive in `src/` ed è organizzato attorno a quattro
responsabilità separate: parsing della riga di comando (`cli.mjs`), logica di
copia/sincronizzazione (`actions.mjs`), calcolo e persistenza dell'hash manifest
(`manifest.mjs`) e classificazione dei file per policy (`policies.mjs`). Tutto il
contenuto effettivamente distribuito agli utenti — script, documenti, viewer HTML, seed
delle issue — vive sotto `template/`, che è l'unica copia autorata di questi file in tutto
il repository.

Il flusso principale è: un utente esegue `npx @diemrt/harness init` (o `update`) dentro il
proprio progetto; il CLI (`src/cli.mjs`) fa il parsing degli argomenti con
`node:util.parseArgs`, richiama `init()` o `update()` da `actions.mjs`, e stampa il
risultato in formato testo o JSON (`--json`). `actions.mjs` cammina ricorsivamente
`template/`, per ogni file calcola l'hash sha256 (`manifest.mjs`) e decide cosa fare in
base alla policy del file (`policies.mjs`) e allo stato del manifest esistente
(`.harness-manifest.json`) nella directory target. `init` scrive tutto ciò che non esiste
già; `update` esegue un confronto a tre vie (hash del template nuovo, hash registrato
nell'ultimo manifest, hash sul disco) per distinguere un file "pristine" (sincronizzabile
in sicurezza) da uno modificato dall'utente (che diventa un conflitto, mai sovrascritto
silenziosamente).

Questo stesso repository consuma il proprio harness: la radice del progetto non contiene
più uno harness scritto a mano, ma una copia materializzata di `template/` prodotta da
`node src/cli.mjs update .`, più i file `seeded-once`/`data` di proprietà del repository
(`AGENTS.md`, `docs/ARCHITECTURE.md`, `init.config.json`, `issues.json`). Un workflow CI
(`.github/workflows/ci.yml`) esegue `npm test` e poi `npm run dev:check` a ogni push/PR,
cosicché qualunque deriva tra la radice e `template/` fa fallire la build prima che possa
essere ignorata.

## 2. Stack tecnologico

| Area                | Tecnologia |
|---------------------|------------|
| Runtime             | Node.js >= 18, moduli ES (`type: module`) |
| Dipendenze runtime  | nessuna (zero dipendenze npm) |
| Test                | `node:test` + `node:assert`, eseguiti con `node --test` |
| Distribuzione       | npm (`npm publish`), consumo via `npx @diemrt/harness` |
| CI                  | GitHub Actions, `ubuntu-latest`, Node 20 |
| Hashing manifest    | `node:crypto` (sha256) |

## 3. Struttura del codice

```
herness-repository/
├─ package.json               # bin "harness" -> src/cli.mjs; files: src/, template/; script dev:sync/dev:check
├─ src/
│  ├─ cli.mjs                 # entrypoint: parseArgs, dispatch init/update, output umano o --json, exit code
│  ├─ actions.mjs             # init()/update(): cammina template/, confronto a 3 vie, scrive added/updated/skipped/conflicts/removed/orphaned
│  ├─ manifest.mjs            # sha256(), readManifest(), writeManifest() (scrittura atomica), buildManifest()
│  └─ policies.mjs            # policyFor(relPath): "data" | "seeded-once" | "managed"
├─ template/                  # UNICA copia autorata di tutto ciò che viene distribuito
│  ├─ AGENTS.md                # versione generica seeded-once, scritta nei progetti consumer
│  ├─ init.mjs                 # setup/build indipendente dallo stack, guidato da init.config.json
│  ├─ init.config.json         # seed generico dei task setup/build
│  ├─ issue-manager.mjs        # CLI dell'issue tracker
│  ├─ issues.json              # seed vuoto (policy "data")
│  ├─ issues.html              # viewer HTML delle issue
│  ├─ hooks/                   # git hook harness (managed): docs post-commit + guard ruolo worker
│  │  ├─ pre-commit            # shim POSIX -> node pre-commit.mjs
│  │  ├─ pre-commit.mjs        # blocca commit solo con HARNESS_ROLE=worker
│  │  ├─ post-commit           # shim POSIX -> node post-commit.mjs
│  │  ├─ post-commit.mjs       # crea issue docs automatiche (warning, non blocca)
│  │  ├─ match.mjs             # matcher glob include/exclude per docsGate
│  │  └─ install.mjs           # installer idempotente: git config core.hooksPath hooks
│  └─ docs/
│     ├─ AGENTS-RULES.md       # regole operative invarianti (managed)
│     ├─ ARCHITECTURE.md       # skeleton generico seeded-once
│     ├─ GIT.md                # linee guida git (managed)
│     └─ ISSUES.md             # guida all'issue tracker (managed)
├─ test/                      # test node:test per cli/actions/init/issue-manager/update, eseguiti contro template/ e directory temporanee
├─ AGENTS.md                  # seeded-once, di proprietà di QUESTO repository (non del template)
├─ docs/ARCHITECTURE.md       # questo file: seeded-once, di proprietà di questo repository
├─ init.config.json           # seeded-once: comandi reali (npm install / npm test) per questo repo
├─ issues.json                # data: le 8 issue reali di questo progetto
├─ CLAUDE.md                  # regole di sviluppo del pacchetto stesso, non distribuito, non gestito dall'harness
└─ .harness-manifest.json     # generato da init/update in questo repo, ignorato nel pacchetto npm
```

## 4. Algoritmo di update

`update(targetDir)` legge `.harness-manifest.json` in `targetDir`; se assente si comporta
come `init` (prima materializzazione). Altrimenti, per ogni file di `template/`:

1. Se la policy è `seeded-once` o `data`: viene scritto solo se non esiste ancora
   (`added`); se esiste già, viene sempre lasciato intatto (`skipped`), indipendentemente
   da eventuali modifiche al template.
2. Se la policy è `managed` e il file non esiste sul target: viene scritto (`added`).
3. Se la policy è `managed` e il file esiste: si calcolano tre hash — quello del template
   corrente, quello registrato nell'ultimo manifest per quel file, quello effettivo sul
   disco. Se l'hash sul disco coincide già con quello nuovo del template, non c'è nulla da
   fare (`skipped`). Se l'hash sul disco coincide ancora con quello registrato nel
   manifest (il file è "pristine", nessuno lo ha toccato dall'ultima sincronizzazione),
   viene sovrascritto in sicurezza (`updated`). Se l'hash sul disco diverge dal manifest
   (il file è stato modificato), il file **non** viene toccato: diventa un `conflict` e la
   nuova versione del template viene scritta accanto come `<file>.new`, a meno che non sia
   passato `--force`, nel qual caso l'update sovrascrive comunque (`updated`).
4. I file che erano gestiti in una versione precedente del manifest ma non esistono più in
   `template/` vengono rimossi dal disco solo se ancora pristine (`removed`); se sono stati
   modificati vengono lasciati intatti e segnalati come `orphaned`.

Al termine viene riscritto `.harness-manifest.json` con gli hash del template corrente,
così che la prossima `update` riparta da una baseline coerente. `--dry-run` esegue lo
stesso calcolo senza scrivere nulla su disco (utile per il controllo di deriva in CI);
`--json` stampa il risultato come singola riga JSON; il processo esce con codice `2` se
`conflicts` non è vuoto, `0` altrimenti.

## 5. Dogfooding

Questo repository non si limita a produrre l'harness: lo consuma su se stesso. La radice
del progetto è un normale target di `node src/cli.mjs update .`, esattamente come lo
sarebbe la directory di un progetto qualunque che installa `@diemrt/harness`. Questo
garantisce due cose: primo, che ogni modifica a `template/` sia verificata end-to-end
contro un caso d'uso reale prima ancora di essere pubblicata; secondo, che la separazione
tra file `managed` (sincronizzati automaticamente) e file `seeded-once`/`data` (di
proprietà del repository) sia rispettata alla lettera anche qui, così i contenuti reali di
questo progetto — le sue regole operative in `AGENTS.md`, la sua architettura in questo
stesso file, le sue 8 issue in `issues.json` — non vengono mai sovrascritti da un
aggiornamento del template. Le regole per chi sviluppa il pacchetto (dove editare, quando
lanciare `npm run dev:sync`, cosa il CLAUDE.md-only gate impone) vivono in `CLAUDE.md`, che
resta fuori da `template/` apposta: essendo un file non distribuito, non gestito
dall'harness, `dev:sync`/`update` non possono mai toccarlo.
