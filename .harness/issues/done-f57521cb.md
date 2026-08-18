---
id: f57521cb-3a57-4c45-a029-4fa608c23d98
title: La skill sa dove sono i propri script invece di indovinarli
status: done
tier: standard
depends_on: [bfb0a23f-50ff-4e44-873e-585b1bcedbd8]
covers: [6e1c8bc]
tasks:
  -
    id: 1
    short_title: Misurare dove la sostituzione avviene davvero
    full_description: "Misurato. SKILL.md grezza porta il token; la copia iniettata in sessione arriva col path gia' risolto, quindi per la skill la premessa della description e' falsa. Le reference no: aperte con Read sono file su disco e il token ci resta alla lettera (verification.md ne ha 2, issues/config/board/docs-gate 1 ciascuna). L'agent ne ha 3 e non e' stato misurato: entrambe le volte gliel'ho risolto io nel prompt prima che potesse provarci. Riportato all'utente."
    checked: true
  -
    id: 2
    short_title: La regola di risoluzione in SKILL.md
    full_description: "Aggiunta sotto la definizione di $SCRIPTS: base directory annunciata dal tool Skill piu' ../../scripts, con il perche' la regola sia questa e non un path. Dice anche che il testo puo' arrivare risolto ma le reference no, che e' la parte misurata."
    checked: true
  -
    id: 3
    short_title: Il divieto di indovinare
    full_description: "Scritto, e ancorato alla conseguenza invece che al principio: il path vecchio non fallisce, gira sulla versione sbagliata. E' il motivo per cui e' un divieto e non un consiglio."
    checked: true
  -
    id: 4
    short_title: La stessa regola nell'agent
    full_description: Sezione propria in agents/harness-verifier.md, prima di 'Non correggere niente'. Include il ripiego su node scripts/... quando e' il repository stesso a essere in verifica, che e' il caso reale in cui mi sono trovato due volte.
    checked: true
  -
    id: 5
    short_title: Il consiglio d'installazione, marcato come tale
    full_description: "Sezione in fondo a SKILL.md, prima di Reference. La marcatura sta nel titolo E nel corpo, e un test verifica che il clock-in non nomini nessun comando di installazione: senza quello la sezione sarebbe rientrata dalla finestra come passo."
    checked: true
  -
    id: 6
    short_title: I test, ancorati alla frase
    full_description: "Nove asserzioni fra plugin-skill e plugin-agent. Provate una per una contro le versioni precedenti dei due file estratte da HEAD: nessuna faceva match. Ancorate alla derivazione, al divieto e alla conseguenza - non alla parola 'path', che nella skill compare ovunque, ne' a CLAUDE_PLUGIN_ROOT, che matcherebbe gli esempi che la regola serve a spiegare."
    checked: true
  -
    id: 7
    short_title: Nessuno script toccato
    full_description: "git diff --stat del commit 6e1c8bc: agents/harness-verifier.md, skills/harness/SKILL.md, test/plugin-agent.test.mjs, test/plugin-skill.test.mjs, issues.json. Nessun scripts/."
    checked: true
  -
    id: 8
    short_title: Suite verde, commit, consegna
    full_description: "npm test 433/433. Commit 6e1c8bc. Gate documentale: 0 commit di codice scoperti, confermato con docs-gate.mjs invece che dedotto dalle estensioni."
    checked: true
validation:
  criteria:
    - "SKILL.md, dove definisce $SCRIPTS, dice come si calcola: la base directory annunciata dal tool Skill, piu' ../../scripts"
    - SKILL.md vieta esplicitamente di inventare un path o di riusarne uno assoluto visto altrove
    - "agents/harness-verifier.md porta la stessa regola: anche lui usa ${CLAUDE_PLUGIN_ROOT} in comandi che qualcuno deve risolvere"
    - esiste una sezione marcata come consiglio su richiesta, non come passo, su come installare harness perche' i comandi siano raggiungibili
    - un test asserisce che la regola di risoluzione e' presente in SKILL.md e nell'agent, ancorato alla frase e non alla sola parola path
    - "nessuno script viene modificato: git diff --stat non nomina scripts/"
    - npm test e' verde
  tasks:
    -
      id: 1
      short_title: La regola di risoluzione in SKILL.md
      full_description: "Verificato: git show 6e1c8bc -- skills/harness/SKILL.md aggiunge la sezione 'Come si calcola' dopo la definizione di $SCRIPTS, con testo 'Il valore si ricava dalla base directory che il tool Skill annuncia quando questa skill viene invocata... $SCRIPTS e' <base della skill>/../../scripts'."
      checked: true
    -
      id: 2
      short_title: Il divieto di indovinare
      full_description: "Verificato: stessa sezione contiene 'Non indovinarlo, e non riusare un path assoluto visto altrove', ancorato alla conseguenza (gira sulla versione sbagliata, non fallisce)."
      checked: true
    -
      id: 3
      short_title: La stessa regola nell'agent
      full_description: "Verificato: git show 6e1c8bc -- agents/harness-verifier.md aggiunge la sezione '${CLAUDE_PLUGIN_ROOT} va risolto, non incollato' prima di 'Non correggere niente', con la stessa regola di derivazione e divieto."
      checked: true
    -
      id: 4
      short_title: Il consiglio d'installazione, su richiesta
      full_description: "Verificato: sezione '## Consiglio, su richiesta: installare harness' (riga 425 di SKILL.md) marcata sia nel titolo che nel corpo ('Questa sezione non e' un passo del workflow'). Grep di /plugin install nel file mostra un solo hit a riga 437, fuori dal range Clock in (righe 39-65): clock-in non contaminato."
      checked: true
    -
      id: 5
      short_title: Un test difende la regola, ancorato alla frase
      full_description: "Verificato indipendentemente: estratte le versioni pre-commit di SKILL.md e harness-verifier.md (git show 6e1c8bc^:...) in directory temporanea e testate le 9 regex delle due nuove suite 'regola di risoluzione' (4 in plugin-agent.test.mjs, 5 in plugin-skill.test.mjs) con uno script node ad-hoc: tutte e 9 non matchano la versione precedente e tutte matchano la versione nuova. Confermata la dichiarazione del worker."
      checked: true
    -
      id: 6
      short_title: Nessuno script toccato
      full_description: "Verificato: git show 6e1c8bc --numstat elenca solo agents/harness-verifier.md, issues.json, skills/harness/SKILL.md, test/plugin-agent.test.mjs, test/plugin-skill.test.mjs. Nessun file in scripts/."
      checked: true
    -
      id: 7
      short_title: Suite verde
      full_description: "Eseguito npm run test dalla radice del repository: 433 test, 433 pass, 0 fail. Verificato anche node scripts/docs-gate.mjs --since 6e1c8bc^: '1 commit nella finestra - 0 toccano codice - 0 non coperti'."
      checked: true
  state: pass
created_at: "2026-08-13T13:39:00Z"
updated_at: "2026-08-14T09:57:44Z"
---

# La skill sa dove sono i propri script invece di indovinarli

Le reference definiscono $SCRIPTS come ${CLAUDE_PLUGIN_ROOT}/scripts, ma CLAUDE_PLUGIN_ROOT non e' una variabile d'ambiente: non esiste nel processo shell. Claude Code la sostituisce nei file dentro commands/, e li' funziona; nella skill, nelle reference e nell'agent resta testo. L'agente che le legge non puo' espanderla, e ripiega sull'unica cosa che conosce - il path letterale del progetto in cui si trova harness.

Il danno si vede negli altri progetti: comandi con un path assoluto scritto a mano. E il path del plugin installato contiene la versione (.claude/plugins/cache/<owner>/harness/<versione>/), quindi ogni rilascio lo cambia e il path scritto a mano continua a puntare a una copia vecchia che esiste ancora - un errore silenzioso.

La ricetta esiste gia' e non era stata vista: il tool Skill annuncia la propria base directory quando la skill viene invocata. $SCRIPTS e' <base della skill>/../../scripts, e vale identico per plugin installato, repo clonato e documenti letti da una CLI esterna. AGENTS.md lo dice gia' a meta', ma solo al worker esterno.
