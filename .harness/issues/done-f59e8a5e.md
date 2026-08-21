---
id: f59e8a5e-7382-4090-9489-dace5db15b38
title: Il board esce dal plugin senza lasciare riferimenti orfani
status: done
tier: standard
depends_on: [b2c59231-709d-469a-8746-1d0b290ee427]
covers: [6ca0ba4ce89eb0be03ecde0ff52a5c4ce15aa32f]
tasks:
  -
    id: 1
    short_title: git rm dei cinque file del board
    full_description: scripts/board-server.mjs, scripts/board.html, test/plugin-board.test.mjs, commands/board.md, skills/harness/references/board.md.
    checked: true
  -
    id: 2
    short_title: Manifest e documentazione di primo livello
    full_description: La description gemella in .claude-plugin/plugin.json e .claude-plugin/marketplace.json, piu' le eco in README.md, CONTRIBUTING.md e skills/harness/SKILL.md (elenco reference e comandi compresi).
    checked: true
  -
    id: 3
    short_title: Reference residue, .gitignore e .gitkeep
    full_description: Menzioni in references/issues.md, references/status.md, references/docs-gate.md (anche la riga di esempio di git log), le due voci .harness/board.* in .gitignore e il placeholder in scripts/.gitkeep.
    checked: true
  -
    id: 4
    short_title: Commenti di prosa negli script
    full_description: "issue-manager.mjs (quattro punti, help incluso) e status-cli.mjs (intestazione): il criterio 1 grep-a-zero include scripts/, quindi anche i commenti incidentali vanno riscritti senza indebolire cio' che spiegano."
    checked: true
  -
    id: 5
    short_title: Inventari di test aggiornati
    full_description: "Sei file di test oltre a quello cancellato citano il board: plugin-commands, plugin-skill, plugin-docs-gate, plugin-issue-manager, plugin-status-cli, smoke. Gli inventari devono cercare un mondo senza board."
    checked: true
  -
    id: 6
    short_title: "Chiusura: grep, suite, diff"
    full_description: grep di criterio 1 a zero righe, npm test verde, git diff --stat che non nomina docs/, issues.json, .harness/archive/ ne' proposals/.
    checked: true
validation:
  criteria:
    - "Verifica indipendente sul ramo chore/remove-board (6ca0ba4 lavoro, b7c5b08 tracker), working tree pulito (git status --short vuoto). (1) grep -rni board scripts/ skills/ commands/ .claude-plugin/ README.md CONTRIBUTING.md .gitignore: nessuna riga, exit 1; tutte e sette le path esistono (commands/ contiene compact, docs-gate, issue, status, sweep, verify). (2) I cinque file assenti dal filesystem e da git ls-files: scripts/board-server.mjs, scripts/board.html, test/plugin-board.test.mjs, commands/board.md, skills/harness/references/board.md; git ls-files | grep -i board torna solo docs/superpowers/**(4 file) e proposals/board-minimal.html, cioe' la storia esclusa apposta. (3) .claude-plugin/plugin.json e .claude-plugin/marketplace.json portano la stessa description 'Controlled development harness for AI agents: issue tracker, independent verification, and agent operating rules', nessun board; eco aggiornate in README.md (sottotitolo, capitolo Install, elenco What it does, riga /harness:board rimossa dalla tabella comandi) e in CONTRIBUTING.md (riga scripts/: 'issue tracker CLI, status CLI, configuration CLI, external worker runner, installation check'). (4) git show --stat 6ca0ba4 - il commit che la issue dichiara in covers - elenca 23 file e non nomina docs/, issues.json, .harness/archive/ ne' proposals/: la rimozione del board non ha riscritto storia. In git diff --stat main...HEAD compare issues.json (184, +51/-133), e proviene per intero dal solo b7c5b08, il commit di tracker che il workflow impone (backlog->in_review, allineamento dei task prima del commit, SKILL.md L321) e che ogni chiusura riproduce - questa compresa. Quel commit contiene anche la cancellazione delle due issue mai lavorate 284d96c3 e 03082d03 e la riscrittura di description/criteri/task di questa issue (via CLI: last_updated e updated_at aggiornati), decisione documentata nella description e nel messaggio di commit; docs/, .harness/archive/ e proposals/ restano intatti. (5) npm run test (verify di .harness/config.json): tests 400, pass 400, fail 0, duration_ms 24495, exit 0. Gli inventari cercano davvero un mondo senza board: test/plugin-skill.test.mjs asserisce !existsSync(references/board.md) e !/board/i.test(SKILL.md); smoke.test.mjs promette scripts/status-cli.mjs al posto di board-server.mjs; plugin-commands.test.mjs elenca sei comandi senza board. Fuori scope, non bloccante: test/plugin-issue-manager.test.mjs L1784-1832 conserva la fixture 'Board e dipendenze' (test/ non e' fra le path del criterio 1, ma il task di esecuzione 5 dava per aggiornato anche quel file). Nessun file modificato dal verificatore oltre a questa chiusura."
  tasks:
    -
      id: 1
      short_title: Nessun riferimento vivo al board
      full_description: "Il grep sui sette percorsi vivi torna vuoto. docs/ e proposals/ sono esclusi apposta: sono storia."
      checked: true
    -
      id: 2
      short_title: I cinque file sono spariti
      full_description: Sorgente, pagina, test, comando e reference rimossi con git rm.
      checked: true
    -
      id: 3
      short_title: Il manifest non promette piu' un board
      full_description: La description di plugin.json, la sua gemella in marketplace.json e le eco in README.md e CONTRIBUTING.md sono aggiornate.
      checked: true
    -
      id: 4
      short_title: La storia non e' stata riscritta
      full_description: git diff --stat non nomina docs/, issues.json, .harness/archive/ ne' proposals/.
      checked: true
    -
      id: 5
      short_title: Suite verde con l'inventario aggiornato
      full_description: "npm test verde: i test di inventario cercano un mondo senza board."
      checked: true
  state: pass
created_at: "2026-08-13T09:40:01Z"
updated_at: "2026-08-14T14:13:08Z"
revision: 1
---

# Il board esce dal plugin senza lasciare riferimenti orfani

Il board e' il 16,6 per cento della superficie mantenuta (1.873 righe fra sorgente e test) per un componente che il progetto stesso ha gia' declassato per iscritto, e l'unico che dipende dalla rete: carica tailwind, daisyUI e lucide@latest non pinnato da tre CDN.

Dei due usi che copriva, lo sguardo ce l'ha gia' --oneline. Il record — descrizioni, criteri, stato dei task — si chiede all'agente, che lo legge dal tracker: il 2026-08-14 l'export markdown e' stato scartato e le due issue che lo portavano (03082d03, 284d96c3) cancellate, perche' sarebbe una customizzazione del progetto che consuma harness e non un componente del plugin — la stessa natura che ha gia' monitor.ps1. Da qui la deviazione dal piano, che ai task 8-9 dava l'export per fatto: quei due task non verranno svolti.

Il rischio non e' cancellare: e' cancellare a meta'. I test coprono l'inventario dei file, non la prosa, e un riferimento orfano in SKILL.md o in una reference resta invisibile finche' un agente non ci sbatte contro.

Spec: docs/superpowers/specs/2026-08-13-ergonomia-emessa-design.md
Piano: docs/superpowers/plans/2026-08-13-ergonomia-emessa.md (task 8-9, export escluso)
