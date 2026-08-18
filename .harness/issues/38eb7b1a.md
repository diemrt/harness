---
id: 38eb7b1a-73d0-458a-b746-125fad0a0c7f
title: Conteggio dei task e colore opzionale nella riga di stato
status: done
tier: standard
depends_on: []
covers: []
tasks:
  -
    id: 1
    short_title: Il default resta senza un byte di escape
    full_description: renderOneline senza opzioni e --oneline senza --color non emettono 0x1b. Test sulla funzione e sul processo. E' il contratto di b2c59231.
    checked: true
  -
    id: 2
    short_title: --color aggiunge vernice, non contenuto
    full_description: Flag --color su parseArgs, helper paint(), e ONELINE_COLOR con i codici SGR. Un test toglie gli escape e asserisce l'identita' con la riga in chiaro.
    checked: true
  -
    id: 3
    short_title: "soleInFlight: il conteggio solo quando e' univoco"
    full_description: Il conteggio compare solo se in_progress + in_review vale esattamente 1. Test per una in corso, una in verifica, e due insieme.
    checked: true
  -
    id: 4
    short_title: Nessuna parentesi vuota, nessun blocked
    full_description: Una issue senza task non stampa parentesi; una blocked da sola non porta il conteggio.
    checked: true
  -
    id: 5
    short_title: I test di b2c59231 non vengono toccati
    full_description: "Solo aggiunte in coda al file di test: git diff --numstat deve mostrare 0 cancellazioni."
    checked: true
  -
    id: 6
    short_title: references/status.md segue il codice
    full_description: Sezioni nuove sul conteggio (con la regola dell'unica issue in volo e il perche' delle parentesi) e su --color (opt-in, e il motivo).
    checked: true
  -
    id: 7
    short_title: Suite verde
    full_description: "npm test verde: 394 test, 0 falliti."
    checked: true
  -
    id: 8
    short_title: Commit
    full_description: git add di scripts/status-cli.mjs, test/plugin-status-cli.test.mjs, skills/harness/references/status.md e issues.json.
    checked: true
validation:
  criteria: "Gate: npm run test dalla radice => tests 394, pass 394, fail 0, duration_ms 19334. C6 (il criterio portante): git diff --numstat ed2ad0d HEAD -- test/plugin-status-cli.test.mjs => 94 aggiunte, 0 cancellazioni. Zero cancellazioni su tutto lo intervallo dal commit di chiusura di b2c59231 a HEAD e9afede: nessuna asserzione di B tolta o rilassata. I test nuovi sono inseriti a meta file (righe 757-849) e non in coda, ma solo in aggiunta, quindi il criterio regge. Restano verbatim riga 880 (1 in corso | 1 chiuse) e riga 754 (match ASCII 0x20-0x7e). C1: probe di processo su tracker temporanei costruiti fuori dal repo (TEMP/harness-verify-38eb7b1a) con --project-dir esplicito, stdout catturato come buffer e contato byte a byte. Con una issue in volo: 1 in corso [1/3] | 1 backlog | 1 chiuse => 0 byte 0x1b. Senza issue in volo: 1 backlog | 1 chiuse => 0 byte 0x1b. C2: --color sullo stesso tracker => 6 byte 0x1b, sequenze SGR 36 su in corso, 90 su backlog, 32 su chiuse, ciascuna chiusa da 0m. Togliendo gli escape con la regex SGR si riottiene la riga in chiaro carattere per carattere: uguaglianza stretta verificata in-process. Il colore aggiunge vernice, non contenuto. C3: tracker con una in_progress (2 task) e una in_review (4 task) => 1 in corso | 1 in verifica | 1 chiuse, nessuna parentesi quadra. Con una sola issue in volo le parentesi ci sono: [1/3]. C4: tracker con una in_progress senza task => 1 in corso | 1 chiuse, nessuna parentesi e nessuna coppia vuota. C5: tracker con una sola blocked con 5 task => 1 bloccate | 1 chiuse, nessun conteggio. C7: gate verde piu references/status.md righe 74-87 (conteggio, regola della unica issue in volo, motivo delle parentesi quadre) e righe 89-98 (--color opt-in, col motivo per cui non e il default). Danni collaterali: git status --short vuoto. git diff --numstat ed2ad0d HEAD tocca solo issues.json, scripts/status-cli.mjs, skills/harness/references/status.md, test/plugin-status-cli.test.mjs. Osservazione fuori scope, non bloccante: scripts/status-cli.mjs riga 360, il messaggio di errore su flag sconosciuto dice ancora che lo script accetta solo --project-dir e --help, mentre ora accetta anche --oneline e --color."
  tasks:
    -
      id: 1
      short_title: Il default resta senza ANSI
      full_description: Un test asserisce che renderOneline senza opzioni non contiene 0x1b, e un test di processo lo asserisce su --oneline senza --color. E' il contratto di b2c59231 e non deve incrinarsi.
      checked: true
    -
      id: 2
      short_title: --color aggiunge vernice, non contenuto
      full_description: "Un test toglie gli escape dalla riga colorata con /\\x1b\\[[0-9;]*m/g e asserisce che il risultato e' identico alla riga in chiaro. Cosi' il colore non puo' introdurre o perdere testo di nascosto."
      checked: true
    -
      id: 3
      short_title: Il conteggio compare solo quando e' univoco
      full_description: "Test per una sola issue in corso, una sola in verifica, e due insieme: nei primi due il conteggio c'e', nel terzo sparisce."
      checked: true
    -
      id: 4
      short_title: Nessuna parentesi vuota, nessun blocked
      full_description: Una issue in volo senza task non stampa parentesi; una issue blocked da sola non porta il conteggio perche' non e' il lavoro in corso.
      checked: true
    -
      id: 5
      short_title: I test di b2c59231 non vengono toccati
      full_description: "git diff --numstat su test/plugin-status-cli.test.mjs deve mostrare 0 cancellazioni: le asserzioni che hanno fatto passare b2c59231 restano verbatim."
      checked: true
    -
      id: 6
      short_title: La documentazione segue il codice
      full_description: references/status.md descrive il conteggio, la regola dell'unica issue in volo, e --color con il motivo per cui non e' il default.
      checked: true
    -
      id: 7
      short_title: Suite verde
      full_description: npm test verde, che e' anche il gate di .harness/config.json.
      checked: true
  state: pass
created_at: "2026-08-13T10:35:10Z"
updated_at: "2026-08-13T12:36:06Z"
---

# Conteggio dei task e colore opzionale nella riga di stato

La riga di stato mostra i conteggi ma non dice a che punto e' il lavoro in corso, e resta in bianco e nero anche dove l'ospite saprebbe colorarla. Richiesta del committente il 2026-08-13.

Due aggiunte. Il conteggio [fatti/totali] dei task compare solo quando c'e' ESATTAMENTE una issue in volo fra in_progress e in_review: con due, quel numero sarebbe il progresso di quale? Un numero che ha bisogno di una domanda per essere letto e' peggio di nessun numero. Le parentesi quadre fanno da icona perche' in questo repository significano gia' checklist.

Il colore arriva dietro un flag --color esplicito, mai di default: il contratto di b2c59231 dice ASCII puro perche' la riga finisce in tmux o in un prompt PowerShell, e quel contratto non si tocca. La spec prevedeva gia' questa via d'uscita.

Nota per chi verifica: il codice e' stato scritto PRIMA che questa issue esistesse, su richiesta diretta, e la issue e' stata aperta dopo per riportare il lavoro dentro il processo. Guarda gli artefatti, non l'ordine.
