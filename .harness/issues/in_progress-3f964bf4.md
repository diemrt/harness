---
id: 3f964bf4-0c25-4fb1-99d7-1092ccb0138f
title: Revisioni atomiche e compare-and-set delle issue
status: in_progress
tier: reasoning
depends_on: []
covers: []
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
    checked: false
  -
    id: 3
    short_title: Implementare il lock transazionale
    full_description: "Eseguire il Task 2 del piano: creare tracker-lock.mjs con acquisizione esclusiva, attesa, recupero dei lock abbandonati, grazia per file parziali e rilascio protetto dal token, con test portabili."
    checked: false
  -
    id: 4
    short_title: Proteggere tutte le mutazioni
    full_description: "Eseguire i Task 3 e 4 del piano: CAS obbligatorio e assenza di scritture per update/delete/compact, lock su init/insert/upgrade, compact all-or-nothing e prova concorrente a due processi."
    checked: false
  -
    id: 5
    short_title: Aggiornare chiamanti e contratto
    full_description: "Eseguire il Task 5 del piano: aggiornare worker, verificatore, skill e reference affinché rileggano, ricostruiscano il cambiamento e passino sempre la revisione osservata, distinguendo conflict da tracker busy."
    checked: false
  -
    id: 6
    short_title: Preparare 1.1.0 e handoff
    full_description: "Eseguire i Task 6 e 7 del piano: allineare i tre manifest a 1.1.0, eseguire npm run test e i controlli anti-regressione, aggiornare i task e consegnare la issue in_review a un verificatore distinto."
    checked: false
validation:
  criteria:
    - La spec è committata prima del codice e il piano 2026-08-21-revisioni-atomiche-issue.md copre schema, lock, CAS, migrazione, chiamanti e release, escludendo lo storico fuori scope.
    - Insert e blocchi nascono a revision 1; tutte le letture la espongono; record senza campo leggono 1 senza riscrittura; revisioni non positive falliscono INVALID_REVISION.
    - Update, delete e compact richiedono la revisione osservata; ogni successo incrementa una volta; MISSING_ARGS, REVISION_CONFLICT e TRACKER_BUSY non cambiano alcun byte.
    - Due processi sulla stessa revisione producono un successo e un REVISION_CONFLICT; rilettura e riapplicazione mirata arrivano a revision 3 conservando entrambe le spunte.
    - Upgrade Markdown e legacy a schema 5 preserva timestamp e revisioni, materializza revision 1, scrive la config per ultima ed è idempotente; tutte le mutazioni usano il lock.
    - Worker, verificatore, skill harness/issue/compact e reference passano la revisione appena letta e vietano retry ciechi; nessun chiamante mutante resta senza CAS.
    - I tre manifest dichiarano 1.1.0 e npm run test esce 0, inclusi codec, lock, manager, concorrenza, worker, agenti e struttura del plugin.
  tasks:
    -
      id: 1
      short_title: Controllare spec, piano e ordine git
      full_description: Confrontare spec e piano requisito per requisito e verificare dalla storia git che la spec preceda ogni commit di implementazione.
      checked: false
    -
      id: 2
      short_title: Provare schema e migrazione
      full_description: Eseguire test di revision 1, round-trip, valori invalidi, lettura compatibile e upgrade Markdown/legacy ripetuto senza variazioni di byte.
      checked: false
    -
      id: 3
      short_title: Provare CAS e assenza di scritture
      full_description: Eseguire update/delete/compact riusciti, mancanti, invalidi e stantii; confrontare i file prima/dopo tutti i rifiuti e controllare gli incrementi restituiti.
      checked: false
    -
      id: 4
      short_title: Provare lock e concorrenza reale
      full_description: Eseguire attesa, timeout, lock abbandonato/parziale e token di rilascio, quindi la corsa a due processi e il retry consapevole che conserva entrambe le spunte.
      checked: false
    -
      id: 5
      short_title: Ispezionare tutti i chiamanti
      full_description: Cercare ogni update/delete/compact in script, skill, agent e documentazione e verificare che usi il nuovo contratto e distingua REVISION_CONFLICT da TRACKER_BUSY.
      checked: false
    -
      id: 6
      short_title: Verificare release e gate completo
      full_description: Controllare 1.1.0 nei tre manifest, eseguire npm run test e ispezionare git status/diff per modifiche fuori scope prima di assegnare pass o fail.
      checked: false
  state: unknown
created_at: "2026-08-20T15:51:52Z"
updated_at: "2026-08-21T07:28:16Z"
---

# Revisioni atomiche e compare-and-set delle issue

Implementare docs/superpowers/specs/2026-08-21-revisioni-atomiche-issue-design.md seguendo docs/superpowers/plans/2026-08-21-revisioni-atomiche-issue.md: revisioni monotone schema 5, lock transazionale di progetto, CAS obbligatorio su update/delete/compact, migrazione compatibile, aggiornamento dei chiamanti agentici e release 1.1.0. La spec e il piano formano un unico sottosistema verificabile, quindi il lavoro resta nella issue esistente. La direzione successiva — criteri immutabili e storico dei tentativi di verifica — è esplicitamente fuori scope e dipende da questo contratto; non viene aperta ora come nuova issue.
