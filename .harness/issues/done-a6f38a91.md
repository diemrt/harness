---
id: a6f38a91-e7fe-415b-907d-9c524a368952
title: status.md descrive ancora l'eta' del tracker in coda alla riga
status: done
tier: economy
depends_on: []
covers: [acb9885, 995a502]
tasks:
  -
    id: 1
    short_title: Esempi della riga e paragrafo sotto
    full_description: "In skills/harness/references/status.md, capitolo '--oneline': le due righe di esempio finiscono con 'T @ 16:34:50', e il paragrafo che le segue dice che in coda c'e' l'ora di questa lettura, non piu' da quanto il tracker non viene scritto."
    checked: true
  -
    id: 2
    short_title: Titolo e corpo del capitolo coda
    full_description: "'### La coda della riga: 3m 12s @ 16:34:50' diventa '### La coda della riga: T @ 16:34:50'. Il corpo spiega un dato solo — l'istante del render — e perche' non ha rami: 'adesso' e' sempre conoscibile. Via i due paragrafi sui due dati e sul last_updated mancante."
    checked: true
  -
    id: 3
    short_title: Rimuovere il capitolo dell'eta'
    full_description: "Cancellare per intero \"#### L'eta' del tracker\" (righe ~125-149): tabella dei tre scaglioni, secondi che non spariscono, eta' che misura il tracker, ritorno a 0s come ricevuta."
    checked: true
  -
    id: 4
    short_title: Ripulire il riferimento all'eta' congelata
    full_description: Nel capitolo sull'ora del render, la frase 'tutta la riga si congela, eta' compresa' e il paragrafo che smaschera un'eta' ferma vanno riscritti senza nominare l'eta'. Idem la riga di --color che descriveva la coda come 'eta' e ora insieme'. Il resto dei capitoli resta intatto.
    checked: true
  -
    id: 5
    short_title: Gate, test e coerenza degli esempi
    full_description: node scripts/docs-gate.mjs non elenca piu' acb9885 ne' 995a502; npm run test esce 0; gli esempi in status.md coincidono con l'output reale di node scripts/status-cli.mjs --oneline.
    checked: true
validation:
  criteria: "npm run test: 408/408 pass, exit 0. node scripts/docs-gate.mjs: 0 non coperti (acb9885 e 995a502 non piu elencati). skills/harness/references/status.md: nessuna occorrenza di 12s @, 3m 12s, 1h 2m 12s (grep vuoto); capitolo La coda della riga (riga 90) titolato T @ 16:34:50 e descrive un solo dato senza menzionare last_updated mancante; capitolo su L'eta del tracker con tabella dei tre scaglioni assente dal file (grep vuoto); capitolo sull'ora del render (righe 103-125, misura 2026-08-13) presente parola per parola tranne il riferimento all'eta congelata, rimosso anche nella riga --color (riga 131: etichetta e ora insieme). Esempi di riga (righe 66-67, formato ...T @ 16:34:50) coincidono nella forma con l'output reale di node scripts/status-cli.mjs --oneline eseguito ora: 1 in verifica [5/5] | 6 backlog | 14 chiuse | T @ 17:40:06. git show --stat 7324803: solo issues.json e status.md toccati, docs/superpowers/ intatti. Nessun file modificato dalla verifica oltre alla chiusura della issue; la modifica non committata di issues.json (last_updated, status in_progress-in_review) era gia presente prima della verifica."
  tasks:
    -
      id: 1
      short_title: Esempi e prosa di --oneline
      full_description: Le due righe di esempio del capitolo --oneline e il paragrafo che le segue parlano della sola ora della lettura, non piu' di 'da quanto il tracker non viene scritto'.
      checked: false
    -
      id: 2
      short_title: Capitolo della coda riscritto
      full_description: "'### La coda della riga' porta il titolo 'T @ 16:34:50' e spiega un dato solo: l'istante del render, che c'e' sempre perche' 'adesso' e' sempre conoscibile. Via il paragrafo dei due dati attaccati dalla @."
      checked: false
    -
      id: 3
      short_title: Via il capitolo dell'eta'
      full_description: "Rimosso per intero \"#### L'eta' del tracker\": tabella dei tre scaglioni, secondi che non spariscono, eta' che misura il tracker, ritorno a 0s come ricevuta."
      checked: false
    -
      id: 4
      short_title: Gate e test
      full_description: node scripts/docs-gate.mjs non elenca piu' i due commit, e npm run test esce 0.
      checked: false
  state: pass
created_at: "2026-08-13T15:35:48Z"
updated_at: "2026-08-13T15:42:28Z"
revision: 1
---

# status.md descrive ancora l'eta' del tracker in coda alla riga

skills/harness/references/status.md promette una coda che il comando non stampa piu'. Gli esempi mostrano "12s @ 16:34:50" e "1h 2m 12s @ 16:34:50", il capitolo "La coda della riga" spiega due dati invece di uno, e un intero capitolo ("L'eta' del tracker", con la tabella dei tre scaglioni e il ritorno a 0s come ricevuta di scrittura) descrive un campo rimosso. Chi legge la reference prima di guardare l'output impara una cosa falsa.

Copre due commit che il gate documentale segnala scoperti. In acb9885 la coda e' diventata "T @ 16:34:50" e l'eta' e' sparita dal codice; in 995a502 era nata l'ora del render, e la sua parte di status.md era stata scritta nello stesso commit senza che nessuna issue la dichiarasse. Il capitolo si riscrive una volta sola e chiude entrambi.

Quello che resta vero non si tocca: il capitolo sull'ora del render regge parola per parola, tolto il riferimento all'eta' che si congela con la riga. I documenti sotto docs/superpowers/ (referto, spec, piano) restano com'erano: registrano decisioni prese in un momento, non sono reference da mantenere allineata.
