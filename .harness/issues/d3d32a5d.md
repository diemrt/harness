---
id: d3d32a5d-ca41-447b-aae3-fc254351964d
title: La riga di stato puo' restare ferma per minuti, e il documento dice il contrario
status: done
tier: standard
depends_on: [6a0ee313-df2e-4899-bdc3-3dcc1132836e]
covers: ["7123928"]
tasks:
  -
    id: 1
    short_title: I test dell'orario prima del codice
    full_description: "In test/plugin-status-cli.test.mjs: l'orario locale HH:mm:ss in coda, la forma '3m 12s @ 16:34:50', il solo orario senza last_updated, riga vuota su tracker vuoto, ASCII, nessun ANSI senza --color. Rossi prima di toccare lo script."
    checked: true
  -
    id: 2
    short_title: L'orario di render nella riga
    full_description: "Funzione accanto a formatAge che rende l'istante del render in ora locale HH:mm:ss, e renderOneline che chiude la riga con essa. Il 'now' resta iniettabile, come per formatAge, cosi' il test non dipende dall'orologio."
    checked: true
  -
    id: 3
    short_title: "status.md: la frase falsa e il limite dell'eta'"
    full_description: "Via l'affermazione che il confine di turno coincide con l'unico momento in cui i conteggi cambiano. Al suo posto: l'ospite puo' smettere di invocare il comando, l'eta' misura il tracker e non la riga, l'orario e' il colpo d'occhio."
    checked: true
  -
    id: 4
    short_title: "status.md: watch come rete di sicurezza"
    full_description: Il pannello watch smette di essere la terza ricetta alla pari e diventa la raccomandazione per chi vuole un dato che sopravviva a un ospite congelato. La ricetta Claude Code porta refreshInterval col suo limite misurato.
    checked: true
  -
    id: 5
    short_title: Il referto sotto docs/, col log grezzo
    full_description: "Il referto della misura va in docs/superpowers/analisi/, con probe.log allegato: e' la prova che regge 'non e' harness' quando qualcuno la rimettera' in discussione. Adesso vive in scratchpad, che e' effimero."
    checked: true
  -
    id: 6
    short_title: Suite verde, allineamento, in_review
    full_description: "npm test verde. Task allineati prima del commit, poi la issue va in in_review per la verifica indipendente: non la chiudo io."
    checked: true
validation:
  criteria: "Verifica indipendente sul commit 995a502 (feature/ergonomia-emessa), probe su copie del tracker in directory temporanea con --project-dir esplicito: il tracker reale non e' mai stato scritto se non dalla chiusura. (1) Orario locale: node scripts/status-cli.mjs --oneline --project-dir <copia> => '1 in verifica [6/6] | 6 backlog | 12 chiuse | 1m 51s @ 17:04:35', con Get-Date HH:mm:ss = 17:04:35 e UTC = 15:04:35 (TZ W. Europe): e' l'ora locale del render, non UTC, e chiude la riga. formatClock in scripts/status-cli.mjs:159-163 usa getHours/getMinutes/getSeconds con padStart, now iniettabile. (2) Forma: tracker con last_updated 2026-08-13T12:00:00Z => '1 in corso | 3h 4m 47s @ 17:04:47' (eta' @ orario); tracker senza last_updated => '1 in corso | 17:04:47', solo orario e nessun segnaposto; tracker con issues: [] => stdout vuoto (2 byte con il newline). Le tre degradazioni di b2c59231 reggono: directory senza issues.json, issues.json malformato ('{ not json at all') e --project-dir inesistente danno tutti exit=0 e riga vuota, nessun orario solitario. (3) Contratto ASCII/colore: riga di default senza byte 0x1b, match /^[\\\\x20-\\\\x7e]*$/ = True, zero codepoint fuori 32-126; con --color escape presenti (SGR 33/90/32 sui conteggi, 90 sulla coda 'eta' @ orario') e togliendo gli escape con /\\\\x1b\\\\[[0-9;]*m/ si riottiene carattere per carattere la riga in chiaro. Il conteggio [6/6] della issue unica in volo (38eb7b1a) e le tre forme dell'eta' (6a0ee313) restano. (4) skills/harness/references/status.md: la frase 'Coincide con l'unico momento in cui i conteggi possono essere cambiati davvero' non c'e' piu' in nessun punto del file (grep su 'unico momento|confine di turno|coincide' nel repo: nel file resta solo la riga 261 '**Il refresh non coincide con i momenti in cui i conteggi cambiano.**'), e la riga 103 dichiara '**L'ospite puo' smettere di invocare il comando.**' con il rimando al referto. (5) status.md righe 243 e 256-259: 'Un pannello a fianco, e questa e' la rete di sicurezza' e 'Non e' la terza ricetta alla pari: e' l'unica che non dipende dall'ospite'; la ricetta Claude Code (righe 216-233) porta refreshInterval: 10 col limite misurato (10,0s esatti, e una finestra di otto minuti senza una sola invocazione). (6) docs/superpowers/analisi/2026-08-13-riga-di-stato-ferma.md committato (197 righe) con probe.log (46 righe, START/END con pid e durata) e probe.mjs accanto: numeri del 2026-08-13 (23 invocazioni, 10,0s, ultima 14:34:50.806, tre scritture nel silenzio, 71-117ms) e la sezione 'Cosa e' dimostrato, e cosa no' (righe 116-133) che separa i tre fatti dimostrati dalla causa, dichiarata non dimostrata perche' il blocco comincia circa un minuto prima del lancio del subagent. (7) Gate .harness/config.json 'npm run test': tests 413, pass 413, fail 0, duration_ms 27309. Danni collaterali: git status --short mostra solo ' M issues.json' (passaggio a in_review); il commit tocca solo scripts/status-cli.mjs, test/plugin-status-cli.test.mjs, skills/harness/references/status.md, i tre file nuovi sotto docs/ e il record di questa issue. Nessun segreto nel diff. Osservazioni fuori scope, non bloccanti: docs/superpowers/analisi/2026-08-13-substrato-del-tracker.md:532 ripete ancora la frase smentita (documento storico, fuori dai criteri); ONELINE_COLOR.age e' stato rinominato in .tail su un export pubblico, senza consumatori fuori dallo script; probe.mjs committato contiene path assoluti col nome utente, scelta dichiarata nel referto."
  tasks:
    -
      id: 1
      short_title: L'orario di render chiude la riga
      full_description: "HH:mm:ss in ora locale, ASCII. E' il rimedio al difetto vero: rende la riga morta riconoscibile in un istante contro un riferimento esterno, invece che aspettando di vederla cambiare."
      checked: true
    -
      id: 2
      short_title: Eta' e orario convivono senza ambiguita'
      full_description: "'3m 12s @ 16:34:50' - l'eta' e' il dato, l'orario dice quando e' stato preso. Senza last_updated resta il solo orario. Tracker vuoto: riga vuota, come sempre."
      checked: true
    -
      id: 3
      short_title: Il contratto ASCII e opt-in regge
      full_description: "Solo ASCII di default, ANSI solo con --color, e togliendo gli escape si riottiene la riga in chiaro. Sono criteri gia' verificati su tre issue: incrinarli qui sarebbe una regressione silenziosa."
      checked: true
    -
      id: 4
      short_title: La frase falsa sul refresh non c'e' piu'
      full_description: Il paragrafo che dichiara il confine di turno 'l'unico momento in cui i conteggi possono essere cambiati davvero'. La misura lo smentisce, e insegnare che una riga ferma e' innocua e' il danno stesso.
      checked: true
    -
      id: 5
      short_title: Il pannello watch come rete di sicurezza
      full_description: "Oggi le tre ricette sono alla pari. Il pannello watch e' un processo dell'utente e sopravvive a un ospite congelato: va raccomandato come tale, non elencato accanto alle altre."
      checked: true
    -
      id: 6
      short_title: Il referto committato, prova e correlazione separate
      full_description: "Dimostrato: l'ospite smette di chiamare, non uccide. Non dimostrato: la causa. Il blocco comincia un minuto prima che il subagent parta. Un referto che confonde le due cose vale meno di nessun referto."
      checked: true
    -
      id: 7
      short_title: Suite verde
      full_description: npm test verde, che e' il gate di .harness/config.json.
      checked: true
  state: pass
created_at: "2026-08-13T14:43:25Z"
updated_at: "2026-08-13T15:08:03Z"
---

# La riga di stato puo' restare ferma per minuti, e il documento dice il contrario

Misurato il 2026-08-13 con una sonda strumentata, mentre si lavorava 6a0ee313. Senza subagent: 23 invocazioni della riga, refreshInterval che scatta ogni 10.0s esatti. Poi ZERO invocazioni per 8m02s, con tre scritture del tracker dentro quella finestra. Zero START senza END: il comando non viene ucciso a meta', non viene chiamato. Ogni invocazione registrata ha reso il valore corretto - non e' harness, che rilegge issues.json a ogni lancio. Ne' TaskStop sul subagent, ne' il config riscritto, ne' due confini di turno l'hanno riavviata: serve riavviare la sessione.

La causa a monte e' dell'ospite. Il danno che ci riguarda e' un altro: non c'era modo di accorgersene. Alle 14:45 la riga morta mostrava '7 backlog | 12 chiuse', per coincidenza i numeri esatti.

Due rimedi. Sulla riga: l'orario del render. Siccome non c'e' cache, l'ora del render E' la freschezza del dato, e si controlla con l'orologio che si ha gia' sotto gli occhi invece che aspettando quindici secondi. E' una funzione accanto a formatAge, il wiring, i test, il documento. Nel documento: la frase che dichiara innocuo un render congelato, il limite dell'eta', e il pannello watch come rete di sicurezza.
