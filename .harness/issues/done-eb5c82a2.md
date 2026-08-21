---
id: eb5c82a2-f2eb-43a5-bc71-4af0ae519f63
title: Il verificatore ha una sola shell, e senza quella non verifica
status: done
tier: standard
depends_on: []
covers: []
tasks:
  -
    id: 1
    short_title: PowerShell entra nei tools dell'agent
    full_description: "agents/harness-verifier.md: il frontmatter tools passa da [Read, Grep, Glob, Bash] a includere anche PowerShell. Su Windows c'e' sempre, e oggi e' l'unica via quando bash non parte. Edit e Write restano fuori: il verificatore non deve poter correggere."
    checked: true
  -
    id: 2
    short_title: La sezione sulla shell, con il ripiego
    full_description: "Nel corpo dell'agent: quale shell provare per prima, e soprattutto che davanti a un errore di AVVIO della shell - non del comando - deve passare all'altra invece di insistere. Il verificatore che ci e' cascato ha ritentato 26 volte lo stesso comando."
    checked: true
  -
    id: 3
    short_title: "Test: piu' di una shell nel frontmatter"
    full_description: In test/plugin-agent.test.mjs, un test asserisce che i tools elencano almeno due shell. Senza, la riga puo' sparire da una riscrittura e nessuno se ne accorge finche' una shell non si rompe.
    checked: true
  -
    id: 4
    short_title: "Test: l'istruzione di ripiego e' scritta"
    full_description: "Un test ancorato alla frase, non alla parola: deve asserire che l'agent distingue shell che non parte da comando che fallisce, come gia' fanno gli altri test di questo file."
    checked: true
  -
    id: 5
    short_title: Il prerequisito in references/verification.md
    full_description: La reference nomina di cosa ha bisogno un verificatore per esistere - una shell che parta - e dichiara cosa resta vero quando non ce l'ha. Oggi il prerequisito non e' scritto da nessuna parte.
    checked: true
  -
    id: 6
    short_title: La regola del 'non ho potuto verificare'
    full_description: "Scritto che una verifica che non ha potuto girare lascia la issue in in_review, che non e' un pass, e che l'orchestratore non la chiude al posto del verificatore: sarebbe self-validation con un passaggio in piu'."
    checked: true
  -
    id: 7
    short_title: Suite verde
    full_description: npm test verde, che e' anche il gate di .harness/config.json.
    checked: true
  -
    id: 8
    short_title: Commit
    full_description: git add di agents/harness-verifier.md, test/plugin-agent.test.mjs, skills/harness/references/verification.md e issues.json. Allineare i task prima di committare.
    checked: true
validation:
  criteria: "Verifica eseguita interamente da PowerShell su HEAD bbe5605, ramo feature-ergonomia-emessa, con git status --short vuoto prima e dopo. CRITERIO 1: agents/harness-verifier.md riga 9 dichiara tools [Read, Grep, Glob, Bash, PowerShell]; Edit e Write restano fuori. Criterio vivo e non solo scritto: questa sessione di verifica ha caricato la nuova definizione e ha davvero entrambe le shell fra i propri tool, e ha eseguito il gate su PowerShell. CRITERIO 2: agents/harness-verifier.md righe 24-53, sezione 'Hai due shell, e ti servono entrambe'. Nomina le due shell, dice di cambiare al primo errore di avvio, e distingue esplicitamente 'il comando fallisce' (e' un risultato, si prosegue) da 'la shell non parte' (errore dell'interprete, si passa subito all'altra), citando il fatal error add_item di bash.exe come sintomo tipico. Il ritentativo e' vietato a parole, righe 42-44: 'Non ritentare lo stesso comando sulla stessa shell che non parte', con il costo storico dei ventisei tentativi. Osservazione in scope: l'ordine e' lasciato libero ('Usa quella che ti e' piu' comoda') invece di prescrivere una prima shell fissa - scelta difendibile su questa macchina, dove Bash e' l'interprete rotto, e la parte portante (cosa fare quando non parte) e' scritta e coperta da test. CRITERIO 3: test/plugin-agent.test.mjs righe 53-67, test 'harness-verifier has more than one shell', filtra i tool su Bash e PowerShell e asserisce length >= 2. Provato NON vacuo con mutazione su una copia fuori dal repository (directory temporanea di scratchpad, repo intatto): baseline sulla copia 9 test 9 pass; rimosso PowerShell dal frontmatter il test fallisce con AssertionError 'the verifier declares only [Bash]: one broken interpreter and it cannot verify at all'. Anche il test gemello, righe 69-88, 'harness-verifier is told to switch shell when one will not start', e' ancorato a tre frasi e non alla parola shell: seconda mutazione con le regole cancellate e sostituite da una riga che ripete quattro volte la parola shell, il test fallisce con AssertionError 'the prompt must name the failure mode where the interpreter itself is broken'. CRITERIO 4: skills/harness/references/verification.md righe 25-52; la sezione 'Di cosa ha bisogno un verificatore per esistere' nomina il prerequisito (una shell che parta, perche' il gate e' un comando e lo e' anche la chiusura) e la sottosezione 'Quando non parte nessuna shell' dichiara cosa resta vero. CRITERIO 5: stessa sezione - riga 42, la issue resta a in_review / unknown e non e' un pass mancato per poco; riga 44, nessun validation.tasks viene spuntato perche' sarebbe evidenza fabbricata; riga 46, 'L'orchestratore non chiude al posto del verificatore', nominata come la tentazione da rifiutare, self-validation con un passaggio in piu'. CRITERIO 6: gate dichiarato in .harness/config.json campo verify, npm run test: eseguito, verde, tests 396 pass 396 fail 0 duration_ms 18039. Danni collaterali: nessuno. Il commit bbe5605 tocca solo i quattro file dichiarati, e il diff di issues.json riguarda unicamente questa issue (status in_review piu' i tasks 1-8). Nessuna scrittura sul tracker reale oltre a questa chiusura: le prove di mutazione sono state fatte su una copia in directory temporanea."
  tasks:
    -
      id: 1
      short_title: L'agent guadagna una seconda shell
      full_description: Il frontmatter di agents/harness-verifier.md elenca anche PowerShell. Su Windows c'e' sempre, e oggi e' l'unica via quando bash non parte.
      checked: true
    -
      id: 2
      short_title: L'ordine e il ripiego sono scritti
      full_description: L'agent dice quale provare per prima, e che davanti a un errore di avvio della shell - non del comando - deve passare all'altra invece di insistere. Il verificatore precedente ha ritentato 26 volte la stessa.
      checked: true
    -
      id: 3
      short_title: Un test difende la seconda shell
      full_description: Un test asserisce che il frontmatter elenca piu' di una shell, come gia' si fa per gli altri inventari del plugin.
      checked: true
    -
      id: 4
      short_title: Il prerequisito e' documentato
      full_description: references/verification.md nomina di cosa ha bisogno un verificatore per esistere, e cosa resta vero quando non ce l'ha.
      checked: true
    -
      id: 5
      short_title: Il caso 'non ho potuto verificare' ha una regola
      full_description: "Scritto che la issue resta in_review, che non e' un pass, e che l'orchestratore non puo' chiuderla al posto del verificatore: sarebbe self-validation con un passaggio in piu'."
      checked: true
    -
      id: 6
      short_title: Suite verde
      full_description: npm test verde, che e' anche il gate di .harness/config.json.
      checked: true
  state: pass
created_at: "2026-08-13T10:55:22Z"
updated_at: "2026-08-13T13:03:32Z"
revision: 1
---

# Il verificatore ha una sola shell, e senza quella non verifica

L'agent harness-verifier dichiara tools: [Read, Grep, Glob, Bash]. Una sola shell, e nessuna alternativa.

Il 2026-08-13 bash ha smesso di inizializzarsi su questa macchina (mount table msys, errno 1). Riproducibile lanciando bash.exe --version direttamente da PowerShell, e sopravvissuto a un riavvio della sessione: e' l'installazione, non il sandbox e non Claude Code. Il verificatore della issue 38eb7b1a ha tentato 26 comandi, non ne ha eseguito nessuno, ha correttamente rifiutato di dichiarare pass, e non ha potuto scrivere nemmeno il fail perche' la chiusura passa da issue-manager.mjs. La issue e' rimasta in_review senza che niente nel tracker dicesse perche'.

Il difetto non e' che bash si sia rotto. E' che un invariante di harness - verifica indipendente su OGNI issue - dipende da un solo binario che harness non nomina fra i propri prerequisiti e per cui non prevede alternativa. Su Windows PowerShell c'e' sempre, e il verificatore non puo' usarlo.

E' la stessa specie di difetto della issue bfb0a23f: una prescrizione che regge finche' l'ambiente sta fermo.
