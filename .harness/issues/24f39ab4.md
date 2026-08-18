---
id: 24f39ab4-6401-434c-a780-506d13c498d8
title: Il plugin pubblicato e il repository sono divergenti
status: done
tier: reasoning
depends_on: []
covers: [2781812dd2c4fffcc0152bd8161e46f1aeb07b49, b893262e4cc2c6b38541ab2f112f8845dd32026e, a53ba2ca1473228873f84f49a2c3c2c8ade57e06]
tasks:
  -
    id: 1
    short_title: Inventario della copia pubblicata
    full_description: "Elencare i file della copia in .claude/plugins/cache/diemrt/harness/0.6.0/ e confrontarli con il repository: cosa c'e' in piu', cosa manca, quale versione dichiara il manifest interno."
    checked: true
  -
    id: 2
    short_title: "Da dove viene la copia: registro di installazione"
    full_description: "Leggere installed_plugins.json e known_marketplaces.json: sorgente del marketplace, sha del commit installato, data di installazione e di ultimo aggiornamento. Confrontare con lo stesso dato sugli altri plugin installati, che invece si aggiornano."
    checked: true
  -
    id: 3
    short_title: "Riproduzione: quale tracker legge la copia pubblicata"
    full_description: Eseguire in sola lettura la copia pubblicata e quella del repository dalla stessa cartella di un progetto consumer, e mostrare che rispondono su due tracker diversi. E' la prova che si puo' rieseguire invece di doverla credere.
    checked: true
  -
    id: 4
    short_title: "Il caso reale: activitymanager"
    full_description: "Analizzare il progetto C:/Users/diego_martignoni/Documents/Workspace/Projects/activitymanager: schema del suo issues.json, campi presenti, e quale copia degli script puo' averli scritti. Stabilire con una prova, non per esclusione, se abbia mai eseguito la copia pubblicata."
    checked: true
  -
    id: 5
    short_title: La causa, distinta dal sintomo
    full_description: "Nominare il meccanismo che tiene ferma la copia: sorgente del marketplace, chiave di cache, versione mai incrementata. Distinguere cosa e' causa e cosa e' conseguenza, e dire cosa resta non dimostrato."
    checked: true
  -
    id: 6
    short_title: Il documento in docs/
    full_description: "Scrivere il referto: prove, comandi rieseguibili, causa, danno osservato sul caso reale, e cosa deve fare chi ha gia' una copia divergente installata."
    checked: true
  -
    id: 7
    short_title: La guardia contro il ripetersi
    full_description: Un controllo eseguibile che confronta la copia installata con il repository e fallisce quando divergono, piu' il passo scritto dove chi rilascia lo legge (CONTRIBUTING.md). Non un documento che nessuno riapre.
    checked: true
  -
    id: 8
    short_title: Il rimedio, e la sua verifica
    full_description: "Richiede un'azione umana che l'agente non puo' eseguire: /plugin marketplace remove diemrt, /plugin marketplace add diemrt/harness, /plugin install harness@diemrt, poi riavvio della sessione. Verifica: node scripts/install-check.mjs deve uscire 0 con state aligned. Nello stesso momento si misura da quale path la skill viene annunciata, che decide se lo sviluppo locale sopravvive alla sorgente remota."
    checked: true
  -
    id: 9
    short_title: Suite verde
    full_description: npm test verde, compresi i test nuovi della guardia.
    checked: true
validation:
  criteria: "VERIFICA INDIPENDENTE 2026-08-14 (ramo fix/plugin-pubblicato-divergente, commit a53ba2c).\n\n1) Causa nominata con prove -- OK. docs/superpowers/analisi/2026-08-13-plugin-pubblicato-divergente.md:82-98 e 284-303: il marketplace era registrato source=directory sul working tree (nessun ref pubblicato), sha registrato 2d18eff a -159 commit, e la copia in cache non era un checkout ma la cartella sporca (righe 100-131). Distingue causa (sorgente directory, nessun ciclo di aggiornamento) da cio' che non lo e' (versione ferma, ref, errore di rilascio).\n\n2) Comandi rieseguibili -- OK. Ne ho rieseguiti alcuni: `node -e` su known_marketplaces.json/installed_plugins.json e `comm` fra `git ls-tree -r --name-only 5bd6da2` e il find della cache. Tutti di sola lettura, esiti coerenti col referto.\n\n3) Guardia contro il ripetersi -- OK. scripts/install-check.mjs (309 righe, eseguibile, codici LOCAL_SOURCE/DIVERGENT_INSTALL/...), richiamato in CONTRIBUTING.md sezione Releasing (`Check what is actually installed`, `node scripts/install-check.mjs`) e documentato in skills/harness/references/install-check.md, linkato da SKILL.md.\n\n4) La copia installata porta gli stessi componenti del repository -- OK. `ls ~/.claude/plugins/cache/diemrt/harness/0.6.0`: presenti skills/harness/{SKILL.md,references}, commands/ (7), agents/harness-verifier.md, scripts/ (8); assenti hooks/, src/, template/, init.mjs, issues.html, .harness-manifest.json. Il marketplace e' ora source=github repo=diemrt/harness, gitCommitSha=5bd6da2, e il confronto `comm` fra l'albero tracciato a 5bd6da2 e i file della cache da 0 file mancanti e 0 file estranei (solo il marker runtime .in_use/16468). `node scripts/install-check.mjs` esce 1 con DIVERGENT_INSTALL e missing=[scripts/install-check.mjs, skills/harness/references/install-check.md]: sono i due file di questo ramo non ancora su main, comportamento atteso e documentato in references/install-check.md:56-60. Il criterio parla dei componenti portati, non dell'allineamento con un ramo non pubblicato.\n\n5) Chi ha gia' la copia divergente -- OK. Referto righe 360-392: rilevamento (`ls ~/.claude/plugins/cache/*/harness/*/skills/` -> .gitkeep = divergente), rimedio ordinato (niente rm a mano, uninstall/marketplace add/install, riavvio sessione) e verifica finale.\n\n6) npm test verde -- OK. `npm run test` (verify di .harness/config.json): tests 423, pass 423, fail 0, exit 0. `node --test test/plugin-install-check.test.mjs`: 15/15 pass.\n\nDanni collaterali: `git status --short` mostra solo ` M issues.json` (transizione in_progress->in_review, covers a53ba2ca, task 8 spuntato). Nessun file fuori scope, nessun segreto nel diff dei tre commit.\n\nOsservazioni fuori scope (non bloccanti): il referto ha un bullet orfano fra le righe 328-331 senza riga vuota prima dell'intestazione seguente; la copia pubblicata include issues.json di harness (file tracciato del repo, quindi coerente col criterio, ma finisce nel pacchetto dei consumer)."
  tasks:
    -
      id: 1
      short_title: Indagine sulla causa, non sul sintomo
      full_description: "Capire da dove viene la copia pubblicata: marketplace.json, il ref che dichiara, la storia dei rilasci. Condotta con le skill superpowers come chiesto dal committente, non a intuito."
      checked: true
    -
      id: 2
      short_title: Le prove sono riproducibili
      full_description: Il documento porta i comandi che chiunque puo' rieseguire per vedere la divergenza con i propri occhi.
      checked: true
    -
      id: 3
      short_title: Una guardia contro il ripetersi
      full_description: Un controllo eseguibile o un passo di rilascio, scritto dove chi rilascia lo legge - non in un documento che nessuno riapre.
      checked: true
    -
      id: 4
      short_title: La copia pubblicata torna allineata
      full_description: Dopo il rimedio, un'installazione pulita porta gli stessi componenti del repository.
      checked: true
    -
      id: 5
      short_title: Chi ha gia' la copia sbagliata
      full_description: "Scritto cosa deve fare: da solo non se ne accorge, perche' la copia divergente funziona."
      checked: true
    -
      id: 6
      short_title: Suite verde
      full_description: npm test verde.
      checked: true
  state: pass
created_at: "2026-08-13T13:39:00Z"
updated_at: "2026-08-14T07:54:55Z"
---

# Il plugin pubblicato e il repository sono divergenti

La copia installata in .claude/plugins/cache/diemrt/harness/0.6.0/ contiene hooks/, src/, template/, init.mjs, issues.html e .harness-manifest.json: componenti che questo repository non ha piu'. Dichiara la stessa versione del repository, 0.6.0, e ha un contenuto diverso.

Chi usa harness in un altro progetto sta quindi eseguendo un issue-manager.mjs diverso da quello che qui viene corretto e verificato. E' costoso e invisibile nella forma peggiore: non fallisce, funziona - solo su un'altra versione del codice, contro un issues.json scritto secondo uno schema che quella copia potrebbe non conoscere. Nessun test lo vede, perche' la suite gira sul repository e non sulla copia pubblicata.

Va indagato prima che corretto: non e' noto se la causa sia il ref che la marketplace pubblica, una versione mai incrementata, o un rilascio fatto da uno stato di lavoro diverso. Il committente chiede un'indagine condotta con le skill superpowers, non una toppa.
