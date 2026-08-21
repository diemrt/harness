---
id: b4aeec33-63b4-42b7-9872-aa16ff7d9212
title: Il riepilogo del tracker a riga di comando
status: done
tier: null
depends_on: []
covers: []
tasks: []
validation:
  tasks: []
  criteria:
    - "Archived originals: .harness/archive/2026-08-12T14-32-54Z.json"
    - "74d2b630-f4de-4b94-99da-741562328fbe - status-cli: contratto della riga di comando e codici d'uscita"
    - "6a53d9c8-f41e-44f0-9536-279de693e938 - status-cli: costanti, conteggi e sezione delle issue in corso"
    - "9c45bfd7-977f-4e00-84b6-9c42545ae0c1 - status-cli: intestazione, barra proporzionale e legenda degli stati"
    - "f2595673-a499-4185-b86d-33034431560f - status-cli: sezioni in corso e lavorabili, con troncamento a 45 colonne"
    - "59819a08-06da-481c-9a4f-ba948c5432ec - status-cli: allerte su cicli, dipendenze fantasma e stallo"
    - "0fe39c8a-a84b-466b-9e39-b3d7912dcaf5 - status-cli: issue lavorabili e dipendenze fantasma"
    - "aa07fb72-713c-4d65-bba9-6e1399652813 - Stallo e intestazione LAVORABILI: 'N di M' con due denominatori diversi"
    - "b6b848b9-26e4-49c1-9037-71207f958c5c - status-cli: resa delle allerte e dei casi vuoti"
    - 90048eaf-d5bc-42d5-a7d9-f41dc3c40a56 - Riepilogo del tracker a clock-in e a clock-out
    - "8718f44a-2a45-40f5-9735-7ee3501cccf4 - Slash command /harness:status"
    - 1b7587bf-a25d-4caa-bd63-810dde5fef2e - Gate documentale dei nove commit di status-cli
  state: pass
created_at: "2026-08-12T14:32:54Z"
updated_at: "2026-08-12T14:32:54Z"
revision: 1
---

# Il riepilogo del tracker a riga di comando

status-cli.mjs per intero, dal contratto della riga di comando alla resa. Codici d'uscita e canali; costanti, conteggi e sezione delle issue in corso; intestazione, barra proporzionale e legenda; sezioni con troncamento a 45 colonne. Le allerte su cicli, dipendenze fantasma e stallo, e la correzione dei due denominatori diversi nell'intestazione LAVORABILI. Piu' i due punti in cui il riepilogo e' entrato nel workflow: il passo di clock-in e clock-out e lo slash command /harness:status, e il gate documentale dei nove commit che lo hanno prodotto.
