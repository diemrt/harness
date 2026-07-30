---
description: Lancia la verifica indipendente di una issue delegandola all'agent harness-verifier. Senza argomenti sceglie fra le issue in in_review.
argument-hint: "[issue-id]"
allowed-tools: Bash, Task
---

Fai verificare una issue da un agente **diverso** da chi l'ha svolta. Il perché e i ruoli
sono in `${CLAUDE_PLUGIN_ROOT}/skills/harness/references/verification.md`; qui c'è solo come
si lancia.

## 1. Scegli la issue

`$1` è l'id, se l'utente l'ha passato. Se `$ARGUMENTS` è vuoto:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --get-all --status in_review
```

- una sola issue → è quella;
- più di una → elencale (`id` accorciato, `title`) e chiedi quale, non sceglierne una tu;
- nessuna → dillo e fermati. La verifica si fa su lavoro concluso: una issue ancora
  `in_progress` non è pronta, portala prima a `in_review`.

## 2. Delega, non verificare

**Non eseguire tu i controlli.** Nemmeno se il lavoro è piccolo, nemmeno se il gate è un
comando solo, e soprattutto **non se sei tu ad aver svolto la issue**: chi ha fatto il lavoro
trova quello che si aspetta di trovare, ed è esattamente il caso che questo comando esiste
per impedire. Il tuo compito è raccogliere il contesto e passare la mano.

Avvia l'agent `harness-verifier` (subagent dedicato, mai in linea) passandogli:

- l'**id** della issue;
- **cosa è stato prodotto**: file toccati e comandi eseguiti — `git status --short` e
  `git diff --stat` come punto di partenza, non il racconto di chi ha lavorato;
- il fatto che il gate è il comando `verify` di `.harness/config.json`.

Il verificatore legge i `validation.criteria`, li confronta con gli artefatti reali, esegue
il gate e **chiude lui la issue**: `done`/`pass` con l'evidenza, oppure `blocked`/`fail` con
il motivo. Non chiuderla tu, né prima né dopo di lui.

## 3. Riporta l'esito

- `pass` → la issue è `done`. Solo adesso è lecito committarla, da sola, come snapshot.
- `fail` → la issue è `blocked`. **Nessun commit.** Riporta il motivo così com'è: non
  discuterlo, non correggere al volo il difetto dentro questo comando, non rilanciare la
  verifica sperando in un esito diverso. Si riprende la issue, si corregge, si riverifica.
