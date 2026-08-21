---
id: 1ed3a712-1a42-4d18-9513-1e71b5db4039
title: "Impacchettamento: da pacchetto npm a plugin Claude Code"
status: done
tier: null
depends_on: []
covers: []
tasks: []
validation:
  tasks: []
  criteria:
    - "Archived originals: .harness/archive/2026-08-12T14-32-54Z.json"
    - a4fdd64f-b648-4ed9-b4c9-4d27b68b2675 - Migrazione da pacchetto npm a plugin Claude Code
    - 3a030d2b-e1d4-45e1-9075-6b9e55568b20 - Il modello npm non lascia trappole ne' un secondo numero di versione
    - "63406cce-2d07-4863-9329-0abe5bb10cf5 - .harness/ non si auto-ignora piu': cosa versionare lo decide il progetto"
    - d269c9ff-461f-477b-a1f6-4c7e5e11a020 - Worker esterno e configurazione locale
  state: pass
created_at: "2026-08-12T14:32:54Z"
updated_at: "2026-08-12T14:32:54Z"
revision: 1
---

# Impacchettamento: da pacchetto npm a plugin Claude Code

Il passaggio di harness da pacchetto npm installato nel progetto a plugin di Claude Code, che ha tolto di mezzo il template da rigenerare e la copia materializzata da tenere in sincrono. Le trappole del modello precedente e il secondo numero di versione che non esiste piu'. La decisione di non scrivere nessun .gitignore: cosa versionare di .harness/ lo decide il progetto. Piu' la configurazione locale e la delega opt-in a un worker esterno.
