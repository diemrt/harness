---
id: 95f601ad-eb21-427c-86e8-402bcec7e663
title: Lo stato della issue nel nome del file
status: done
tier: standard
depends_on: [1d1fef48-e1ec-46f4-b387-4be1b6a7a854]
covers: [016c0bc41a9b517faa6527f9d431fe16bf1fa864]
tasks:
  -
    id: 1
    short_title: Scrivere i test del naming
    full_description: "Test fallenti prima: nome derivato da stato e id, ricerca del file dal solo id, rinomina alla transizione di stato, ID_COLLISION su due file per lo stesso id, rifiuto di un prefisso che non combacia col frontmatter."
    checked: true
  -
    id: 2
    short_title: Implementare in issue-store
    full_description: issuePath da id e stato, findIssueFile dal solo id, writeIssue che scrive il nuovo prima di cancellare il vecchio, readAllIssues che valida prefisso e unicita' dell id.
    checked: true
  -
    id: 3
    short_title: Adeguare issue-manager e le fixture
    full_description: Il punto di issue-manager che calcola il path nella prova a secco di --upgrade, e le fixture delle suite di manager, store, status-cli e docs-gate.
    checked: true
  -
    id: 4
    short_title: Rinominare il tracker vivo
    full_description: Catturare lo stato attuale, rinominare i file delle 25 issue e provare che il tracker resti semanticamente identico, senza aggiungere codice di migrazione.
    checked: true
  -
    id: 5
    short_title: Allineare i documenti
    full_description: README, references/issues.md e skills/issue/SKILL.md dove promettono un file chiamato col solo id.
    checked: true
  -
    id: 6
    short_title: Verificare e affidare review
    full_description: Suite completa, gate documentale, allineamento dei task e passaggio in review per il verificatore indipendente.
    checked: true
validation:
  criteria:
    - "C1 OK (formato e rifiuti) - i 27 file di .harness/issues rispettano <stato>-<primi 8 char id>.md: backlog-adccd454.md, done-*.md (25), in_review-95f601ad.md. Su copie temporanee (--project-dir esplicito): 'aaaaaaaa.md' fa fallire --dump e --get-all con INVALID_INPUT \"Issue file 'aaaaaaaa.md' does not match its id.\"; 'wip-aaaaaaaa.md' (prefisso non fra i cinque) idem; 'done-aaaaaaaa.md' con frontmatter 'status: backlog' fa fallire --dump e --get-all (sia --status backlog sia done) con INVALID_INPUT \"Issue file 'done-aaaaaaaa.md' says 'done' but the issue is 'backlog'.\" OSSERVAZIONE, non conteggiata come fail perche' il task 2 della decomposizione colloca la validazione del nome in readAllIssues: il percorso di lettura singola non la applica - findIssueFile accetta qualunque nome che finisca in -<shortid>.md, quindi --get risponde ok:true sia su 'wip-aaaaaaaa.md' sia su 'done-aaaaaaaa.md' con frontmatter backlog, e risponde NOT_FOUND invece che INVALID_INPUT su 'aaaaaaaa.md'. Il dato restituito resta quello del frontmatter, e un --update risana il nome (done-aaaaaaaa.md -> backlog-aaaaaaaa.md), dopo il quale --dump torna ok."
    - "C2 OK (ordine di scrittura e ID_COLLISION) - ordine osservato sul disco, non dedotto dal codice: caricando il vero scripts/issue-store.mjs con un resolve hook che sostituisce node:fs con uno spy, il passaggio backlog->in_review esegue writeFileSync del file temporaneo, poi il rename verso in_review-aaaaaaaa.md dopo il quale la directory contiene GIA' entrambi ('backlog-aaaaaaaa.md | in_review-aaaaaaaa.md'), e solo a quel punto la rimozione di backlog-aaaaaaaa.md. Con i due file piantati a mano su copia temporanea ogni lettura fallisce exit 1 con code ID_COLLISION nominandoli entrambi: --get, --get-all --status backlog, --get-all --status done, --dump, e anche --delete e --update; messaggio \"Issue 'aaaaaaaa-...' is stored in more than one file (backlog-aaaaaaaa.md, in_review-aaaaaaaa.md). That is what an interrupted status change leaves behind...\". Il rifiuto non tocca i file: listing identico prima e dopo. --get su un id diverso continua a rispondere ok."
    - "C3 OK (ricerca dal solo id, contratti invariati) - probe differenziale su id fissi: la stessa batteria di 41 invocazioni (upgrade di seed, --get, --get-all con --status/--order/--page/--page-size, --update attraverso tutti e cinque gli stati passando solo --issue-id, --dump, --compact col rifiuto INVALID_DEPENDENCY su dipendenza viva, --delete, --delete ripetuto, --upgrade idempotente, 14 casi d'errore, guard HARNESS_ROLE=worker) eseguita contro l'implementazione pre-rinomina estratta con git archive da 016c0bc4^ e contro quella attuale: gli output normalizzati coincidono riga per riga (82 righe), tranne le 7 righe che sono l'elenco della directory. Envelope, payload di --dump (schema_version 4, ordine per id), payload di --compact e --upgrade, exit code e 12 codici d'errore (ALREADY_EXISTS, FORBIDDEN_ROLE, INVALID_DEPENDENCY, INVALID_ID, INVALID_INPUT, INVALID_JSON, INVALID_STATE, INVALID_STATUS, INVALID_TIER, MISSING_ARGS, NOT_FOUND, UNKNOWN_COMMAND, piu' FILE_NOT_FOUND in una seconda passata) sono identici. Unica differenza testuale, voluta e necessaria: la prova a secco di --upgrade dice ora \"would both be stored as '<status>-44444444.md'\" invece di \"'44444444.md'\", con lo stesso code ID_COLLISION."
    - "C4 OK (tracker vivo e assenza di migrazione) - confronto blob per blob con git ls-tree fra 016c0bc4^ e 016c0bc4: 26 dei 27 file hanno SHA identico sotto il nome nuovo; l'unico diverso e' 95f601ad, questa issue, che nello stesso commit spunta i propri sei tasks e aggiorna updated_at. Confronto semantico indipendente: --dump dell'albero pre-rinomina eseguito con l'implementazione pre-rinomina, contro --dump attuale -> stessi 27 id, stesso ordine, 26 oggetti issue identici in JSON, 1 diverso (questa issue). Nessun codice di migrazione: il diff di scripts/ nei due commit non introduce funzioni ne rami di migrazione. Nessun bump: SCHEMA_VERSION resta 4 (scripts/issue-manager.mjs:167) e .harness/config.json resta schema_version 4, entrambi invariati rispetto a 016c0bc4^. Nota: il criterio parla di 25 file, il tracker ne contiene 27 - conteggio invecchiato, tutti e 27 rinominati e nessuno rimasto col nome vecchio."
    - "C5 OK (documenti) - README.md:104 e il blocco aggiunto col comando ls .harness/issues descrivono <status>-<first eight characters of its id>.md; skills/harness/references/issues.md:16 e il paragrafo aggiunto descrivono <stato>-<primi 8 caratteri del suo id>.md, l'ordine di scrittura e il rifiuto del prefisso che mente; skills/issue/SKILL.md:22 dice .harness/issues/<stato>-<primi 8 caratteri dell'id>.md. Grep su skills/, agents/, commands/ e README.md: nessun documento della superficie rilasciata promette piu' un file chiamato col solo id. Le menzioni residue del nome vecchio stanno solo in docs/superpowers/specs e docs/superpowers/plans, documenti storici che il piano stesso vieta di riscrivere, e in fixture di test che piantano di proposito un nome malformato."
    - "GATE E COLLATERALI - comando dichiarato in .harness/config.json (verify: npm run test) eseguito sul ramo feat/markdown-issue-storage: tests 478, pass 478, fail 0, exit 0. git status --short e git diff --stat vuoti prima e dopo la verifica: nessun file modificato dal verificatore oltre a questa chiusura. Il diff dei due commit tocca solo README.md, scripts/issue-manager.mjs, scripts/issue-store.mjs, skills/harness/references/issues.md, skills/issue/SKILL.md, quattro suite di test e i 27 file del tracker: nessuna modifica a .harness/config.json, nessun segreto nel diff. Ogni prova della CLI e' stata fatta su copie in directory temporanea con --project-dir esplicito; sul tracker reale solo --get e --dump in lettura. Osservazioni fuori scope, non conteggiate come fail: --help non elenca ID_COLLISION fra i codici (gia' tracciato in adccd454), e la validazione del nome non copre il percorso --get (dettaglio in C1)."
  tasks:
    -
      id: 1
      short_title: Verificare il formato dei nomi
      full_description: Controllare i nomi nel tracker vivo e i rifiuti su un file fuori formato e su uno il cui prefisso non combacia con lo status del frontmatter.
      checked: true
    -
      id: 2
      short_title: Verificare la transizione di stato
      full_description: "Su copia temporanea: un cambio di stato rinomina il file e non ne lascia due; due file per lo stesso id fanno fallire la lettura con ID_COLLISION che li nomina entrambi."
      checked: true
    -
      id: 3
      short_title: Verificare i contratti invariati
      full_description: CRUD, --dump, --compact, --upgrade, envelope e codici d errore rispondono come prima della rinomina.
      checked: true
    -
      id: 4
      short_title: Verificare tracker vivo e documenti
      full_description: Confrontare il tracker con lo stato precedente alla rinomina e cercare i documenti che promettono ancora il nome col solo id.
      checked: true
  state: pass
created_at: "2026-08-18T08:54:39Z"
updated_at: "2026-08-18T09:20:34Z"
---

# Lo stato della issue nel nome del file

I file del tracker si chiamano col solo id accorciato, quindi una directory di 25 issue non dice niente a colpo d'occhio: ne' in che stato sono, ne' quante per stato. Il nome diventa <stato>-<primi 8 caratteri dell id>.md, cosi l'ordine alfabetico raggruppa per stato (raggruppa, non ordina: alfabetico non e l'ordine del workflow, e prefissi numerici codificherebbero nel nome una gerarchia che nessuno ha deciso). Il costo e che issuePath smette di essere una funzione pura dell id: chi legge o cancella cerca il file, chi scrive lo calcola da id e stato e cancella il vecchio dopo aver scritto il nuovo. Si fa ora e senza codice di migrazione perche lo schema 4 non e mai stato pubblicato: nessun consumer ha dati in questo formato, i 25 file locali si rinominano e basta. Farlo dopo il rilascio costerebbe uno schema 5 e un ramo di --upgrade da mantenere per sempre.
