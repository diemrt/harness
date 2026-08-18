---
id: adccd454-a30a-498e-adad-f076b5137203
title: Residui e buchi di presidio dopo il travaso a storage Markdown
status: in_review
tier: economy
depends_on: []
covers: [6769512f0a0053d7cf93cf970ab9b259fed05ce8]
tasks:
  -
    id: 1
    short_title: Test dell ordine di scrittura
    full_description: "Test fallente prima: la rinomina di stato deve avere il file nuovo sul disco quando il vecchio viene rimosso, osservato e non dedotto."
    checked: true
  -
    id: 2
    short_title: Validare il nome anche in lettura singola
    full_description: "Test e implementazione: findIssueFile rifiuta un nome fuori formato o il cui prefisso contraddice lo status del frontmatter, come gia' fa readAllIssues."
    checked: true
  -
    id: 3
    short_title: Togliere il codice morto
    full_description: Rimuovere writeIssuesFile e ogni altra funzione rimasta senza chiamanti dopo il travaso.
    checked: true
  -
    id: 4
    short_title: Allineare help e payload di upgrade
    full_description: Elencare ID_COLLISION fra i codici di --help; rendere il payload di --upgrade uguale sui due percorsi oppure dichiarare nei documenti quali campi mancano sul no-op.
    checked: true
  -
    id: 5
    short_title: Correggere i commenti
    full_description: I commenti di issue-manager.mjs e tracker-graph.mjs che descrivono issues.json come il tracker vivo invece che come formato legacy.
    checked: true
  -
    id: 6
    short_title: Verificare e affidare review
    full_description: Suite completa, gate documentale, allineamento dei task e passaggio in review.
    checked: true
validation:
  criteria:
    - writeIssuesFile e ogni altra funzione rimasta senza chiamanti dopo il travaso non esistono piu', e la suite resta verde.
    - Il testo di --help elenca ID_COLLISION insieme agli altri codici, e l elenco combacia con quello della reference.
    - Il payload di --upgrade e' lo stesso su ogni percorso, oppure la documentazione dichiara esplicitamente quali campi mancano sul no-op.
    - Nessun commento di issue-manager.mjs o tracker-graph.mjs descrive issues.json come il tracker vivo del progetto.
    - Una lettura singola rifiuta un nome di file fuori formato o il cui prefisso contraddice lo status del frontmatter, come gia' fa la lettura di tutto il tracker.
    - "Un test osserva l ordine della rinomina, non solo il suo esito: il file nuovo e' sul disco quando il vecchio viene rimosso, e il test fallisce se l ordine si inverte."
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
    -
      id: 4
      short_title: Verificare i due presidi nuovi
      full_description: Provare la lettura singola su un nome fuori formato e su uno che contraddice il frontmatter, e controllare che il test dell ordine fallisca invertendo scrittura e cancellazione.
      checked: false
  state: unknown
created_at: "2026-08-18T08:55:05Z"
updated_at: "2026-08-18T09:28:58Z"
---

# Residui e buchi di presidio dopo il travaso a storage Markdown

Il tratto che ha portato il tracker su file Markdown ha lasciato dietro di se' sei cose, tutte trovate dai verificatori e parcheggiate come fuori scope. writeIssuesFile e' codice morto da quando --upgrade ha smesso di riscrivere issues.json. --help elenca i codici d errore ma non ID_COLLISION. Il percorso idempotente di --upgrade restituisce { from, to, migrated } mentre i documenti dichiarano la sestupla, quindi chi legge archivePath su un no-op ottiene undefined. Una quindicina di commenti descrivono ancora issues.json come il tracker vivo. La validazione del nome di file vive solo in readAllIssues, quindi --get accetta un prefisso fuori dai cinque stati o che contraddice il frontmatter. E nessun test difende l ordine scrivi-poi-cancella della rinomina: la suite copre lo stato finale, non l invariante intermedia che rende quel disegno sicuro.
