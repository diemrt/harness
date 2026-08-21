---
id: 3f964bf4-0c25-4fb1-99d7-1092ccb0138f
title: Revisioni atomiche e compare-and-set delle issue
status: in_progress
tier: reasoning
depends_on: []
covers: []
tasks:
  -
    id: 1
    short_title: Definire e approvare il contratto CAS
    full_description: Svolgere il brainstorming obbligatorio; fissare in una spec approvata revisione, mutazioni protette, input/output, errore stantio, migrazione e compatibilità; committare la spec prima dell'implementazione.
    checked: true
  -
    id: 2
    short_title: Evolvere schema, codec e migrazione
    full_description: Implementare la revisione monotona nello schema e nello storage Markdown, inclusi insert, lettura, round-trip e upgrade deterministico e idempotente dei tracker precedenti secondo la spec.
    checked: false
  -
    id: 3
    short_title: Proteggere le mutazioni con CAS
    full_description: Applicare la revisione attesa alle mutazioni individuate dalla spec; rifiutare gli stati stantii senza scritture e incrementare una sola volta ogni mutazione riuscita, aggiornando le superfici chiamanti necessarie.
    checked: false
  -
    id: 4
    short_title: Provare concorrenza e preparare 1.1.0
    full_description: Aggiungere prove di successo, rifiuto stantio, corse fra checklist, compatibilità e regressione; allineare documentazione e tre manifest alla 1.1.0 ed eseguire il gate completo.
    checked: false
validation:
  criteria:
    - "Una spec approvata, nata da superpowers:brainstorming e committata prima dell'implementazione, definisce revisioni, mutazioni protette, migrazione, compatibilità e codici d'errore."
    - Ogni issue nuova o migrata possiede una revisione monotona; un update con revisione attesa superata fallisce con un errore distinto e lascia ogni file byte per byte invariato.
    - Ogni mutazione riuscita incrementa la revisione una volta e restituisce il nuovo valore; test concorrenti provano che una checklist stantia non annulla un update recente.
    - Upgrade e lettura dei tracker precedenti sono deterministici e idempotenti secondo la spec, senza modifiche manuali ai file delle issue.
    - I tre manifest del plugin dichiarano tutti la versione 1.1.0 e la suite completa configurata in .harness/config.json esce 0.
  tasks:
    -
      id: 1
      short_title: Verificare la spec e il suo ordine
      full_description: Controllare che il brainstorming e la spec approvata precedano i commit di implementazione e coprano tutte le decisioni richieste.
      checked: false
    -
      id: 2
      short_title: Provare il compare-and-set
      full_description: Eseguire casi riusciti e stantii, compresa una corsa fra checklist, verificando revisione e assenza di scritture sul rifiuto.
      checked: false
    -
      id: 3
      short_title: Provare upgrade e compatibilità
      full_description: Esercitare tracker precedenti, upgrade ripetuto e round-trip dello storage secondo la spec.
      checked: false
    -
      id: 4
      short_title: Verificare versione e suite
      full_description: Controllare versione 1.1.0 nei tre manifest ed eseguire il gate completo del progetto.
      checked: false
  state: unknown
created_at: "2026-08-20T15:51:52Z"
updated_at: "2026-08-21T07:07:11Z"
---

# Revisioni atomiche e compare-and-set delle issue

Introdurre revisioni monotone e aggiornamenti compare-and-set per impedire che due agenti sovrascrivano in silenzio task, validazione o prosa letti da stati diversi. Prima fase obbligatoria: invocare superpowers:brainstorming, produrre una spec approvata e definire quali mutazioni richiedono la revisione attesa, la migrazione e la compatibilità. Solo dopo si implementa. Target di rilascio: 1.1.0; il completamento porta tutti e tre i manifest del plugin dalla 1.0.0 alla 1.1.0.
