---
id: 2c3dbb50-a29d-459b-a62b-8cb33713ee96
title: "Il gate documentale: dallo hook git allo script cumulativo"
status: done
tier: null
depends_on: []
covers: []
tasks: []
validation:
  tasks: []
  criteria:
    - "Archived originals: .harness/archive/2026-08-12T14-32-54Z.json"
    - 4faa2ce8-0857-47cc-b512-7df93fca3d93 - Hook git e gate documentale
    - "76e83448-44df-4cd6-a655-c0503f4c92d7 - Il guscio di docs-gate.mjs: config, git, finestra, uscite"
    - 3c56866d-6515-49f5-b13f-2b3152409067 - La parte che decide di docs-gate.mjs
    - c8cce222-371d-4a3b-9e3e-a23627f5ced0 - references/docs-gate.md e il comando che ci rimanda
    - 718823d6-c12d-433b-93aa-c593bcefb793 - Issue di verifica documentale generate dal gate post-commit
    - "d88b2b87-fea7-4535-95a0-24775cfeb163 - SKILL.md: il gate nomina covers e lo script, e nessuno script resta orfano"
    - a741fbbe-9bde-4777-bebf-75f8516bac33 - Gate documentale dei quattro commit di codice di docs-gate, covers e board
    - "2f76be67-521f-425c-b6f7-1fe41c72c321 - docs: verifica documentazione per commit cbde0b2"
    - c6425692-a90d-40ab-96ba-8804befe45c9 - Verifica documentale del commit 62e9bd3 su --upgrade
  state: pass
created_at: "2026-08-12T14:32:54Z"
updated_at: "2026-08-12T14:32:54Z"
---

# Il gate documentale: dallo hook git allo script cumulativo

Il gate che segnala i commit di codice che nessuna issue dichiara in covers. Prima come hook git, poi - caduti gli hook col modello plugin - come docs-gate.mjs: il guscio che legge configurazione, git e finestra, e la parte che decide cosa e' coperto. La finestra autocalibrata sulla piu' vecchia revisione dichiarata, che trasforma il costo di dimenticarsene in un ritardo invece che in una perdita. Piu' references/docs-gate.md, il richiamo in SKILL.md e le issue di verifica documentale che il gate stesso ha generato.
