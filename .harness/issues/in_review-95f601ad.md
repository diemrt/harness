---
id: 95f601ad-eb21-427c-86e8-402bcec7e663
title: Lo stato della issue nel nome del file
status: in_review
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
    - Ogni file del tracker si chiama <stato>-<primi 8 caratteri dell id>.md, e la lettura rifiuta un nome fuori formato o con un prefisso che non combacia con lo status del frontmatter.
    - Un cambio di stato scrive il file nuovo prima di cancellare il vecchio, e i due file per lo stesso id che un crash lascerebbe fanno fallire la lettura con ID_COLLISION nominandoli entrambi.
    - Letture, scritture e cancellazioni trovano la issue dal solo id senza che il chiamante conosca lo stato; contratto della CLI, envelope, codici d errore e payload di --dump restano identici.
    - I 25 file del tracker vivo sono rinominati e il tracker resta semanticamente identico al precedente; nessun codice di migrazione viene aggiunto ne alcuno schema viene incrementato.
    - README, references/issues.md e skills/issue/SKILL.md descrivono il nome nuovo, e nessun documento promette ancora un file chiamato col solo id.
  tasks:
    -
      id: 1
      short_title: Verificare il formato dei nomi
      full_description: Controllare i nomi nel tracker vivo e i rifiuti su un file fuori formato e su uno il cui prefisso non combacia con lo status del frontmatter.
      checked: false
    -
      id: 2
      short_title: Verificare la transizione di stato
      full_description: "Su copia temporanea: un cambio di stato rinomina il file e non ne lascia due; due file per lo stesso id fanno fallire la lettura con ID_COLLISION che li nomina entrambi."
      checked: false
    -
      id: 3
      short_title: Verificare i contratti invariati
      full_description: CRUD, --dump, --compact, --upgrade, envelope e codici d errore rispondono come prima della rinomina.
      checked: false
    -
      id: 4
      short_title: Verificare tracker vivo e documenti
      full_description: Confrontare il tracker con lo stato precedente alla rinomina e cercare i documenti che promettono ancora il nome col solo id.
      checked: false
  state: unknown
created_at: "2026-08-18T08:54:39Z"
updated_at: "2026-08-18T09:05:26Z"
---

# Lo stato della issue nel nome del file

I file del tracker si chiamano col solo id accorciato, quindi una directory di 25 issue non dice niente a colpo d'occhio: ne' in che stato sono, ne' quante per stato. Il nome diventa <stato>-<primi 8 caratteri dell id>.md, cosi l'ordine alfabetico raggruppa per stato (raggruppa, non ordina: alfabetico non e l'ordine del workflow, e prefissi numerici codificherebbero nel nome una gerarchia che nessuno ha deciso). Il costo e che issuePath smette di essere una funzione pura dell id: chi legge o cancella cerca il file, chi scrive lo calcola da id e stato e cancella il vecchio dopo aver scritto il nuovo. Si fa ora e senza codice di migrazione perche lo schema 4 non e mai stato pubblicato: nessun consumer ha dati in questo formato, i 25 file locali si rinominano e basta. Farlo dopo il rilascio costerebbe uno schema 5 e un ramo di --upgrade da mantenere per sempre.
