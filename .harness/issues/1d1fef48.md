---
id: 1d1fef48-e1ec-46f4-b387-4be1b6a7a854
title: Documentare storage Markdown e rilascio 1.0
status: done
tier: standard
depends_on: [b3f9aad3-153e-44b8-bb96-1da6147ec3b0]
covers: [91f4d958be75f81884b97b4406136b8bf48f7715, 6a513b494481cc16379ad9730e454a973adbed7f, 66e77ba4ce75db310bb92c01606e5c07c3ade082, fb85f20f01a9926d96e1c742cfab19b98ba8eeca, c2cf97f5633107afa1052ee2f1d7a18448f4a53c, ba5ed5a8390ddea8ce1536021d3a6ff522513690, 84752a5f9683ce60892523b55a9b88a47e99c428, 068c5672f768595ad27023f3524f1f32a03ed3ad]
tasks:
  -
    id: 1
    short_title: Riscrivere la reference del tracker
    full_description: "Allineare skills/harness/references/issues.md dopo il capitolo storage gia' aggiornato: comandi, seed di --init, contratto di --upgrade con issues/archivePath/resumed, --compact per file, tabella dei codici di errore con STORAGE_NOT_MIGRATED e STORAGE_CONFLICT."
    checked: true
  -
    id: 2
    short_title: Allineare SKILL e reference restanti
    full_description: "skills/harness/SKILL.md e le reference status, config, docs-gate, git: cosa harness scrive nel progetto, dove vive il tracker, lettura via --dump, esclusione .harness nel gate."
    checked: true
  -
    id: 3
    short_title: Allineare skill operative e agent
    full_description: "skills/issue/SKILL.md, skills/status/SKILL.md e agents/harness-verifier.md: nessun riferimento a issues.json come file da leggere o copiare."
    checked: true
  -
    id: 4
    short_title: Allineare README e documenti di sviluppo
    full_description: "README.md, CLAUDE.md, AGENTS.md e CONTRIBUTING.md: storage Markdown, rottura di compatibilita con --upgrade, normalizzazione CRLF nella description."
    checked: true
  -
    id: 5
    short_title: Portare i manifest a 1.0.0
    full_description: plugin.json e marketplace.json a 1.0.0 con una descrizione che promette il tracker Markdown e non il board rimosso; controllare anche il manifest Codex.
    checked: true
  -
    id: 6
    short_title: Setacciare le promesse obsolete
    full_description: Cercare ogni residuo di issues.json e del board fuori dai documenti storici, lasciare solo i riferimenti intenzionali, eseguire la suite completa e portare la issue in review.
    checked: true
  -
    id: 7
    short_title: Togliere il contratto duplicato di upgrade
    full_description: "Il verificatore ha trovato il contratto di --upgrade dichiarato due volte in issues.md, con la shape vecchia rimasta sotto il blocco bash, e la riga di tabella Contratto di output ancora a { from, to, migrated }. Unificare in una sola dichiarazione e dare a --dump la riga che non aveva."
    checked: true
validation:
  criteria:
    - "C1 OK - il contratto di --upgrade e' dichiarato una volta sola: skills/harness/references/issues.md:216 dice data: { from, to, migrated, issues, archivePath, resumed }, e la riga di tabella :362 dice esattamente lo stesso; --dump ha ora la sua riga a :357 ({ schema_version, issues }, per id crescente). Il vecchio { from, to, migrated } sotto il blocco bash non esiste piu' (git show e26731a -- skills/harness/references/issues.md)."
    - "C1 riscontro a runtime, su copia temporanea con --project-dir esplicito (mai sul tracker reale): su tracker legacy schema 3 --get-all e --dump escono 1 con {ok:false,error:Run --upgrade before using this tracker.,code:STORAGE_NOT_MIGRATED}; --upgrade risponde {ok:true,data:{from:3,to:4,migrated:0,issues:1,archivePath:.../.harness/archive/upgrade-2026-08-18T08-51-54Z.json,resumed:false}} - la sestupla dichiarata; --dump dopo la migrazione risponde {ok:true,data:{schema_version:4,issues:[...]}}; sul disco restano .harness/issues/11111111.md (primi 8 caratteri dell'id) e .harness/archive/upgrade-<ts>.json, come promettono README, config.md e issues.md."
    - "C1 setaccio della stessa classe di difetto sulle reference: LIMITS in scripts/issue-manager.mjs:133 (80/1200/200/7/60/1200) coincide con la tabella issues.md:512; i default di paginazione (page 0, page-size 10, order asc, status backlog) coincidono con issues.md:331 e con --help; docsGate.exclude in scripts/harness-config.mjs:72 (docs/**, test/**, tests/**, **/*.md, .harness/**) coincide con config.md:78; le forme di --get/--get-all/--dump/--init/--compact sono identiche fra prosa e tabella e uguali alle writeOk() (issue-manager.mjs:372, 1034, 1441, 1626); status.md:293 (data = updated_at piu' recente) e :296 (nome = basename) coincidono con status-cli.mjs:415 e :496; la tabella dei codici issues.md:604-621 copre tutti i code emessi da issue-manager tranne il catch-all ERROR. Nessuna seconda dichiarazione divergente trovata nelle reference."
    - "C1 documenti storici non riscritti: git diff main...HEAD --name-status -- docs/ proposals/ mostra due sole righe A (docs/superpowers/plans/2026-08-17-issue-storage-markdown.md, docs/superpowers/specs/2026-08-16-issue-storage-markdown-design.md) e nessuna M. git status --short vuoto prima e dopo la verifica."
    - "C2 OK - .claude-plugin/plugin.json, .claude-plugin/marketplace.json e .codex-plugin/plugin.json portano tutti version 1.0.0; la descrizione dei primi due e' 'Controlled development harness for AI agents: a Markdown issue tracker, independent verification, and agent operating rules - installed as a plugin, leaving nothing in your project but a .harness/ directory', quella Codex non promette nulla di rimosso. Nessuno dei tre nomina il board. test/smoke.test.mjs:77 ora confronta anche la versione del manifest Codex con quella Claude."
    - "C3 OK - gate .harness/config.json verify = npm run test: 472 pass, 0 fail, 0 skipped (duration 20603ms). git grep issues.json fuori da docs/, .harness/ e test/ lascia solo riferimenti intenzionali a migrazione/legacy (README.md:127, issues.md:47-210 e 619-620, SKILL.md:19, status.md:62, git.md:87, skills/issue/SKILL.md:93, skills/status/SKILL.md:48), i commenti di codice di issue-manager/issue-store/tracker-graph (fuori scope, issue b3f9aad3) e proposals/ (fuori scope). git grep board lascia solo proposals/ e i test che verificano che il board sia sparito (test/plugin-skill.test.mjs:225-237)."
    - "Osservazioni fuori scope, non bloccanti: (a) il testo di --help in scripts/issue-manager.mjs elenca 17 codici e omette ID_COLLISION, introdotto da questo stesso ramo (issue-manager.mjs:1141, issue-store.mjs:308/329/347) e correttamente documentato in issues.md:621 - il documento e' giusto, e' l'help a essere incompleto; (b) il percorso idempotente di --upgrade restituisce solo {from,to,migrated} (misurato: {from:4,to:4,migrated:0}, issue-manager.mjs:1085) mentre issues.md:216 e skills/issue/SKILL.md dichiarano la sestupla senza distinguere quel caso, che pero' descrivono a parte come migrated: 0 e nessuna scrittura; (c) issues.md:317 riporta ancora '162.5KB per 88 issue', invariato rispetto a main mentre .harness/issues/ oggi ha 25 file."
  tasks:
    -
      id: 1
      short_title: Verificare documentazione autorevole
      full_description: Confrontare workflow, reference e documentazione pubblica con il comportamento finale.
      checked: true
    -
      id: 2
      short_title: Verificare metadata e ricerche
      full_description: Controllare manifest 1.0.0, test strutturali e tutti i riferimenti legacy residui.
      checked: true
  state: pass
created_at: "2026-08-17T12:49:45Z"
updated_at: "2026-08-18T08:53:43Z"
---

# Documentare storage Markdown e rilascio 1.0

Allineare documentazione autorevole, test strutturali e metadata del plugin al tracker Markdown: storage, compatibilita, upgrade, errori, manifest 1.0.0 e rimozione delle promesse obsolete sul JSON o board.
