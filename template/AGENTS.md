# AGENTS.md

Breve descrizione del progetto dalle 200 alle 500 parole.

# Documenti

- [ARCHITECTURE.md](/docs/ARCHITECTURE.md): architettura, stack tecnologico, struttura del codice, flusso di elaborazione, modello dati, build e punti di estensione.
- [GIT.md](/docs/GIT.md): indica le linee guida da usare per il versioning con git.
- [ISSUES.md](/docs/ISSUES.md): descrive come gestire le issues del progetto e usare `issue-manager.ps1`.

## All'inizio di ogni sessione (clock in)

1. Leggi [ISSUES.md](/docs/ISSUES.md) per ricordare come gestire le issue del progetto
2. Verifica lo stato attuale delle issue:
   ```powershell
   .\issue-manager.ps1 -getAll -status backlog
   .\issue-manager.ps1 -getAll -status in_progress
   ```
3. Verifica che l'ambiente sia configurato correttamente con `.\init.ps1 setup`. In caso
   di errore, fermarsi e notificare il problema, per evitare ulteriore consumo di token.
4. Identifica le issue su cui lavorare: **una sola issue `in_progress` per catena di dipendenza**, ma issue scorrelate possono procedere in parallelo (regola 1-WIP per catena, vedi sotto).
5. Rispetta le seguenti policy a seconda dello scenario e della richiesta:
   - Ogni volta che viene richiesta una modifica o un'analisi sul progetto, verificare che siano stati letti e compresi i documenti informativi necessari alla comprensione. Evitare di leggere informazioni non necessarie alla richiesta.
   - Quando occorre esegui sempre comandi PowerShell, non provare comandi cmd, o bash o di altri terminali se possibile.

## Regola 1-WIP per catena di dipendenza

**Una sola issue può essere `in_progress` per ciascuna catena di dipendenza.** Issue
**scorrelate** (catene di dipendenza distinte) possono invece essere `in_progress` **in
parallelo**. All'interno di una stessa catena si procede in ordine di dipendenza, una alla
volta. **Avvia un subagent per issue.** Usa un modello con un consumo di token medio, come Sonnet.

**Overlap verifica → next:** puoi avviare il lavoro sulla issue successiva **mentre il
subagent di verifica indipendente** della precedente è **ancora in corso** (sovrapposizione
temporale), purché appartengano a catene compatibili con la regola sopra. Questo evita di
restare fermi ad aspettare la verifica per task semplici.

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
   - esegue `.\init.ps1 build` (restore + compilazione MSBuild in configurazione Debug) per
     confermare che il codice compili e che le librerie siano risolte correttamente. Non esiste
     un progetto di test unitari: **il gate di verifica è la build**;
   - **verifica soltanto, non corregge** il lavoro;
   - aggiorna la issue tramite `.\issue-manager.ps1 -update`:
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

## Init / verifica ambiente (init.ps1)

Lo script `init.ps1` è il punto unico di setup e verifica dell'ambiente ed è **generico e
indipendente dallo stack**: non contiene comandi specifici di una tecnologia. I comandi
effettivi sono definiti nel file di configurazione **`init.config.json`** (nella stessa
cartella dello script), così lo stesso harness può adattarsi a qualsiasi stack (Node,
Python, Go, .NET, ...). Per adattarlo a un progetto basta modificare `init.config.json`,
senza toccare `init.ps1`. Comandi:

- `.\init.ps1 setup` — esegue in ordine gli `steps` del task `setup` definito in
  `init.config.json` (es. install delle librerie, preparazione dell'ambiente). Da usare in
  fase di clock-in.
- `.\init.ps1 build` — esegue in ordine gli `steps` del task `build` definito in
  `init.config.json` (es. compilazione, packaging). Da usare come verifica in fase di
  clock-out (prova che il codice compili e le dipendenze siano risolte).

Formato di `init.config.json`: un oggetto `tasks` con una chiave per task (`setup`,
`build`); ogni task ha una `workingDirectory` opzionale (relativa alla cartella dello
script) e una lista ordinata di `steps`, ognuno con `description` (messaggio a video) e
`command` (riga eseguita nella shell).

**Nota:** in caso di errore (config mancante o non valida, task inesistente, uno step che
esce con codice diverso da 0) lo script termina con `exit 1` e un messaggio chiaro;
fermarsi e notificare il problema.
