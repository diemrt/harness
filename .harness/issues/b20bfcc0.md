---
id: b20bfcc0-378a-4f1b-82b0-740b25a72cae
title: Il board delle issue e le tre volte che e' morto
status: done
tier: null
depends_on: []
covers: []
tasks: []
validation:
  tasks: []
  criteria:
    - "Archived originals: .harness/archive/2026-08-12T14-32-54Z.json"
    - d40ff6ad-a83b-457b-a9b5-dab45cb26497 - Board delle issue
    - "11e3060d-6efa-45b0-8b43-f0057015c46d - Il board esce dal clock-in: si avvia su richiesta, non da solo"
    - ac6892cb-b314-4fa1-93c0-25066808d550 - Il board muore se la directory del progetto e' un path 8.3
    - 7619689e-c007-4f0a-a94a-d253da55bcea - board.md non dice che il server canonicalizza la directory del progetto
    - 10a757b4-666a-4b1c-80cb-1f81e23170c1 - Il processo del board muore senza che nessuno lo sappia
    - "9fc8151f-450b-49f9-89a7-9552d3a97e4d - I due lettori dei task: la colonna di status-cli e le card del board"
  state: pass
created_at: "2026-08-12T14:32:54Z"
updated_at: "2026-08-12T14:32:54Z"
---

# Il board delle issue e le tre volte che e' morto

Il board live: la pagina, il server locale che la serve e i dati letti dal progetto. La decisione di toglierlo dal clock-in - si avvia su richiesta, mai di iniziativa propria - presa dopo tre morti in una sessione. Le due cause affrontate: fs.watch su una directory in forma 8.3, che faceva abortire il processo da dentro libuv, e il silenzio con cui il processo moriva, sostituito da una riga che lo dichiara sullo stesso stdout. Piu' la documentazione della canonicalizzazione e la prima resa dei task sulle card.
