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

In inglese, piccoli, leggibili, legati a una modifica coerente. **Sul ramo di lavoro i commit sono
liberi**: sono punti fermi, e un tratto lungo ne merita più di uno.

Il confine è la **pubblicazione** — `push` sul ramo condiviso, o merge — e niente lo attraversa
prima del `pass` del verificatore. Una issue che fallisce lascia i suoi commit sul ramo: si
corregge con altri commit e si pubblica dopo, senza riscrivere niente.

Non c'è nessuna corrispondenza obbligata fra una issue e un commit. Harness non chiede di
schiacciare la storia: chiede che al confine ogni issue rappresentata di là abbia il suo `pass`.

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

- ogni issue rappresentata nei commit che stai per pubblicare ha il suo `pass`;
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

## Cosa harness scrive nel progetto

`issues.json` alla radice e `.harness/` (configurazione, archivi di `--compact`, log dei
worker).

**Cosa di questo entri in git lo decidi tu.** Harness non scrive nessun `.gitignore`: né il
tuo, che resta intatto, né uno proprio dentro `.harness/`. La directory compare fra gli
untracked e la scelta resta una scelta.

Un caso in cui vale la pena farla di proposito: se hai compattato il tracker, ogni blocco in
`issues.json` porta il path del proprio archivio sotto `.harness/archive/`. `issues.json` è
condiviso; l'archivio lo è solo se lo versioni. Lasciarlo fuori significa consegnare a chi
clona otto puntatori verso il nulla.
