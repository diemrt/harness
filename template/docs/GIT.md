# GIT.md

## 1. Obiettivo

Il documento definisce alcune linee guida minime per usare Git durante lo sviluppo dell'applicazione.

## 2. Branch

Il flusso consigliato prevede un branch principale stabile e branch di lavoro dedicati.

- `main`: contiene codice stabile o comunque verificato
- `feature/...`: nuove funzionalita o miglioramenti
- `fix/...`: correzioni di bug
- `docs/...`: modifiche solo documentali
- `chore/...`: aggiornamenti tecnici senza modifica funzionale diretta

Esempi:

```text
feature/insert-hours-form
fix/sso-login-redirect
docs/architecture-overview
chore/update-dependencies
```

## 3. Commit

I commit devono essere in lingua inglese, piccoli, leggibili e collegati ad una modifica coerente.

Formato consigliato:

```text
tipo: descrizione breve
```

Tipi consigliati:

- `feat`: nuova funzionalita
- `fix`: correzione di un errore
- `docs`: documentazione
- `test`: aggiunta o modifica test
- `refactor`: modifica interna senza cambio funzionale
- `chore`: manutenzione tecnica

Esempi:

```text
docs: add architecture overview
fix: handle expired sso token
feat: add monthly hours summary
```

## 4. Pull request o revisione

Anche quando il progetto e sviluppato in modo individuale, prima di fondere una modifica e utile fare una revisione minima.

Controllare:

- La modifica risponde allo scopo dichiarato
- Non sono stati modificati file non collegati alla richiesta
- Il backend compila correttamente e il frontend si builda senza errori
- I test manuali o automatici rilevanti sono stati eseguiti
- La configurazione non contiene modifiche accidentali
- Non sono stati introdotti segreti nuovi o dati sensibili non necessari

## 5. Gestione configurazione e segreti

I file di configurazione del backend (`appsettings.json` / `appsettings.*.json`) e gli `environments` del frontend Angular contengono parametri operativi e possono contenere informazioni sensibili (connection string, endpoint, credenziali SSO).

Regole consigliate:

- Evitare commit non necessari sui file di configurazione
- Non pubblicare il repository se contiene credenziali reali
- Valutare l'introduzione di User Secrets o variabili d'ambiente per il backend
- Tenere una versione di esempio della configurazione priva di credenziali reali

> Nota critica: questa e una priorita tecnica da affrontare prima di rendere il repository pubblico o distribuirlo fuori dal perimetro aziendale.

## 7. Checklist prima del merge

Prima di chiudere una modifica verificare:

1. Build del backend (`dotnet build`) e del frontend (`ng build`) completate senza errori
2. Documentazione aggiornata se il comportamento cambia
3. Nessuna modifica accidentale ai dati di configurazione
4. Logica principale verificata con un caso manuale o test automatico
5. Commit ordinati e descrittivi
