---
id: 3f964bf4-0c25-4fb1-99d7-1092ccb0138f
revision: 9
title: Revisioni atomiche e compare-and-set delle issue
status: done
tier: reasoning
depends_on: []
covers: [88a99c4]
tasks:
  -
    id: 1
    short_title: Fissare spec e piano CAS
    full_description: Concludere il brainstorming, approvare e committare la spec prima del codice; produrre il piano eseguibile e riallineare questa issue al contratto definito.
    checked: true
  -
    id: 2
    short_title: Aggiungere revision e schema 5
    full_description: "Eseguire il Task 1 del piano: round-trip del campo revision, normalizzazione della baseline 1, superfici di lettura, insert e upgrade deterministico/idempotente di tracker Markdown e legacy."
    checked: true
  -
    id: 3
    short_title: Implementare il lock transazionale
    full_description: "Eseguire il Task 2 del piano: creare tracker-lock.mjs con acquisizione esclusiva, attesa, recupero dei lock abbandonati, grazia per file parziali e rilascio protetto dal token, con test portabili."
    checked: true
  -
    id: 4
    short_title: Proteggere tutte le mutazioni
    full_description: "Eseguire i Task 3 e 4 del piano: CAS obbligatorio e assenza di scritture per update/delete/compact, lock su init/insert/upgrade, compact all-or-nothing e prova concorrente a due processi."
    checked: true
  -
    id: 5
    short_title: Aggiornare chiamanti e contratto
    full_description: "Eseguire il Task 5 del piano: aggiornare worker, verificatore, skill e reference affinché rileggano, ricostruiscano il cambiamento e passino sempre la revisione osservata, distinguendo conflict da tracker busy."
    checked: true
  -
    id: 6
    short_title: Preparare 1.1.0 e handoff
    full_description: "Eseguire i Task 6 e 7 del piano: allineare i tre manifest a 1.1.0, eseguire npm run test e i controlli anti-regressione, aggiornare i task e consegnare la issue in_review a un verificatore distinto."
    checked: true
validation:
  criteria:
    - "PASS — git history: 4d1ba6e (spec) precedes d99c4f6 (plan), which precedes 88a99c4 (implementation); spec/plan cover schema 5, lock, CAS, migration, callers and 1.1.0, with immutable verification history explicitly out of scope."
    - PASS — npm run test exits 0; 498/498 tests pass, including insert/read revision 1, codec round-trip, INVALID_REVISION, compatible reads without byte rewrites, and deterministic/idempotent Markdown and legacy upgrade.
    - "PASS — full suite covers required/invalid/stale revisions, byte-identical refusals, update/delete increments and compact all-or-nothing CAS; issue-manager --help and issues.md expose delete.revision, compact.consumed and compact issues[].id."
    - PASS — full suite covers live/busy, abandoned and partial locks plus token-safe release; the real two-process CAS test yields one winner and one REVISION_CONFLICT, then replay preserves both task ticks at revision 3.
    - PASS — source inspection confirms init/insert/update/delete/compact/upgrade execute through withMutation/withTrackerLock; Markdown and legacy upgrades preserve timestamps/revisions, materialize 1, stamp config last and are byte-idempotent.
    - PASS — rg inspection of scripts, skills, agents and references found mutation instructions using --expected-revision or compact expected_revision and distinct REVISION_CONFLICT/TRACKER_BUSY handling; no shipped operational caller retains issue_ids.
    - "PASS — .claude-plugin/plugin.json, .claude-plugin/marketplace.json and .codex-plugin/plugin.json all declare 1.1.0; npm run test: 498 pass, 0 fail; git diff --check clean and git status --short empty before closure."
  tasks:
    -
      id: 1
      short_title: Controllare spec, piano e ordine git
      full_description: Confrontare spec e piano requisito per requisito e verificare dalla storia git che la spec preceda ogni commit di implementazione.
      checked: true
    -
      id: 2
      short_title: Provare schema e migrazione
      full_description: Eseguire test di revision 1, round-trip, valori invalidi, lettura compatibile e upgrade Markdown/legacy ripetuto senza variazioni di byte.
      checked: true
    -
      id: 3
      short_title: Provare CAS e assenza di scritture
      full_description: Eseguire update/delete/compact riusciti, mancanti, invalidi e stantii; confrontare i file prima/dopo tutti i rifiuti e controllare gli incrementi restituiti.
      checked: true
    -
      id: 4
      short_title: Provare lock e concorrenza reale
      full_description: Eseguire attesa, timeout, lock abbandonato/parziale e token di rilascio, quindi la corsa a due processi e il retry consapevole che conserva entrambe le spunte.
      checked: true
    -
      id: 5
      short_title: Ispezionare tutti i chiamanti
      full_description: Cercare ogni update/delete/compact in script, skill, agent e documentazione e verificare che usi il nuovo contratto e distingua REVISION_CONFLICT da TRACKER_BUSY.
      checked: true
    -
      id: 6
      short_title: Verificare release e gate completo
      full_description: Controllare 1.1.0 nei tre manifest, eseguire npm run test e ispezionare git status/diff per modifiche fuori scope prima di assegnare pass o fail.
      checked: true
  state: pass
created_at: "2026-08-20T15:51:52Z"
updated_at: "2026-08-21T08:50:17Z"
---

# Revisioni atomiche e compare-and-set delle issue

Implementare docs/superpowers/specs/2026-08-21-revisioni-atomiche-issue-design.md seguendo docs/superpowers/plans/2026-08-21-revisioni-atomiche-issue.md: revisioni monotone schema 5, lock transazionale di progetto, CAS obbligatorio su update/delete/compact, migrazione compatibile, aggiornamento dei chiamanti agentici e release 1.1.0. La spec e il piano formano un unico sottosistema verificabile, quindi il lavoro resta nella issue esistente. La direzione successiva — criteri immutabili e storico dei tentativi di verifica — è esplicitamente fuori scope e dipende da questo contratto; non viene aperta ora come nuova issue.
