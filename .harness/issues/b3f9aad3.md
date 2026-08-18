---
id: b3f9aad3-153e-44b8-bb96-1da6147ec3b0
title: Core storage Markdown e migrazione schema 4
status: done
tier: reasoning
depends_on: []
covers: []
tasks:
  -
    checked: true
    id: 1
    short_title: Implementare codec e issue store
    full_description: Scrivere prima i test fallenti, poi implementare il codec frontmatter ristretto e le operazioni atomiche per file issue.
  -
    checked: true
    id: 2
    short_title: Migrare CRUD e comando dump
    full_description: Adattare issue-manager a store Markdown per letture, CRUD, init e dump conservando guard ed envelope.
  -
    checked: true
    id: 3
    short_title: Implementare upgrade e compact
    full_description: Aggiungere migrazione storage schema 4, recupero da conflitto, idempotenza e compattazione per file.
  -
    checked: true
    id: 4
    short_title: Aggiornare config schema quattro
    full_description: Validare e preservare schema_version, aggiornare i default docs gate e la config del repository.
  -
    checked: true
    id: 5
    short_title: Migrare status e docs gate
    full_description: Fare consumare issue-manager --dump a status-cli e docs-gate preservando i rispettivi contratti di errore.
  -
    checked: true
    id: 6
    short_title: Migrare il tracker live
    full_description: Catturare il baseline, eseguire --upgrade sul repository e provare uguaglianza semantica e idempotenza.
  -
    checked: true
    id: 7
    short_title: Verificare e affidare review
    full_description: Eseguire suite mirate e completa, allineare i task e portare la issue in review per il verificatore indipendente.
validation:
  criteria: "Verifica indipendente su feat/markdown-issue-storage (HEAD d08e0ec). Gate: npm run test da .harness/config.json -> exit 0, tests 472 / pass 472 / fail 0. Tutti i probe della CLI eseguiti su copie in directory temporanea con --project-dir esplicito; git status --short vuoto prima e dopo: nessun file del repository toccato dal verificatore.\n\nC1 codec (SODDISFATTO). Round-trip serializeIssue -> parseIssue sulle 25 issue del baseline .harness/archive/upgrade-2026-08-18T07-56-31Z.json: zero differenze confrontando campo per campo. La sola differenza e nell ordine delle chiavi (description spostata in coda dal codec), che in JSON non e semantico. Casi avversi tutti superati: virgolette, due punti, cancelletto, parentesi quadre e graffe, tab; stringhe che sembrano numero, booleano o null; description vuota; stringhe con spazi in testa e in coda; caratteri YAML punto esclamativo, e commerciale, asterisco; corpo che inizia con tre trattini; depends_on, covers e tasks a lista vuota; validation a null; validation con criteri vuoti. description nel solo corpo Markdown: Select-String sui 25 file di .harness/issues con pattern di inizio riga description due punti restituisce 0 occorrenze.\n\nC2 importer unico, CRUD, guard, envelope, --dump (SODDISFATTO). Unico importer fra gli script: scripts/issue-manager.mjs riga 123; il test strutturale a test/plugin-issue-store.test.mjs riga 35 scandisce gli script e lo fissa. CRUD su copia temporanea: --init risponde path e created true, il secondo --init ALREADY_EXISTS; --insert crea il file d7fb80ad.md; --get su id inesistente NOT_FOUND con exit 1; --get-all restituisce totalCount, page, pageSize, issues; --update conserva una description con due punti, cancelletto, virgolette e parentesi, riletta identica via --get; --delete risponde deleted true, il file sparisce e non restano file temporanei. Guard con HARNESS_ROLE=worker: validation.state a pass FORBIDDEN_ROLE, spunta di validation.tasks FORBIDDEN_ROLE. Envelope ok true con data oppure ok false con error e code, exit 0 e 1; flag ignoto UNKNOWN_COMMAND. --dump restituisce schema_version 4 e le issue in ordine di id crescente, come dichiara l help.\n\nC3 upgrade (SODDISFATTO). Copia legacy schema 3: la lettura prima dell upgrade risponde STORAGE_NOT_MIGRATED con exit 1; --upgrade risponde from 3, to 4, migrated 0, issues 25, resumed false, scrive 25 file Markdown, elimina il tracker JSON e lascia l archivio byte-identico all originale (stesso sha256, C9645BF3 ... 9928). Idempotenza: il secondo --upgrade risponde from 4 to 4 migrated 0 e il confronto di nome, dimensione, sha256 e mtime sui 26 file non produce differenze. Ripresa: progetto con tracker JSON piu 3 file Markdown gia corretti, la lettura da STORAGE_CONFLICT e --upgrade risponde resumed true, 25 file, tracker JSON eliminato. Rifiuti: un file Markdown assente dal tracker JSON da STORAGE_CONFLICT, un file Markdown divergente (status done cambiato in backlog) idem; in entrambi i casi lo snapshot con hash prima e dopo e identico, la cartella archive non viene creata e il tracker JSON resta intatto. Un tracker che dichiara schema_version 99 viene respinto con SCHEMA_TOO_NEW senza scrivere niente.\n\nC4 compact e config (SODDISFATTO). --compact di 3 issue done su copia risponde removed 3 e un blocco con archivedCount 3; il diff dell albero calcolato con gli hash mostra esattamente 5 percorsi cambiati: i 3 file eliminati, il file di blocco 077da120.md e l archivio JSON nuovo. I restanti 22 file Markdown e l archivio di upgrade preesistente restano byte-identici. L archivio JSON porta schema_version, archived_at e issues, e i 3 record archiviati sono identici al baseline. Config: harness-config.mjs --init --force con un payload che non nomina schema_version conserva il 4 gia presente su disco e riscrive exclude puntando alla cartella .harness al posto di issues.json; i valori 4 fra virgolette, 4.5, -1 e null vengono respinti con INVALID_INPUT. Il config.json del repository dichiara schema_version 4 come prima chiave e ha la cartella .harness fra gli exclude.\n\nC5 consumer via --dump (SODDISFATTO). Entrambi eseguono issue-manager --dump come processo figlio: spawnSync a scripts/status-cli.mjs riga 392 e scripts/docs-gate.mjs riga 322. Nessuno dei due importa issue-store ne apre la cartella delle issue: status-cli importa da node:fs solo existsSync e statSync, docs-gate usa readFileSync solo per config.json, e la ricerca di readdirSync o di percorsi verso la cartella delle issue nei due file non produce riscontri. Contratti di errore preservati: status su tracker legacy exit 1 con il messaggio di issue-manager riportato verbatim, su tracker in conflitto exit 1 col testo di STORAGE_CONFLICT, su progetto vuoto exit 0 con tracker vuoto; --oneline sempre exit 0, output vuoto quando il tracker non e leggibile. docs-gate: legacy exit 1 con lo stesso messaggio, config assente exit 1, gate disabilitato exit 0, nessuna finestra e nessun --since exit 1. Sul repository reale docs-gate con --since HEAD~6 esce 0 con 6 commit nella finestra, 3 che toccano codice, 0 non coperti.\n\nC6 tracker live (SODDISFATTO). --dump del repository restituisce 25 issue a schema_version 4. Confronto campo per campo con l archivio verbatim, che e byte-identico alla copia del tracker JSON alla revisione precedente alla migrazione (stesso sha256): nessuna issue mancante, nessuna in piu, e sole 2 differenze, entrambe su b3f9aad3 e posteriori al travaso: il task numero 6 passa da checked false a true e updated_at da 2026-08-18T07:56:11Z a 07:58:42Z, cioe la spunta legittima del task 6 fatta dopo la migrazione. Le altre 24 issue sono identiche campo per campo; le issue con covers non vuoto sono 8 nel baseline e 8 nel tracker vivo. L ordine dell array passa da ordine di inserimento a id crescente: e il contratto dichiarato di --dump e nessun consumer vi si appoggiava, dato che --get-all ordina per id e status-cli per created_at. Nessun tracker JSON resta nell albero di lavoro. Letture reali tutte verdi: --dump, --get, --get-all, status-cli completo e --oneline, docs-gate. Idempotenza sul contenuto vivo: --upgrade su una copia byte-esatta della cartella delle issue piu la config risponde from 4 to 4 migrated 0 e non tocca nessuno dei 26 file per dimensione, sha256 e mtime.\n\nOsservazioni fuori scope, non bloccanti. (a) Un ritorno a capo in stile CRLF dentro una description viene normalizzato a solo LF dal codec: inserendo una description con CR e LF si rilegge con il solo LF. E una conseguenza del tenere la description nel corpo Markdown e serve a sopravvivere ai checkout con autocrlf, ma e una perdita che lo storage JSON non aveva. (b) skills/harness/references/issues.md e aggiornata in testa (righe 1-53) mentre le sezioni --init, --upgrade e --compact (dalla riga 132 in poi) descrivono ancora il tracker JSON, schema_version 2 e un data di --upgrade senza i campi issues, archivePath e resumed: e il debito che la issue 1d1fef48 dichiara di coprire. (c) La config del repository guadagna anche execution mode auto, che era gia il default applicato: materializzazione, non cambio di comportamento."
  tasks:
    -
      id: 1
      short_title: Verificare codec e store
      full_description: Eseguire i test del codec, dei file per issue e delle operazioni atomiche.
      checked: true
    -
      id: 2
      short_title: Verificare manager e migrazione
      full_description: Provare CRUD, dump, upgrade, conflitto, idempotenza e compact su progetti temporanei.
      checked: true
    -
      id: 3
      short_title: Verificare config
      full_description: Controllare schema_version e default docs gate nella configurazione.
      checked: true
    -
      id: 4
      short_title: Verificare consumer dump
      full_description: Provare status completo, oneline e docs gate sui casi di storage previsti.
      checked: true
    -
      id: 5
      short_title: Verificare tracker live
      full_description: Confrontare baseline e tracker migrato, quindi provare idempotenza e letture reali.
      checked: true
  state: pass
created_at: "2026-08-17T12:49:45Z"
updated_at: "2026-08-18T08:20:04Z"
---

# Core storage Markdown e migrazione schema 4

Sostituire il tracker JSON con file Markdown per issue: codec frontmatter ristretto, issue-store, issue-manager, CRUD, --dump, upgrade 3→4, compact, config, consumer e migrazione live. Correzione di scope approvata dal committente il 2026-08-17: consumer e migrazione restano nella stessa issue perche il repository deve poter aggiornare e mostrare il proprio tracker durante il passaggio.
