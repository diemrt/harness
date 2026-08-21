---
id: f690fbf2-3c6b-4aed-b47e-f2b1b3e8cbb8
title: "I comandi diventano skill: una definizione sola per operazione"
status: done
tier: reasoning
depends_on: []
covers: []
tasks:
  -
    id: 1
    short_title: Portare i sei command dentro le skill
    full_description: "Per ognuna di status, issue, verify, compact, docs-gate, sweep: riscrivere skills/<op>/SKILL.md col frontmatter completo (name, description con il caso senza argomenti, argument-hint, allowed-tools) e col corpo del command corrispondente. Aggiungere in ogni skill la nota su come si risolve la radice del plugin dove CLAUDE_PLUGIN_ROOT non viene sostituita, riusando la regola di skills/harness/SKILL.md. I rimandi incrociati fra comandi vanno riscritti come nomi di operazione, non come slash command di un host solo."
    checked: true
  -
    id: 2
    short_title: Rimuovere commands/ e aggiornare l'indice portabile
    full_description: "git rm dei sei file e della directory commands/. In skills/harness/SKILL.md correggere la chiusa dell'indice portabile che diceva 'Se viene aggiunto un file in commands/, anche questo indice va aggiornato': la sorgente delle operazioni diventa skills/<op>/."
    checked: true
  -
    id: 3
    short_title: Riscrivere plugin-commands.test.mjs sulle skill
    full_description: "La suite leggeva commands/<name>.md e pretendeva l'assenza del campo name. Riscritta su skills/<op>/SKILL.md conservando tutte le asserzioni di sostanza: descrizione, argument-hint, caso senza argomenti, invocazione degli script attraverso la radice del plugin, path esistenti, rimando alla reference, issue che non chiude, verify che delega a harness-verifier con il tool Task, compact che chiede conferma e proietta id e titolo, README allineato."
    checked: true
  -
    id: 4
    short_title: Adeguare plugin-codex e plugin-skill
    full_description: "plugin-codex.test.mjs ricavava i nomi da readdirSync('commands'): ora li ricava dalle directory di skills/ diverse da harness. Le asserzioni sulla base directory annunciata restano, riformulate sul testo nuovo delle skill. In plugin-skill.test.mjs il test dell'indice portabile enumerava commands/: ora enumera skills/."
    checked: true
  -
    id: 5
    short_title: Guard di regressione contro la collisione
    full_description: "Un test fallisce se esiste una directory commands/ con file .md che portano lo stesso nome di una skill: e' la collisione che ha prodotto i duplicati nel menu di Claude Code, e senza guard torna al primo file riaggiunto per comodita'. Il messaggio di errore spiega perche' fallisce."
    checked: true
  -
    id: 6
    short_title: "install-check: perche' commands resta fra i COMPONENT_DIRS"
    full_description: "In scripts/install-check.mjs la costante COMPONENT_DIRS elencava quattro directory 'che SONO il plugin'. commands/ resta nella lista di proposito: una copia installata che la porta ancora e' esattamente la divergenza da segnalare dopo questo rilascio. Commento aggiornato, e la stessa ragione scritta in references/install-check.md."
    checked: true
  -
    id: 7
    short_title: README, CONTRIBUTING e AGENTS.md
    full_description: "README: riscritto il paragrafo 'Codex CLI and other agent hosts' togliendo la frase che dichiarava i comandi Claude sotto commands/ e non toccati dal manifest Codex, e spiegato che le stesse skill servono i due host. CONTRIBUTING: aggiornata la tabella del layout e il passo 2 del development loop. AGENTS.md: nessuna occorrenza."
    checked: true
  -
    id: 8
    short_title: Bump 0.7.3 nei tre manifest
    full_description: Versione 0.7.3 in .claude-plugin/plugin.json, .claude-plugin/marketplace.json e .codex-plugin/plugin.json, che era rimasto a 0.7.1 mentre gli altri due erano a 0.7.2. Un test confronta i tre.
    checked: true
  -
    id: 9
    short_title: npm run test verde e commit sul ramo
    full_description: Eseguire npm run test fino al verde e committare su fix/commands-skills-collision. Nessuna pubblicazione prima del pass del verificatore indipendente.
    checked: true
  -
    id: 10
    short_title: Puntatori rimasti verso i file cancellati
    full_description: "Esito del primo giro di verifica: skills/harness/references/issues.md riga 57 rimandava a commands/issue.md, cancellato dallo stesso commit. Corretto li', piu' il commento di scripts/issue-manager.mjs che citava commands/issue.md e commands/verify.md, e la reference install-check.md. Aggiunto il test che rifiuta qualunque puntatore a commands/<nome>.md nel corpus che un agente legge: e' il difetto che una grep aveva mancato e che un test coglie."
    checked: true
validation:
  criteria: "PASS su tutti e sette i criteri. Ramo fix/commands-skills-collision @ f1c7e8c, working tree pulito (git status --short non stampa nulla).\n\nC1 - la directory dei command sparita e nessun puntatore residuo: Test-Path su di essa = False, git ls-files non la elenca. La correzione del primo giro c'e': skills/harness/references/issues.md:57 rimanda ora a ../../issue/SKILL.md, sezione Nessun argomento, e quella sezione esiste davvero (skills/issue/SKILL.md:30). scripts/issue-manager.mjs:1621-1622 cita skills/harness/SKILL.md, skills/issue/SKILL.md e skills/verify/SKILL.md al posto dei due file cancellati. Grep su skills/ e agents/: le uniche occorrenze restano in references/install-check.md:41-44, che spiega perche' quella directory resta sorvegliata da install-check, e non la indica come sorgente dei comandi. AGENTS.md: nessuna occorrenza.\n\nC2 - sei skill complete: frontmatter con name, description, argument-hint e allowed-tools verificato su tutte e sei (status, issue, verify, compact, docs-gate, sweep). Il corpo porta il contratto operativo, non un rimando: issue i casi list/show/new/update/init/upgrade piu' la tabella degli errori e il divieto di chiudere; verify i tre passi con la delega a harness-verifier e il divieto di verifica inline; compact i tre passi con la conferma esplicita prima della primitiva; sweep i cinque passi; status e docs-gate il lancio dello script e la ristampa verbatim.\n\nC3 - radice del plugin e Codex: tutte e sei portano la nota Dove sta lo script, con base directory annunciata per questa skill, la derivazione <base della skill>/../../scripts e il fermati e chiedila. Il file agents/openai.yaml e' presente in tutte e sei le skill, con display_name e default_prompt.\n\nC4 - guard reso rosso davvero, su una copia dell'albero in scratchpad, senza toccare il repository. Baseline sulla copia: 15 test, 15 pass. Reintrodotto il file del command issue: AssertionError - commands e skills both define issue, Claude Code registers each of them twice, exit 1. Poi tolto quel file e aggiunta dentro references/issues.md una riga che rimanda al file cancellato: AssertionError - skills/harness/references/issues.md points at a file which the plugin no longer ships, exit 1. Il test nuovo riproduce quindi esattamente il difetto per cui il primo giro aveva chiuso fail. Entrambi girano dentro il gate: le righe 'no operation is defined twice' e 'nothing an agent reads still points at a deleted command file' compaiono nell'output di npm run test.\n\nC5 - gate: .harness/config.json dichiara verify = npm run test; eseguito dal verificatore: tests 411, pass 411, fail 0, duration_ms 25245, EXITCODE=0. In test/ nessuna asserzione residua che pretenda la vecchia directory come sorgente: restano le fixture sintetiche di plugin-install-check.test.mjs, il guard di plugin-commands.test.mjs e plugin-codex.test.mjs:77-78, che vieta il campo omonimo nel manifest Codex.\n\nC6 - README e CONTRIBUTING: git diff d9ab1e1..HEAD mostra rimossa la frase che dichiarava i comandi Claude sotto la vecchia directory e non toccati dal manifest Codex, sostituita da README:71-75 (one definition per operation, e il plugin non ha piu' quella directory). CONTRIBUTING sostituisce la riga di tabella con skills/<operation>/ e riscrive il passo 2 del development loop.\n\nC7 - versione: il campo version vale 0.7.3, identico, in .claude-plugin/plugin.json, .claude-plugin/marketplace.json e .codex-plugin/plugin.json.\n\nOsservazioni fuori scope, non bloccanti: docs/superpowers/plans/, docs/superpowers/specs/ e .harness/archive/*.json contengono ancora puntatori ai vecchi file, ma sono piani, spec e archivi datati (storia congelata come issues.json) e docs/ non e' un componente del plugin - COMPONENT_DIRS elenca agents, commands, scripts, skills - quindi fuori dal corpus del criterio C1 e del test nuovo. La 0.7.3 non e' ancora pubblicata: la copia installata resta alla 0.7.0, come atteso prima del pass. Nessun file del repository modificato dal verificatore: git status --short vuoto a fine verifica, le prove sui guard fatte su una copia in scratchpad."
  tasks:
    -
      id: 1
      short_title: commands/ non esiste piu'
      full_description: Verificare che la directory commands/ sia assente dal working tree e che nessun file di documentazione o di skill la citi come luogo dei comandi. Le sole occorrenze ammesse sono le fixture sintetiche dei test di install-check e la storia in issues.json.
      checked: true
    -
      id: 2
      short_title: Sei SKILL.md complete e autosufficienti
      full_description: "Aprire skills/{status,issue,verify,compact,docs-gate,sweep}/SKILL.md e controllare che ognuna porti il contratto operativo che stava nel command corrispondente (invocazione dello script, gestione degli argomenti, casi d'errore, rimando alla reference) e non un semplice 'leggi la skill principale'. Frontmatter con name, description, argument-hint, allowed-tools."
      checked: true
    -
      id: 3
      short_title: Portabilita' della radice del plugin
      full_description: Ogni SKILL.md deve dire come si ricava la radice del plugin quando l'host non sostituisce CLAUDE_PLUGIN_ROOT, coerentemente con la regola gia' scritta in skills/harness/SKILL.md. Verificare inoltre che agents/openai.yaml sia ancora presente in tutte e sei le skill.
      checked: true
    -
      id: 4
      short_title: Guard di regressione sulla collisione
      full_description: Esiste un test che fallisce se una stessa operazione risulta definita sia come file in commands/ sia come skills/<op>/SKILL.md. Controllarlo rendendolo rosso temporaneamente, o leggendo l'asserzione, e verificare che sia agganciato a npm run test.
      checked: true
    -
      id: 5
      short_title: npm run test verde
      full_description: "Eseguire il comando di verifica dichiarato in .harness/config.json e riportarne l'output. Deve uscire 0 con la suite aggiornata: nessun test residuo che pretenda l'esistenza di commands/ come sorgente dei comandi."
      checked: true
    -
      id: 6
      short_title: Documenti e versione allineati
      full_description: README e CONTRIBUTING descrivono il layout a sole skill; la frase del README che dichiara i comandi Claude sotto commands/ e' rimossa o riscritta. La versione 0.7.3 compare identica nei tre manifest.
      checked: true
  state: pass
created_at: "2026-08-17T07:55:25Z"
updated_at: "2026-08-17T08:24:25Z"
revision: 1
---

# I comandi diventano skill: una definizione sola per operazione

La 0.7.2 ha aggiunto sei skill wrapper con gli stessi nomi dei sei file in commands/. Claude Code ha unificato command e skill: commands/X.md e skills/X/SKILL.md producono entrambi /harness:X, e la scansione di skills/ non e' disattivabile (nel manifest il campo skills somma ai default, commands li sostituisce). Ogni operazione harness compare quindi due volte nel menu.

Si toglie la collisione dal lato commands/: la directory sparisce e ogni skills/<op>/SKILL.md diventa l'unica definizione, col contratto operativo del command (argument-hint, allowed-tools, $ARGUMENTS, CLAUDE_PLUGIN_ROOT) piu' la regola per risolvere la radice del plugin dalla base directory annunciata, per gli host che non sostituiscono quella variabile. Codex continua a esporre $<op> tramite agents/openai.yaml. E' il layout di Superpowers, ed e' l'unico allineato ad Agent Plugins 1.0, dove skills/ e' l'unica posizione di discovery standard.

Ricadono nel tratto i test, README, CONTRIBUTING e l'indice portabile in skills/harness/SKILL.md.

Primo giro di verifica fail: references/issues.md rimandava ancora a commands/issue.md, cancellato dallo stesso commit.
