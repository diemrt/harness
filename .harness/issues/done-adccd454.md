---
id: adccd454-a30a-498e-adad-f076b5137203
title: Residui e buchi di presidio dopo il travaso a storage Markdown
status: done
tier: economy
depends_on: []
covers: [6769512f0a0053d7cf93cf970ab9b259fed05ce8, 877b5cdc6b3ad60dfb2084a9f817612f285287a8]
tasks:
  -
    id: 1
    short_title: Test dell ordine di scrittura
    full_description: "Test fallente prima: la rinomina di stato deve avere il file nuovo sul disco quando il vecchio viene rimosso, osservato e non dedotto."
    checked: true
  -
    id: 2
    short_title: Validare il nome anche in lettura singola
    full_description: "Test e implementazione: findIssueFile rifiuta un nome fuori formato o il cui prefisso contraddice lo status del frontmatter, come gia' fa readAllIssues."
    checked: true
  -
    id: 3
    short_title: Togliere il codice morto
    full_description: Rimuovere writeIssuesFile e ogni altra funzione rimasta senza chiamanti dopo il travaso.
    checked: true
  -
    id: 4
    short_title: Allineare help e payload di upgrade
    full_description: Elencare ID_COLLISION fra i codici di --help; rendere il payload di --upgrade uguale sui due percorsi oppure dichiarare nei documenti quali campi mancano sul no-op.
    checked: true
  -
    id: 5
    short_title: Correggere i commenti
    full_description: I commenti di issue-manager.mjs e tracker-graph.mjs che descrivono issues.json come il tracker vivo invece che come formato legacy.
    checked: true
  -
    id: 6
    short_title: Verificare e affidare review
    full_description: Suite completa, gate documentale, allineamento dei task e passaggio in review.
    checked: true
  -
    id: 7
    short_title: Togliere l import orfano e presidiarlo
    full_description: "Il verificatore ha trovato renameSync ancora importato in issue-manager.mjs e mai chiamato: era writeIssuesFile il suo unico chiamante. Rimuoverlo e aggiungere il test strutturale che rende visibile un import senza usi, perche' e' la seconda volta che ne passa uno."
    checked: true
validation:
  criteria:
    - "RIVERIFICA dopo il fix 877b5cd (HEAD 0fdba6f, ramo feat/markdown-issue-storage). Gate: npm run test -> tests 483, pass 483, fail 0, exit 0 (erano 482 prima del fix; il +1 e il test strutturale nuovo). Tutti e sei i criteri ricontrollati da zero in questo giro, nessuno ereditato dal precedente."
    - "[1] Codice morto - PASS, nella lettura larga. writeIssuesFile non esiste piu in nessuno script: git grep lo trova solo in .harness/archive/ (storia congelata), nel file di questa issue, e in un commento a scripts/issue-manager.mjs:987 che ne dichiara la rimozione. Il residuo del giro precedente e chiuso: l import di renameSync e sparito da scripts/issue-manager.mjs, il cui blocco node:fs (righe 104-112) ora e existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync; renameSync sopravvive solo in scripts/issue-store.mjs, dove e chiamato a riga 445. Non mi sono fermato a quella riga: scansione tokenizzata di tutti e 8 gli script di scripts/ (docs-gate, harness-config, harness-worker, install-check, issue-manager, issue-store, status-cli, tracker-graph) su import nominali, import di default e namespace, const/let/var di primo livello e dichiarazioni di funzione, contando per le esportate anche gli usi nel resto del repo -> TOTAL ORPHANS: 0. Lo zero non e vacuo: sulla stessa scansione applicata a una copia con due import inutilizzati piantati a mano (appendFileSync in install-check.mjs, copyFileSync in status-cli.mjs) il risultato e TOTAL ORPHANS: 2, che li nomina entrambi. Una seconda passata piu stretta, che ignora commenti e stringhe, ha prodotto 35 candidati, ma il suo stripper sbaglia sui letterali regex (dava path per inutilizzato in issue-store.mjs): ho quindi controllato a mano tutti i 15 nomi distinti segnalati (SUBJECT_MAX, shortSha, truncate, ONELINE_LABEL, TASKS_COL, tierIcon, onelineFor, ISSUE_FILE_RE, statusOf, encodeString, findIssueFile, parsedFile, validateIssueFileName, issuesDirectory, parseDescription) e ognuno ha almeno un sito di chiamata reale, fuori dalla propria dichiarazione e fuori dai commenti: per esempio findIssueFile e dichiarato a issue-store.mjs:322 e chiamato a 377, 434 e 460; validateIssueFileName e dichiarato a 363 e chiamato a 383 e 425."
    - "[2] Codici d errore - PASS. Confronto programmatico a tre vie: i codici emessi da scripts/issue-manager.mjs (18), quelli elencati dal testo di --help (18) e quelli della tabella di skills/harness/references/issues.md coincidono esattamente. Le quattro differenze insiemistiche sono tutte vuote: emessi ma non in --help = [], in --help ma non emessi = [], in --help ma non nella reference = [], emessi ma non nella reference = []. ID_COLLISION compare in --help in coda a STORAGE_NOT_MIGRATED e STORAGE_CONFLICT, ed e documentato nella reference a issues.md:639."
    - "[3] Payload di --upgrade - PASS, e per la via forte: le chiavi sono le stesse su ogni percorso, non soltanto dichiarate nei documenti. Lettura del codice: i due writeOk di upgradeTracker, a scripts/issue-manager.mjs:1071-1078 (percorso no-op) e 1187-1194 (percorso migrante), portano gli stessi sei campi from, to, migrated, issues, archivePath, resumed. Verificato a runtime su una directory temporanea con --project-dir esplicito, mai sul tracker reale: percorso migrante -> {from:3, to:4, migrated:0, issues:1, archivePath:<path assoluto dell archivio>, resumed:false}; secondo e terzo giro consecutivi (no-op) -> {from:4, to:4, migrated:0, issues:1, archivePath:null, resumed:false}. archivePath e resumed sono scritti come null e false, non omessi, esattamente come la reference dichiara ora a issues.md:235-238."
    - "[4] Commenti su issues.json - PASS. scripts/tracker-graph.mjs non nomina piu issues.json da nessuna parte: l unica occorrenza era nel commento di danglingDeps, che ora dice a hand edit of a tracker file (diff 6769512^..HEAD su quel file: una riga sola, -issues.json +a tracker file). In scripts/issue-manager.mjs tutte le occorrenze rimaste qualificano il file come legacy o come cosa che --upgrade porta via: riga 165 in a LEGACY issues.json, which is a different file answering a different question; 985 read the LEGACY issues.json ... The only remaining reader; 1035 move a project from the legacy issues.json tracker to Markdown issue files; 1048 the write order ... then the removal of issues.json; 1142 il caso dei due storage popolati. Ricerca mirata su tutti gli script delle formule che descrivevano il file come vivo (every clone, the live tracker, is the tracker, shared repository, committed) -> nessun riscontro in issue-manager.mjs o tracker-graph.mjs."
    - "[5] Validazione del nome in lettura singola - PASS, provata eseguendo e non solo leggendo. readIssue passa da parsedFile, che chiama validateIssueFileName a scripts/issue-store.mjs:383, la stessa funzione che readAllIssues chiama a 425. Su progetto temporaneo con --project-dir: (a) nome corretto backlog-11111111.md -> ok:true; (b) rinominato done-11111111.md con frontmatter status backlog -> ok:false, exit 1, Issue file done-11111111.md says done but the issue is backlog: rename it to backlog-11111111.md, or fix the status inside it; (c) prefisso fuori dai cinque stati, wibble-11111111.md -> ok:false, exit 1, does not match its id: expected backlog-11111111.md; (d) nome nudo 11111111.md, la nomenclatura precedente -> ok:false, exit 1, stesso rifiuto. Il file viene comunque trovato prima di essere rifiutato, perche findIssueFile e volutamente piu lasco (issue-store.mjs:326-334): la risposta e un rifiuto che nomina il file, non un NOT_FOUND fuorviante su una issue che sta li."
    - "[6] Ordine della rinomina - PASS, confermato per mutazione e non solo per esecuzione. Il test e a test/plugin-issue-store.test.mjs:368, a status change that fails to write leaves the issue where it was: fa fallire la scrittura dall interno (title 42) e pretende che l issue vecchia sia ancora leggibile e che la directory contenga esattamente backlog-11111111.md. Su copia intatta di HEAD in directory temporanea ho invertito le due operazioni di writeIssue, spostando il blocco rmSync(previousPath) prima del try che scrive il temporaneo e lo rinomina, e ho rilanciato la suite intera: tests 483, pass 482, fail 1, e l unico rosso e proprio quel test. Con l ordine corretto la suite e 483/483. Il presidio quindi osserva l ordine, non solo il suo esito."
    - "[7] Presidio nuovo sugli import orfani - provato per mutazione, non solo eseguito. Il test e a test/smoke.test.mjs:62, no script imports a name it never uses. Rimettendo renameSync nel blocco node:fs di scripts/issue-manager.mjs su una copia temporanea, la suite va rossa con scripts/issue-manager.mjs imports renameSync and never uses it: whatever called it is gone, ed e l unico test rosso del file (5 pass, 1 fail). Il presidio non e legato a quel singolo file: piantando appendFileSync in install-check.mjs e copyFileSync in status-cli.mjs lo stesso test fallisce nominando install-check.mjs."
    - "Collaterali: git status --short vuoto sia prima sia dopo la mia verifica. Il diff dell intero tratto 6769512^..HEAD tocca 9 path, tutti in scope: i due file della issue sotto .harness/issues/, scripts/issue-manager.mjs, scripts/issue-store.mjs, scripts/tracker-graph.mjs, skills/harness/references/issues.md, test/plugin-issue-manager.test.mjs, test/plugin-issue-store.test.mjs, test/smoke.test.mjs. Nessuna modifica alla configurazione e nessun segreto nel diff (scansione su api key, secret, password, token, chiavi private, ghp_, sk- -> zero riscontri). Tutte le prove della CLI sono girate su copie in directory temporanea con --project-dir esplicito: il tracker del progetto non ha ricevuto nessuna scrittura oltre a questa chiusura."
    - "Osservazioni fuori scope, non bloccanti. (a) I quattro validation.tasks risultano gia passati da false a true dentro il commit del worker 877b5cd: la spiegazione probabile e che il verificatore precedente li avesse spuntati via CLI senza chiudere la issue, e che quelle modifiche non committate siano finite nel commit successivo del worker. Li ho comunque riverificati tutti e quattro io in questo giro, quindi il checked: true che spedisco qui e mio e non ereditato. (b) node scripts/docs-gate.mjs riporta 3 commit di codice non coperti (f1c7e8c7, 2fad64c4, b40bf4e8): sono precedenti ed estranei a questa issue, e i due commit di questo tratto sono entrambi in covers. (c) Il test strutturale conta le parole e non compila: un nome citato in un commento maschererebbe un import inutilizzato, e il test non guarda ne const ne funzioni. Il limite e dichiarato nel commento del test stesso, e la mia scansione indipendente ha coperto anche quei due casi."
  tasks:
    -
      id: 1
      short_title: Verificare la rimozione del codice morto
      full_description: Cercare chiamanti delle funzioni rimosse e controllare che la suite completa resti verde.
      checked: true
    -
      id: 2
      short_title: Verificare help e payload
      full_description: Confrontare i codici elencati da --help con quelli della reference, e il payload di --upgrade sui due percorsi con cio' che i documenti dichiarano.
      checked: true
    -
      id: 3
      short_title: Verificare i commenti
      full_description: Rileggere i commenti dei due script cercando descrizioni di issues.json come tracker vivo.
      checked: true
    -
      id: 4
      short_title: Verificare i due presidi nuovi
      full_description: Provare la lettura singola su un nome fuori formato e su uno che contraddice il frontmatter, e controllare che il test dell ordine fallisca invertendo scrittura e cancellazione.
      checked: true
  state: pass
created_at: "2026-08-18T08:55:05Z"
updated_at: "2026-08-18T09:55:16Z"
revision: 1
---

# Residui e buchi di presidio dopo il travaso a storage Markdown

Il tratto che ha portato il tracker su file Markdown ha lasciato dietro di se' sei cose, tutte trovate dai verificatori e parcheggiate come fuori scope. writeIssuesFile e' codice morto da quando --upgrade ha smesso di riscrivere issues.json. --help elenca i codici d errore ma non ID_COLLISION. Il percorso idempotente di --upgrade restituisce { from, to, migrated } mentre i documenti dichiarano la sestupla, quindi chi legge archivePath su un no-op ottiene undefined. Una quindicina di commenti descrivono ancora issues.json come il tracker vivo. La validazione del nome di file vive solo in readAllIssues, quindi --get accetta un prefisso fuori dai cinque stati o che contraddice il frontmatter. E nessun test difende l ordine scrivi-poi-cancella della rinomina: la suite copre lo stato finale, non l invariante intermedia che rende quel disegno sicuro.
