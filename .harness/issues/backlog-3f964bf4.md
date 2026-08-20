---
id: 3f964bf4-0c25-4fb1-99d7-1092ccb0138f
title: Revisioni atomiche e compare-and-set delle issue
status: backlog
tier: reasoning
depends_on: []
covers: []
tasks: []
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
updated_at: "2026-08-20T15:51:52Z"
---

# Revisioni atomiche e compare-and-set delle issue

Introdurre revisioni monotone e aggiornamenti compare-and-set per impedire che due agenti sovrascrivano in silenzio task, validazione o prosa letti da stati diversi. Prima fase obbligatoria: invocare superpowers:brainstorming, produrre una spec approvata e definire quali mutazioni richiedono la revisione attesa, la migrazione e la compatibilità. Solo dopo si implementa. Target di rilascio: 1.1.0; il completamento porta tutti e tre i manifest del plugin dalla 1.0.0 alla 1.1.0.
