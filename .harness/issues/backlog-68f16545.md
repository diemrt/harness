---
id: 68f16545-a309-43ff-ac1b-59898b075939
title: Criteri immutabili e storico dei tentativi di verifica
status: backlog
tier: reasoning
depends_on: [3f964bf4-0c25-4fb1-99d7-1092ccb0138f]
covers: []
tasks: []
validation:
  criteria:
    - "Una spec approvata, nata da superpowers:brainstorming e committata prima dell'implementazione, definisce schema, retry, migrazione legacy e limiti dello storico."
    - validation.criteria resta invariato attraverso pass, fail, blocco e retry; i test confrontano il contratto prima e dopo ogni transizione.
    - Ogni tentativo conserva in ordine esito, evidenza, comando e revisioni giudicate; aggiungerne uno non cancella né riscrive i precedenti.
    - I record legacy sono migrati senza inventare criteri perduti, e verifica normale, verifica leggera, verifier agent, compact e reference usano il nuovo contratto.
    - I tre manifest del plugin dichiarano tutti la versione 1.2.0 e la suite completa configurata in .harness/config.json esce 0.
  tasks:
    -
      id: 1
      short_title: Verificare spec e migrazione
      full_description: Controllare che la spec approvata preceda il codice e risolva schema, retry, legacy, crescita e compattazione.
      checked: false
    -
      id: 2
      short_title: Provare l'immutabilità dei criteri
      full_description: Eseguire pass, fail, blocco e retry verificando che il contratto originario non cambi.
      checked: false
    -
      id: 3
      short_title: Provare lo storico dei tentativi
      full_description: Verificare ordine, append, evidenza, comandi, revisioni e conservazione dei tentativi precedenti.
      checked: false
    -
      id: 4
      short_title: Verificare superfici, versione e gate
      full_description: Controllare verifier, verifica leggera, compact, documenti, versione 1.2.0 nei tre manifest e suite completa.
      checked: false
  state: unknown
created_at: "2026-08-20T15:52:25Z"
updated_at: "2026-08-20T15:52:25Z"
revision: 1
---

# Criteri immutabili e storico dei tentativi di verifica

Separare definitivamente il contratto di accettazione dall'evidenza: validation.criteria resta immutabile, mentre pass, fail, comandi, revisioni giudicate e retry formano uno storico distinto e leggibile. Prima fase obbligatoria: invocare superpowers:brainstorming e far approvare una spec su schema, migrazione dei record chiusi, limiti di crescita e rapporto con compact. Dipende dalle revisioni atomiche. Target di rilascio: 1.2.0; il completamento porta i tre manifest dalla 1.1.0 alla 1.2.0.
