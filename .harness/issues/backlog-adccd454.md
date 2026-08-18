---
id: adccd454-a30a-498e-adad-f076b5137203
title: Residui del travaso a storage Markdown in issue-manager
status: backlog
tier: economy
depends_on: []
covers: []
tasks: []
validation:
  criteria:
    - writeIssuesFile e ogni altra funzione rimasta senza chiamanti dopo il travaso non esistono piu', e la suite resta verde.
    - Il testo di --help elenca ID_COLLISION insieme agli altri codici, e l elenco combacia con quello della reference.
    - Il payload di --upgrade e' lo stesso su ogni percorso, oppure la documentazione dichiara esplicitamente quali campi mancano sul no-op.
    - Nessun commento di issue-manager.mjs o tracker-graph.mjs descrive issues.json come il tracker vivo del progetto.
  tasks:
    -
      id: 1
      short_title: Verificare la rimozione del codice morto
      full_description: Cercare chiamanti delle funzioni rimosse e controllare che la suite completa resti verde.
      checked: false
    -
      id: 2
      short_title: Verificare help e payload
      full_description: Confrontare i codici elencati da --help con quelli della reference, e il payload di --upgrade sui due percorsi con cio' che i documenti dichiarano.
      checked: false
    -
      id: 3
      short_title: Verificare i commenti
      full_description: Rileggere i commenti dei due script cercando descrizioni di issues.json come tracker vivo.
      checked: false
  state: unknown
created_at: "2026-08-18T08:55:05Z"
updated_at: "2026-08-18T08:55:05Z"
---

# Residui del travaso a storage Markdown in issue-manager

Il tratto che ha portato il tracker su file Markdown ha lasciato dietro di se' quattro cose che il verificatore ha trovato e parcheggiato come fuori scope. writeIssuesFile() e' codice morto: definita, mai chiamata da quando --upgrade ha smesso di riscrivere issues.json. Il testo di --help elenca i codici d errore ma non ID_COLLISION, che il ramo ha introdotto e che la reference documenta. Il percorso idempotente di --upgrade restituisce solo { from, to, migrated } mentre la documentazione dichiara la sestupla senza distinguere quel caso, quindi chi legge archivePath su un no-op ottiene undefined. E una quindicina di commenti in issue-manager.mjs e tracker-graph.mjs descrivono ancora issues.json come il tracker vivo invece che come formato legacy: sono le istruzioni che il prossimo agente legge prima di toccare quel file.
