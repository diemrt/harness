---
id: 9aedbb76-51cb-469f-b793-7bb05bf7998c
title: Comando archive per pulire le issue done
status: backlog
tier: standard
depends_on: [95d624c2-d18a-4cd6-b7c1-3f7043bf04a7]
covers: []
tasks: []
validation:
  criteria:
    - "Una spec approvata, nata da superpowers:brainstorming e committata prima del codice, definisce selezione, conferma, dipendenze, archivio e rapporto con compact."
    - L'operazione archive è esposta come skill portabile e archivia solo issue done confermate, rimuovendole dal tracker attivo senza creare issue blocco sostitutive.
    - Gli oggetti originali sono conservati integralmente in un archivio autodescrittivo; un errore non lascia issue perse né un tracker parzialmente mutato.
    - Issue non done, id mancanti e dipendenze vive verso issue selezionate sono rifiutati prima di ogni scrittura con errori distinti e coperti da test.
    - Status e query leggono solo il tracker attivo; output e documentazione rendono rintracciabile l'archivio senza trasformarlo in un secondo tracker.
    - I tre manifest del plugin dichiarano tutti la versione 1.4.1 e la suite completa configurata in .harness/config.json esce 0.
  tasks:
    -
      id: 1
      short_title: Verificare spec e confine con compact
      full_description: Controllare approvazione, ordine della spec e decisioni su selezione, conferma, archivio, dipendenze e discovery.
      checked: false
    -
      id: 2
      short_title: Provare archivio e pulizia
      full_description: Archiviare issue done e verificare rimozione dal tracker attivo, conservazione integrale e assenza di blocchi sostitutivi.
      checked: false
    -
      id: 3
      short_title: Provare rifiuti e atomicità
      full_description: Esercitare stati non done, id mancanti, dipendenze vive ed errori durante la scrittura verificando che nulla vada perso.
      checked: false
    -
      id: 4
      short_title: Verificare superfici, versione e gate
      full_description: Controllare skill, indice portabile, reference, versione 1.4.1 nei tre manifest e suite completa.
      checked: false
  state: unknown
created_at: "2026-08-20T15:55:00Z"
updated_at: "2026-08-20T15:58:12Z"
---

# Comando archive per pulire le issue done

Aggiungere un'operazione archive, distinta da compact, che rimuove dal tracker attivo le issue done selezionate conservandone gli originali in .harness/archive, così il riepilogo resta piccolo senza creare blocchi sostitutivi. Priorità operativa bassa: questa issue è in coda alla catena dei rilasci. Prima fase obbligatoria: invocare superpowers:brainstorming e approvare una spec su selezione, conferma, dipendenze vive, formato dell'archivio, discovery e rapporto con compact. Target: 1.4.1; i tre manifest passano dalla 1.4.0 alla 1.4.1.
