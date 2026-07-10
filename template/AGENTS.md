# AGENTS.md

Breve descrizione del progetto dalle 200 alle 500 parole.

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
