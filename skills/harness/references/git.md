# Git

Linee guida minime per il versioning durante il lavoro con harness.

## Branch

Un branch principale stabile, branch di lavoro dedicati.

- `main` — codice stabile o comunque verificato
- `feature/...` — nuove funzionalità o miglioramenti
- `fix/...` — correzioni di bug
- `docs/...` — modifiche solo documentali
- `chore/...` — manutenzione tecnica senza cambio funzionale

```text
feature/insert-hours-form
fix/sso-login-redirect
docs/architecture-overview
chore/update-dependencies
```

## Commit

In inglese, piccoli, leggibili, legati a una modifica coerente. Un commit per issue, come
snapshot, **solo dopo il `pass` del verificatore**.

```text
tipo: descrizione breve
```

Tipi: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.

```text
feat: add monthly hours summary
fix: handle expired sso token
docs: add architecture overview
```

Il corpo del messaggio serve quando il "perché" non è ovvio dal diff: spiega la ragione, non
riassume le righe cambiate.

## Revisione prima di fondere

Anche lavorando da soli, prima di un merge controlla:

- la modifica risponde allo scopo dichiarato nella issue;
- non sono stati toccati file estranei alla richiesta;
- il progetto si costruisce (il comando di verifica di `.harness/config.json` passa);
- i test rilevanti sono stati eseguiti;
- nessuna modifica accidentale alla configurazione;
- nessun segreto o dato sensibile introdotto.

## Configurazione e segreti

I file di configurazione (`appsettings.*.json`, `.env`, `environments/`, ...) contengono
parametri operativi e a volte credenziali.

- evita commit non necessari sui file di configurazione;
- non pubblicare un repository che contiene credenziali reali;
- preferisci user secrets o variabili d'ambiente ai valori scritti nel repo;
- tieni una versione di esempio priva di credenziali.

Le regole di permesso che autorizzano comandi con bypass (es. la delega a un worker esterno)
vanno in `.claude/settings.local.json`, non committato — mai in `.claude/settings.json`.

## Cosa harness aggiunge al repository

Solo `issues.json`. `.harness/` si auto-ignora tramite un proprio `.gitignore` con `*`: non
va aggiunta al `.gitignore` del progetto, che resta intatto.
