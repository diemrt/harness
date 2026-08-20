---
id: 95d624c2-d18a-4cd6-b7c1-3f7043bf04a7
title: Provider multipli configurabili e distribuzione multi-host
status: backlog
tier: reasoning
depends_on: [d538c58a-af3f-49ae-9839-240de13c0f9e]
covers: []
tasks: []
validation:
  criteria:
    - "Una spec architetturale approvata, nata da superpowers:brainstorming e committata prima del codice, definisce nucleo portabile, adapter, configurazione e migrazione."
    - Una matrice basata su fonti primarie copre Claude Code, Codex e GitHub Copilot, separando CLI e desktop/IDE e marcando esplicitamente superfici non estensibili.
    - La configurazione ammette almeno due provider nominati coesistenti e una selezione esplicita; ogni adapter soddisfa il contratto di capacità della issue precedente.
    - Installazione, aggiornamento, reload, permessi e passaggio del contesto sono documentati e provati per ogni superficie dichiarata supportata, senza duplicare le skill autoritative.
    - La migrazione dal singolo externalWorker e la compatibilità dei progetti esistenti seguono la spec; test strutturali impediscono manifest o adapter nominali ma incompleti.
    - I tre manifest del plugin dichiarano tutti la versione 1.4.0 e la suite completa configurata in .harness/config.json esce 0.
  tasks:
    -
      id: 1
      short_title: Verificare matrice e spec
      full_description: Controllare fonti primarie, limiti degli host, approvazione e ordine della spec rispetto al codice.
      checked: false
    -
      id: 2
      short_title: Provare provider e selezione
      full_description: Configurare almeno due provider coesistenti, selezionarli ed esercitare il contratto di capacità senza degradazione.
      checked: false
    -
      id: 3
      short_title: Provare packaging e migrazione
      full_description: Verificare installazione, aggiornamento, reload, permessi, contesto e migrazione sulle superfici dichiarate.
      checked: false
    -
      id: 4
      short_title: Verificare guard, versione e suite
      full_description: Controllare test strutturali, versione 1.4.0 nei tre manifest e gate completo del progetto.
      checked: false
  state: unknown
created_at: "2026-08-20T15:53:31Z"
updated_at: "2026-08-20T15:58:12Z"
---

# Provider multipli configurabili e distribuzione multi-host

Evolvere harness in un plugin portabile con più provider di esecuzione nominati e selezionabili, accessibile dai principali host agentici. Prima fase obbligatoria: superpowers:brainstorming architetturale, matrice verificata di Claude Code, Codex e GitHub Copilot sulle superfici CLI e desktop/IDE, quindi spec approvata su nucleo, adapter, configurazione, installazione, aggiornamento, permessi e migrazione dal singolo externalWorker. L'implementazione non deve promettere superfici che l'host non espone. Target di rilascio: 1.4.0; i tre manifest passano dalla 1.3.0 alla 1.4.0.
