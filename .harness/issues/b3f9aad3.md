---
id: b3f9aad3-153e-44b8-bb96-1da6147ec3b0
title: Core storage Markdown e migrazione schema 4
status: in_review
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
  criteria:
    - Il codec conserva l intero oggetto issue, incluse stringhe escaped, array vuoti, validation null e description nel solo corpo Markdown.
    - issue-manager resta l unico importer del nuovo store e CRUD, guard, envelope JSON e --dump rispettano il contratto definito.
    - Un tracker JSON schema 3 migra a file per issue, recupera da upgrade interrotto, rifiuta conflitti e resta byte-idempotente dopo il successo.
    - La compattazione conserva l archivio JSON e muta solo i file coinvolti; config valida e conserva schema_version 4 e i nuovi exclude.
    - status-cli e docs-gate consumano --dump senza leggere Markdown direttamente e preservano i rispettivi contratti di errore.
    - Il tracker live conserva semanticamente tutte le issue del baseline, non lascia issues.json e resta leggibile da dump, status e get-all.
  tasks:
    -
      checked: false
      id: 1
      short_title: Verificare codec e store
      full_description: Eseguire i test del codec, dei file per issue e delle operazioni atomiche.
    -
      checked: false
      id: 2
      short_title: Verificare manager e migrazione
      full_description: Provare CRUD, dump, upgrade, conflitto, idempotenza e compact su progetti temporanei.
    -
      checked: false
      id: 3
      short_title: Verificare config
      full_description: Controllare schema_version e default docs gate nella configurazione.
    -
      checked: false
      id: 4
      short_title: Verificare consumer dump
      full_description: Provare status completo, oneline e docs gate sui casi di storage previsti.
    -
      checked: false
      id: 5
      short_title: Verificare tracker live
      full_description: Confrontare baseline e tracker migrato, quindi provare idempotenza e letture reali.
  state: unknown
created_at: "2026-08-17T12:49:45Z"
updated_at: "2026-08-18T08:02:39Z"
---

# Core storage Markdown e migrazione schema 4

Sostituire il tracker JSON con file Markdown per issue: codec frontmatter ristretto, issue-store, issue-manager, CRUD, --dump, upgrade 3→4, compact, config, consumer e migrazione live. Correzione di scope approvata dal committente il 2026-08-17: consumer e migrazione restano nella stessa issue perche il repository deve poter aggiornare e mostrare il proprio tracker durante il passaggio.
