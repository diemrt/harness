---
id: 21829dcb-fbda-4717-b609-c2438488ba9a
title: Rendere la skill portabile su Codex CLI
status: done
tier: standard
depends_on: []
covers: []
tasks:
  -
    id: 1
    short_title: Definire il contratto nei test
    full_description: Aggiungere test strutturali per adattamento Codex, indice portabile dei comandi e verifica indipendente.
    checked: true
  -
    id: 2
    short_title: Documentare l'adattamento Codex
    full_description: Aggiornare skill, reference di verifica e README mantenendo separato il packaging Claude Code.
    checked: true
  -
    id: 3
    short_title: Verificare e preparare la review
    full_description: Eseguire test mirati e suite completa, allineare i task e portare la issue in_review.
    checked: true
validation:
  criteria: "PASS — criterio 1: skills/harness/SKILL.md §§ Operazioni portabili per host senza slash command e Codex CLI esplicita il percorso Codex, preservando 1-WIP (r.100), HARNESS_ROLE=worker/tier (r.67-71) e publication gate (r.394-417). Criterio 2: commands/ contiene compact, docs-gate, issue, status, sweep, verify; l'indice elenca gli stessi sei con script/reference e intenti equivalenti. Criterio 3: skills/harness/references/verification.md r.25-35 definisce il subagent distinto per host senza agent Claude registrato e conserva in_review/unknown se non è disponibile. Criterio 4: README.md sezione Codex CLI and other agent hosts separa marketplace/Claude slash command da interoperabilità CLI, senza promettere installazione Codex. Criterio 5: npm run test eseguito: 402 pass, 0 fail, exit 0 (durata 17.028s). Controlli collaterali: git diff --check pulito; probe isolata del tracker con evidenza da 70000 caratteri produce JSON valido di 71894 byte, confermando che process.exitCode evita il troncamento stdout; i test aggiornano le attese macOS ai path canonici realpathSync (/private/var)."
  tasks:
    -
      id: 1
      short_title: Controllare il percorso Codex
      full_description: Verificare root, operazioni disponibili, comandi CLI, ruolo worker, tier e assenza degli slash command.
      checked: true
    -
      id: 2
      short_title: Controllare la verifica indipendente
      full_description: Verificare delega a un agente distinto e comportamento senza subagent o shell.
      checked: true
    -
      id: 3
      short_title: Eseguire la suite completa
      full_description: Eseguire npm run test e registrare l'esito nella chiusura.
      checked: true
  state: pass
created_at: "2026-08-16T22:17:47Z"
updated_at: "2026-08-16T22:23:20Z"
revision: 1
---

# Rendere la skill portabile su Codex CLI

Documentare come applicare harness fuori da Claude Code, con particolare attenzione a Codex CLI. Separare il contratto del workflow dalle primitive dell'host: risoluzione della root, scoperta delle operazioni disponibili ed equivalenti degli slash command, ruolo worker, tier, delega del verificatore e comportamento quando non sono disponibili subagent o shell. Aggiornare la documentazione pubblica senza presentare harness come plugin installabile nativamente su Codex.
