---
id: 6a0ee313-df2e-4899-bdc3-3dcc1132836e
title: L'eta' del tracker nella riga di stato, e come agganciarla
status: done
tier: standard
depends_on: []
covers: []
tasks:
  -
    id: 1
    short_title: I test dell'eta' prima del codice
    full_description: "In test/plugin-status-cli.test.mjs: formatAge nei tre scaglioni (12s, 3m 12s, 1h 2m 12s), last_updated assente o non interpretabile che non produce nulla, riga ancora dentro [\\x20-\\x7e], nessun ANSI senza --color. Rossi prima di toccare lo script."
    checked: true
  -
    id: 2
    short_title: "formatAge: tre scaglioni, secondi sempre"
    full_description: "In scripts/status-cli.mjs accanto a formatWhen: da last_updated e now a '12s' / '3m 12s' / '1h 2m 12s'. null se il campo manca o non e' una data. Futuro (skew d'orologio) si appiattisce a 0s invece di un'eta' negativa. Esportata, cosi' i tre scaglioni si provano senza passare dalla riga."
    checked: true
  -
    id: 3
    short_title: L'eta' chiude la riga, e onelineFor la passa
    full_description: "renderOneline prende lastUpdated e now fra le opzioni e chiude la riga con l'eta' dopo il marcatore '!'. onelineFor legge data.last_updated. Tracker vuoto: riga vuota, nessuna eta'. Sotto --color l'eta' e' grigia, e togliendo gli escape si riottiene la riga in chiaro. USAGE aggiornata."
    checked: true
  -
    id: 4
    short_title: Il test di processo che vede il battito
    full_description: "Due esecuzioni di --oneline sullo stesso tracker separate da un'attesa: la seconda eta' e' maggiore della prima. E' il test che dimostra il battito, non solo il formato."
    checked: true
  -
    id: 5
    short_title: "references/status.md: l'eta' come battito"
    full_description: "Sotto '--oneline': cosa significa l'eta', perche' i secondi non spariscono mai, come si legge quando si sospetta una riga morta, e che il ritorno a 0s e' la conferma che la modifica e' atterrata."
    checked: true
  -
    id: 6
    short_title: "references/status.md: le ricette d'aggancio"
    full_description: "statusLine di Claude Code, tmux status-right, watch in un pannello: ognuna copiabile senza modifiche oltre ai path, con --project-dir dove la cwd dell'ospite non e' garantita e la nota su Windows dove watch non c'e'."
    checked: true
  -
    id: 7
    short_title: Suite verde e allineamento al commit
    full_description: npm test verde, che e' il gate di .harness/config.json. Task allineati prima del commit, poi la issue va in in_review per la verifica indipendente.
    checked: true
validation:
  criteria: "Verifica indipendente sul commit 7123928 (feature/ergonomia-emessa). (1) formatAge/renderOneline provati fuori dalla suite con un probe mio: 12s / 3m 12s / 1h 2m 12s; riga completa '1 in corso | 1 in verifica | 3 backlog | 9 chiuse ! | 1h 2m 12s' - l'eta' chiude la riga dopo il marcatore ! e i secondi restano nei tre scaglioni (3600s -> 1h 0m 0s). (2) lastUpdated null/undefined/vuoto/'not a date' -> formatAge null e riga senza eta' ne' segnaposto; a livello di processo un issues.json privo di last_updated stampa '1 in corso' ed esce 0. Timestamp futuro appiattito a 0s. (3) /^[\\x20-\\x7e]*$/ vera sulla riga con e senza eta'; il default non contiene 0x1b, con --color l'eta' e' 90m ... 0m e togliendo gli escape si riottiene esattamente la riga in chiaro. (4) Battito verificato sul processo da me: due esecuzioni di --oneline --project-dir su tracker temporaneo, '1 in corso | 0s' poi '1 in corso | 2s'; esiste anche il test omologo in test/plugin-status-cli.test.mjs. (5) skills/harness/references/status.md righe 90-127: sezione sull'eta' come battito, perche' i secondi non spariscono, come si legge una riga sospetta, e 'Il ritorno a 0s e' la conferma che una modifica e' atterrata' - claim confermato in scripts/issue-manager.mjs:927 che riscrive last_updated a ogni salvataggio. (6) status.md righe 173-215: legenda <plugin>/<progetto>, --project-dir in tutte e tre le ricette, statusLine di Claude Code in JSON valido, tmux status-right con status-interval, watch -n 5, piu' il ciclo PowerShell per Windows dove watch non c'e'. (7) Gate .harness/config.json (npm run test): tests 410, pass 410, fail 0, duration_ms 26543. git status --short: solo ' M issues.json' col clock-out della issue, nessun file collaterale ne' segreti nel diff. Osservazione fuori scope: la ricetta watch passa il comando come argv non quotato, quindi un path con spazi andrebbe racchiuso in apici; non incide sui criteri."
  tasks:
    -
      id: 1
      short_title: L'eta' nei tre scaglioni, secondi sempre presenti
      full_description: "12s sotto il minuto, 3m 12s sotto l'ora, 1h 2m 12s oltre. I secondi restano in tutti e tre: senza, sopra il minuto il battito si ferma e non si distingue da una riga morta."
      checked: true
    -
      id: 2
      short_title: last_updated assente non produce segnaposto
      full_description: "Coerente con le parentesi dei task: quando non c'e' niente da dire non si occupa spazio per dirlo."
      checked: true
    -
      id: 3
      short_title: Il contratto ASCII e opt-in regge
      full_description: "L'aggiunta non deve incrinare i criteri gia' verificati di b2c59231 e 38eb7b1a: solo ASCII di default, ANSI solo con --color."
      checked: true
    -
      id: 4
      short_title: Un test vede l'eta' crescere
      full_description: Due letture del processo separate da un'attesa, e la seconda mostra un'eta' maggiore. E' il test che dimostra il battito, non solo il formato.
      checked: true
    -
      id: 5
      short_title: La documentazione dell'eta'
      full_description: references/status.md spiega che l'eta' e' battito e informazione insieme, e come si legge quando si sospetta una riga morta.
      checked: true
    -
      id: 6
      short_title: Le ricette d'aggancio, complete
      full_description: statusLine di Claude Code, tmux status-right, watch in un pannello. Copiabili senza modifiche oltre ai path, cosi' chi installa harness non deve ricordarsele.
      checked: true
    -
      id: 7
      short_title: Suite verde
      full_description: npm test verde, che e' anche il gate di .harness/config.json.
      checked: true
  state: pass
created_at: "2026-08-13T13:39:00Z"
updated_at: "2026-08-13T14:12:23Z"
revision: 1
---

# L'eta' del tracker nella riga di stato, e come agganciarla

La riga di stato non dice se e' viva. Il comando rilegge issues.json a ogni esecuzione e non ha cache, quindi se gira e' allineato per costruzione: l'unico disallineamento possibile e' non girare. Ma una riga ferma e una riga aggiornata che mostra lo stesso valore sono indistinguibili, e il 2026-08-13 il committente ha guardato per minuti una riga morta credendola aggiornata.

Serve un battito che sia anche informazione: l'eta' di last_updated in coda alla riga. Formato 12s, poi 3m 12s, poi 1h 2m 12s - i secondi restano sempre, altrimenti sopra il minuto il battito si ferma per sessanta secondi e non si distingue piu' da una riga morta. Appena il tracker viene scritto torna a 0s, ed e' la conferma che la modifica e' atterrata.

Nello stesso giro la sezione sugli ospiti di references/status.md diventa un vero 'come lo agganci al tuo progetto': oggi le ricette ci sono ma abbozzate, e chi installa harness deve ricordarsele.
