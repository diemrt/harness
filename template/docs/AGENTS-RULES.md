# AGENTS-RULES.md

Questo documento contiene le regole operative **invarianti** dell'harness (clock-in,
regola 1-WIP, clock-out con verifica indipendente, gate sul commit, init/build
dell'ambiente). È `managed`: viene mantenuto sincronizzato da `harness update` e
**non va modificato a mano**. La descrizione specifica del progetto vive invece in
[AGENTS.md](/AGENTS.md), che è di proprietà del progetto e non viene mai sovrascritto.

## All'inizio di ogni sessione (clock in)

1. Leggi [ISSUES.md](/docs/ISSUES.md) per ricordare come gestire le issue del progetto
2. Verifica lo stato attuale delle issue:
   ```bash
   node issue-manager.mjs --get-all --status backlog
   node issue-manager.mjs --get-all --status in_progress
   ```
3. Verifica che l'ambiente sia configurato correttamente con `node init.mjs setup`. In caso
   di errore, fermarsi e notificare il problema, per evitare ulteriore consumo di token.
4. Identifica le issue su cui lavorare: **una sola issue `in_progress` per catena di dipendenza**, ma issue scorrelate possono procedere in parallelo (regola 1-WIP per catena, vedi sotto).
5. Rispetta le seguenti policy a seconda dello scenario e della richiesta:
   - Ogni volta che viene richiesta una modifica o un'analisi sul progetto, verificare che siano stati letti e compresi i documenti informativi necessari alla comprensione. Evitare di leggere informazioni non necessarie alla richiesta.
   - L'harness è cross-platform: gli script si eseguono con `node` (bare, senza wrapper) su qualsiasi sistema operativo. Non è richiesta una shell specifica: usa il terminale disponibile nell'ambiente corrente (PowerShell, bash o altro).

## Regola 1-WIP per catena di dipendenza

**Una sola issue può essere `in_progress` per ciascuna catena di dipendenza.** Issue
**scorrelate** (catene di dipendenza distinte) possono invece essere `in_progress` **in
parallelo**. All'interno di una stessa catena si procede in ordine di dipendenza, una alla
volta. **Avvia un subagent per issue.** Usa un modello con un consumo di token medio, come Sonnet.

**Overlap verifica → next:** puoi avviare il lavoro sulla issue successiva **mentre il
subagent di verifica indipendente** della precedente è **ancora in corso** (sovrapposizione
temporale), purché appartengano a catene compatibili con la regola sopra. Questo evita di
restare fermi ad aspettare la verifica per task semplici.

Se `externalWorker.enabled` in `init.config.json`, il subagent può essere un worker esterno: vedi [EXTERNAL-WORKER.md](/docs/EXTERNAL-WORKER.md) per il pattern di delega (worker ≠ verificatore ≠ orchestratore resta invariato).

**INVARIATO (non negoziabile), qualunque sia il grado di parallelismo:**
- **verifica indipendente da subagent su OGNI issue** (mai auto-verifica);
- **commit SOLO dopo `validation.state = pass`** dato dal subagent;
- **nessun `pass` auto-assegnato** dall'agente che ha svolto il lavoro.

## Prima della fine di ogni sessione (clock out)

> **Principio anti self-validation bias:** l'agente che ha svolto il lavoro **non** può
> dichiarare da solo che una issue è superata. La verifica deve essere **indipendente** e
> affidata a un subagent dedicato. Nessun `validation.state = pass` auto-assegnato.

Per **ogni** issue lavorata nella sessione (una alla volta all'interno della stessa catena
di dipendenza; issue scorrelate in parallelo):

1. Concludi il lavoro sulla issue e raccogli gli artefatti prodotti (file modificati,
   output dei comandi rilevanti).
2. **Avvia un subagent di verifica indipendente** (vedi `ISSUES.md` → "Verifica
   indipendente (subagent)"). Il subagent:
   - controlla i `validation.criteria` della issue contro gli artefatti reali;
   - esegue `node init.mjs build` (i comandi effettivi sono quelli definiti dal task
     `build` in `init.config.json`, qualunque sia lo stack del progetto) per confermare che
     il codice si costruisca correttamente e che le dipendenze siano risolte: **il gate di
     verifica è l'esito di questo comando**;
   - **verifica soltanto, non corregge** il lavoro;
   - aggiorna la issue tramite `node issue-manager.mjs --update`:
     - verifica **superata** → `status = done`, `validation.state = pass`, `criteria`
       con l'evidenza della verifica;
     - verifica **fallita** → `status = blocked`, `validation.state = fail`, `criteria`
       con il motivo del fallimento.
3. **Commit immediato (snapshot per issue):** appena la issue corrente è verificata
   `pass` dal subagent, effettua **subito** un commit dedicato (seguendo `GIT.md` alla
   lettera) che catturi lo stato di quella singola issue. Ogni issue conclusa = uno
   snapshot commit tracciabile.
4. Il commit di ciascuna issue avviene solo dopo il suo `pass` (gate invariato). Puoi però
   avviare la issue successiva mentre il subagent di verifica della precedente è ancora in
   corso, nei limiti della regola 1-WIP per catena di dipendenza.

### Gate sul commit

Committa **una issue alla volta**, come snapshot, **solo** dopo che il subagent di verifica
indipendente ha impostato `validation.state = pass`. **Nessun commit** di una issue
`done` / `pass` non verificata dal subagent, né di una issue `blocked`: se la verifica
fallisce, nessun commit finché la issue non viene ripresa, corretta e riverificata `pass`.

### Gate documentale sul pre-commit (hook)

Il gate descritto sopra ("commit solo dopo `pass` del subagent") è un vincolo di
**processo**, applicato dall'agente. A questo si aggiunge un **secondo livello, a livello
git**, indipendente dal primo: l'hook `pre-commit` dell'harness (`hooks/pre-commit.mjs`),
che scatta su **ogni** `git commit`, anche quando il gate sopra è già stato rispettato.

1. Al momento del commit, l'hook `pre-commit` blocca l'operazione (`exit` diverso da `0`)
   e stampa su stderr un'istruzione strutturata, insieme all'elenco dei file in stage.
2. L'agente **deve** trattare quell'output come un ulteriore prompt a cui reagire, non come
   un errore da ignorare o da bypassare meccanicamente. **Valuta**, sulla base delle issue
   lavorate e dei file in stage, se sono state sviluppate **nuove funzionalità** e se di
   conseguenza vanno aggiornati i file sotto `docs/` o `AGENTS.md`.
3. Se serve un aggiornamento, **non modificare i docs adesso**: crea invece una **nuova
   issue di docs** con `node issue-manager.mjs --insert`. La sua **descrizione** deve
   contenere la lista dei file da aggiornare e, per ciascuno, cosa cambiare. La
   `validation.criteria` deve contenere i criteri specifici **più** la frase fissa, con
   `validation.state: "unknown"`:

   > Controllare che tutti i file siano stati aggiornati, che sia stato usato meno testo
   > possibile, che non siano state introdotte delle ripetizioni in documenti diversi

   Il lavoro documentale resta così **tracciato e deferito** a quella issue, gestita poi col
   normale workflow (clock-in, verifica indipendente, gate sul commit).
4. Ricommitta impostando la variabile d'ambiente `HARNESS_DOCS_VERIFIED=1` (bypass
   anti-loop): il commit del codice **prosegue subito** e l'hook non blocca di nuovo,
   evitando un ciclo infinito. Se non serve alcun aggiornamento docs, ricommitta
   direttamente con la stessa variabile.

Esempi di impostazione della variabile per le shell più comuni:

```bash
# bash/sh
HARNESS_DOCS_VERIFIED=1 git commit -m "..."
```

```powershell
# PowerShell
$env:HARNESS_DOCS_VERIFIED=1; git commit -m "..."
```

```bat
:: cmd
set HARNESS_DOCS_VERIFIED=1 && git commit -m "..."
```

Questo gate **non sostituisce** quello descritto in "Gate sul commit": lo snapshot commit
per issue avviene comunque solo dopo il `pass` del subagent di verifica indipendente; il
gate a livello hook è un controllo aggiuntivo, automatico e non bypassabile per errore, che
si applica a ogni commit indipendentemente dal fatto che riguardi una issue tracciata.

## Init / verifica ambiente (init.mjs)

Lo script `init.mjs` è il punto unico di setup e verifica dell'ambiente ed è **generico e
indipendente dallo stack**: non contiene comandi specifici di una tecnologia. I comandi
effettivi sono definiti nel file di configurazione **`init.config.json`** (nella stessa
cartella dello script), così lo stesso harness può adattarsi a qualsiasi stack (Node,
Python, Go, .NET, ...). Per adattarlo a un progetto basta modificare `init.config.json`,
senza toccare `init.mjs`. Comandi:

- `node init.mjs setup` — esegue in ordine gli `steps` del task `setup` definito in
  `init.config.json` (es. install delle librerie, preparazione dell'ambiente). Da usare in
  fase di clock-in.
- `node init.mjs build` — esegue in ordine gli `steps` del task `build` definito in
  `init.config.json` (es. compilazione, packaging). Da usare come verifica in fase di
  clock-out (prova che il codice si costruisca e le dipendenze siano risolte).

Formato di `init.config.json`: un oggetto `tasks` con una chiave per task (`setup`,
`build`); ogni task ha una `workingDirectory` opzionale (relativa alla cartella dello
script) e una lista ordinata di `steps`, ognuno con `description` (messaggio a video) e
`command` (riga eseguita nella shell).

**Nota:** in caso di errore (config mancante o non valida, task inesistente, uno step che
esce con codice diverso da 0) lo script termina con `exit 1` e un messaggio chiaro;
fermarsi e notificare il problema.
