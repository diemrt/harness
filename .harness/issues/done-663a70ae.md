---
id: 663a70ae-48ba-4e41-b48d-27af3dc7843b
title: Il blocco task della card parla la lingua del board
status: done
tier: standard
depends_on: []
covers: []
tasks:
  -
    id: 1
    short_title: Test di progressBar riscritto sugli attributi
    full_description: In test/plugin-board.test.mjs sostituire il test sui glifi con quello su value/max e sulla presenza di progress-success solo a completo. Deve fallire sul codice attuale.
    checked: true
  -
    id: 2
    short_title: progressBar produce un <progress>
    full_description: "Riscrivere la funzione in scripts/board.html: stringa vuota se total e' 0, altrimenti <progress> con value, max e progress-success solo quando done >= total. Test verde."
    checked: true
  -
    id: 3
    short_title: Commit del primo tratto
    full_description: git add scripts/board.html test/plugin-board.test.mjs e commit. Allineare i task prima di committare.
    checked: true
  -
    id: 4
    short_title: Test nuovo su renderTaskBlock
    full_description: "Test che asserisce <progress>, badge badge-ghost, le due icone lucide e l'assenza di [x], [ ] e font-mono. Deve fallire sul markup attuale."
    checked: true
  -
    id: 5
    short_title: Markup di renderTaskBlock riscritto
    full_description: Icone check-circle/circle al posto dei marcatori, conteggio dentro un badge, progressBar dentro il summary. npm test verde su tutta la suite.
    checked: true
  -
    id: 6
    short_title: Commit del secondo tratto
    full_description: git add dei due file e commit, dopo aver allineato i task.
    checked: true
  -
    id: 7
    short_title: Fixture temporanea e board per l'approvazione
    full_description: Seminare i quattro casi in una directory di scratchpad, avviare il board con --project-dir su quella, controllare projectDir e dare l'URL all'utente.
    checked: true
  -
    id: 8
    short_title: Chiusura del lavoro e in_review
    full_description: Fermare il board col pid, cancellare la fixture, verificare che git status non mostri residui, portare la issue in in_review per la verifica indipendente.
    checked: true
  -
    id: 9
    short_title: Nota di approvazione committata
    full_description: "Passo aggiunto dopo il fail del primo giro: scrivere docs/superpowers/approvazioni/2026-08-12-board-task-ui.md con la revisione approvata e l'approvazione verbatim del committente, e committarlo."
    checked: true
validation:
  criteria: "Secondo giro, tutto ricontrollato sugli artefatti (nessun giudizio ereditato dal primo giro). | Gate: `npm run test` (da .harness/config.json) -> exit 0, 363 pass / 0 fail. | C1 suite verde: come sopra, exit 0 su tutta la suite. | C2 progressBar: funzioni estratte da scripts/board.html ed eseguite: progressBar(0,0)=\"\"; (3,5) value=3 max=5 success=false; (9,10) value=9 max=10 success=false; (4,4) value=4 max=4 success=true. | C3 nessun residuo terminale: markup di renderTaskBlock su due task -> [x]=false, [ ]=false, font-mono=false, glifi U+2593/U+2591=false; presenti <progress>, badge badge-ghost, data-lucide=check-circle e circle. | C4 nessun test perso: `git diff 3afa41c HEAD -- test/plugin-board.test.mjs | grep -E '^[+-]test('` mostra una sola riga, un test aggiunto e nessuno rimosso; il test 'progressBar fills only when the work is actually finished' e' a test/plugin-board.test.mjs:718 e asserisce value/max (righe 729-730, 739-740). | C5 nota di approvazione: docs/superpowers/approvazioni/2026-08-12-board-task-ui.md committato in 2743a69 (`git show --stat 2743a69`), dichiara 'Revisione approvata: 844a704' (riga 5) e riporta due approvazioni verbatim (righe 44 e 48), la seconda successiva al fail del primo giro. Non e' un file vuoto: dichiara i quattro casi mostrati e delimita cosa la firma non copre (righe 50-55). Verificato che l'artefatto non sia stale: `git diff 844a704 HEAD -- scripts/board.html test/plugin-board.test.mjs` e' vuoto, e `git diff --name-only 844a704 HEAD` elenca solo il file di approvazione. | Legittimita' della riformulazione (giudizio esplicito, non declassamento): il criterio passa da un'azione ('l'utente ha guardato e approvato') a un artefatto committato che pinna la revisione, esattamente il pattern di references/verification.md sezione 'Quando la prova sta fuori dalla portata dell'agent'; le tre proprieta' richieste (committato, revisione dichiarata, righe decisive verbatim) sono soddisfatte; la firma sta nella description della issue come prescritto e la nota e' committata dal committente (autore di 2743a69); nessun criterio macchina e' stato rimosso o ammorbidito: confrontati con la spec committata in 3afa41c (sezione 6, che dichiarava come unico gate automatico 'npm test verde'), i criteri 1-4 e 6 sono piu' stringenti, non piu' deboli. La domanda che l'artefatto pone al verificatore e' quindi piu' controllabile di prima, non meno. | C6 repository pulito: `git status --porcelain --untracked-files=all` -> solo ' M issues.json' (il tracker), nessun file di fixture, nessun residuo dopo l'esecuzione della suite. | Osservazioni fuori scope (non bloccanti): (a) la nota porta le citazioni verbatim ma nessun puntatore recuperabile alla fonte (sessione/transcript), che verification.md chiede come terza proprieta' ma che il criterio 5 non richiede; (b) il record della issue vive solo nel working tree di issues.json, quindi il testo del criterio 5 pre-riformulazione non e' ricostruibile da git: il confronto e' stato fatto contro la spec e il piano committati in 3afa41c. | Nessun file modificato dal verificatore: unica scrittura questa chiusura; probe eseguito su copia in scratchpad."
  tasks:
    -
      id: 1
      short_title: Suite verde
      full_description: npm test esce 0 sull'intera suite, non solo sul file del board.
      checked: true
    -
      id: 2
      short_title: "progressBar: attributi e tono"
      full_description: value e max sono i numeri veri; progress-success compare solo quando done === total, mai a 9/10.
      checked: true
    -
      id: 3
      short_title: Nessun residuo del terminale
      full_description: "Nel markup di renderTaskBlock non restano glifi della barra, marcatori [x]/[ ] o classi font-mono."
      checked: true
    -
      id: 4
      short_title: Nessun test perso per strada
      full_description: Il test sui glifi e' stato riscritto sugli attributi, non rimosso; i tre test su renderTaskBlock restano verdi.
      checked: true
    -
      id: 5
      short_title: Nota di approvazione presente e coerente
      full_description: "Il file di approvazione e' committato, dichiara la revisione 844a704 e riporta l'approvazione del committente: l'artefatto su cui il criterio e' stato riformulato."
      checked: true
    -
      id: 6
      short_title: Repository pulito
      full_description: "Nessun file di fixture e nessun processo del board lasciato dietro: git status --porcelain mostra solo i file toccati dal lavoro."
      checked: true
  state: pass
created_at: "2026-08-12T14:04:29Z"
updated_at: "2026-08-12T14:23:38Z"
revision: 1
---

# Il blocco task della card parla la lingua del board

Il blocco task e' l'unico punto di scripts/board.html disegnato come un terminale: barra ASCII di dieci glifi in font-mono, marcatori [x]/[ ], conteggio monospace. Tutto il resto della pagina e' daisyUI - badge a pillola, rounded-xl, icone lucide, colori semantici.

Il restyle tocca due sole funzioni: progressBar diventa un <progress> daisyUI con tono success solo a task completi, renderTaskBlock sostituisce i marcatori con icone lucide e mette il conteggio in un badge.

Riformulazione firmata dal committente il 2026-08-12: il criterio 5 nominava un'azione (l'utente guarda e approva) e nessun verificatore diverso dal committente poteva controllarlo; il primo giro di verifica ha giustamente bloccato la issue. Il criterio e' ora scritto sull'artefatto docs/superpowers/approvazioni/2026-08-12-board-task-ui.md, committato, che dichiara la revisione approvata e riporta l'approvazione verbatim. La firma e' del committente, non del worker.

Spec: docs/superpowers/specs/2026-08-12-board-task-ui-design.md
Piano: docs/superpowers/plans/2026-08-12-board-task-ui.md
