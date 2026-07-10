# AGENTS.md

`@diemrt/harness` è un pacchetto npm che distribuisce un harness di sviluppo controllato
per agenti AI: un issue tracker a riga di comando (`issue-manager.mjs`), uno script di
setup/build indipendente dallo stack (`init.mjs`), un visualizzatore HTML delle issue
(`issues.html`) e un insieme di regole operative (`docs/AGENTS-RULES.md`) pensate per
governare come un agente lavora su un progetto: clock-in, regola 1-WIP per catena di
dipendenza, clock-out con verifica indipendente da subagent, gate sul commit.

Il problema che risolve: prima di questo pacchetto, l'harness veniva copiato a mano in
ogni nuovo progetto. Ogni miglioramento (un fix nello script, una regola chiarita, un
campo nuovo nel modello delle issue) restava intrappolato nel repository in cui era stato
scritto e non si propagava mai agli altri progetti già avviati, che finivano per divergere
silenziosamente dalla versione più aggiornata. `@diemrt/harness` centralizza l'harness in
un unico pacchetto versionato e offre due comandi, `init` e `update`, per portarlo dentro
un progetto e mantenerlo sincronizzato nel tempo.

`init <targetDir>` copia l'intero contenuto di `template/` dentro `targetDir`, scrive
`.harness-manifest.json` (hash sha256 di ogni file al momento della copia, più la sua
policy) e non tocca nulla che esista già, a meno di `--force`. `update <targetDir>`
confronta, file per file, l'hash sul disco con quello registrato nel manifest e con quello
del template corrente: se il file è ancora "pristine" (identico a quanto scritto
dall'ultima `init`/`update`) lo aggiorna in silenzio; se è stato modificato lo segnala come
conflitto e scrive `<file>.new` accanto, senza mai sovrascrivere lavoro non salvato.

Ogni file del template ha esattamente una delle tre policy definite in
`src/policies.mjs`: `data` (dati di proprietà dell'utente, mai sovrascritti — `issues.json`
è l'unico caso), `seeded-once` (scritti da `init` ma mai più toccati da `update`, perché il
progetto è tenuto a personalizzarli — `AGENTS.md`, `docs/ARCHITECTURE.md`,
`init.config.json`) e `managed` (il default: tenuti sincronizzati col template finché
l'utente non li modifica). L'harness è a zero dipendenze runtime, scritto in ESM puro con
solo API `node:*`, e gira identico su Windows, macOS e Linux: nessuno script PowerShell,
nessun requisito di shell specifica.

Questo stesso repository è il primo consumer del proprio harness ("dogfooding"): la
cartella `template/` è l'unica copia autorata di tutto ciò che viene distribuito, mentre la
radice del repository ospita una copia materializzata tramite `node src/cli.mjs update .`,
tenuta onesta da `npm run dev:check` in CI. Le regole per sviluppare *questo* pacchetto
(dove editare, come sincronizzare, cosa non toccare mai) vivono in `CLAUDE.md`, che non fa
parte del template e non viene mai distribuito.

## Regole operative

Le regole operative invarianti dell'harness (clock-in, regola 1-WIP, clock-out con
verifica indipendente, gate sul commit, init/build dell'ambiente) sono definite in
[AGENTS-RULES.md](/docs/AGENTS-RULES.md). Seguile **alla lettera**: quel documento è
gestito dall'harness e mantenuto sincronizzato da `harness update`, questo file resta
invece di proprietà del progetto.

# Documenti

- [ARCHITECTURE.md](/docs/ARCHITECTURE.md): architettura, stack tecnologico, struttura del codice, flusso di elaborazione, modello dati, build e punti di estensione.
- [GIT.md](/docs/GIT.md): indica le linee guida da usare per il versioning con git.
- [ISSUES.md](/docs/ISSUES.md): descrive come gestire le issues del progetto e usare `issue-manager.mjs`.
- [AGENTS-RULES.md](/docs/AGENTS-RULES.md): regole operative invarianti dell'harness (clock-in, clock-out, regola 1-WIP, gate sul commit, init/build); mantenuto sincronizzato da `harness update`, non modificare a mano.
