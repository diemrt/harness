---
id: d538c58a-af3f-49ae-9839-240de13c0f9e
title: Contratto delle capacità e preflight prima del dispatch
status: backlog
tier: reasoning
depends_on: [68f16545-a309-43ff-ac1b-59898b075939]
covers: []
tasks: []
validation:
  criteria:
    - "Una spec approvata, nata da superpowers:brainstorming e committata prima dell'implementazione, definisce capacità, route e primo punto verificabile per ogni classe."
    - Worker e verificatori dichiarano requisiti e capacità con termini indipendenti dai nomi dei tool dell'host; una capacità richiesta non può essere accettata e ignorata.
    - Una incompatibilità produce un errore distinto prima del dispatch o al primo punto tecnicamente verificabile e non modifica tracker o workspace.
    - Il preflight copre subagent interni, CLI esterne e verificatori; externalWorker --check è preservato o assorbito con test che ne mantengono il contratto.
    - I tre manifest del plugin dichiarano tutti la versione 1.3.0 e la suite completa configurata in .harness/config.json esce 0.
  tasks:
    -
      id: 1
      short_title: Verificare spec e vocabolario
      full_description: Controllare che la spec approvata preceda il codice e definisca capacità e punti di enforcement portabili.
      checked: false
    -
      id: 2
      short_title: Provare il fallimento chiuso
      full_description: Richiedere capacità mancanti e verificare errore distinto, assenza di degradazione e nessuna mutazione.
      checked: false
    -
      id: 3
      short_title: Provare tutte le classi di route
      full_description: Esercitare subagent interno, CLI esterna e verificatore, incluso il contratto esistente di externalWorker --check.
      checked: false
    -
      id: 4
      short_title: Verificare versione e suite
      full_description: Controllare versione 1.3.0 nei tre manifest ed eseguire il gate completo del progetto.
      checked: false
  state: unknown
created_at: "2026-08-20T15:52:56Z"
updated_at: "2026-08-20T15:52:56Z"
---

# Contratto delle capacità e preflight prima del dispatch

Definire un contratto portabile delle capacità richieste e offerte da worker e verificatori, così una rotta incompatibile fallisce al primo punto verificabile senza degradare in silenzio né muovere il tracker. Prima fase obbligatoria: invocare superpowers:brainstorming e approvare una spec sul vocabolario host-neutral, sui punti di preflight e sul rapporto con externalWorker --check. La dipendenza dalla 1.2.0 mantiene lineare la sequenza dei rilasci. Target: 1.3.0; i tre manifest passano dalla 1.2.0 alla 1.3.0.
