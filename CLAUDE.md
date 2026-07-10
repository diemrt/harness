# CLAUDE.md

Regole per chi sviluppa **questo pacchetto** (`@diemrt/harness`), non per chi lo consuma.
Questo file non fa parte di `template/`, non viene mai distribuito agli utenti del
pacchetto e non è gestito dall'harness: è esattamente per questo che le regole di sviluppo
del repository vivono qui, dove nessun `dev:sync`/`update` può sovrascriverle.

## `template/` è l'unica copia autorata

Tutto ciò che viene distribuito agli utenti (`issue-manager.mjs`, `init.mjs`,
`issues.html`, `docs/AGENTS-RULES.md`, `docs/GIT.md`, `docs/ISSUES.md`, e ogni altro file
`managed`) esiste in una sola copia autorata: quella dentro `template/`. Le copie
materializzate alla radice del repository sono un **output generato**, non un posto dove
scrivere codice.

- **Non editare mai** le copie alla radice di file gestiti (managed): `issue-manager.mjs`,
  `init.mjs`, `issues.html`, `docs/AGENTS-RULES.md`, `docs/GIT.md`, `docs/ISSUES.md`.
  Qualunque modifica lì viene persa (o peggio, segnalata come conflitto) alla successiva
  `npm run dev:sync`.
- Per cambiare uno di questi file: edita la versione in `template/`, poi esegui
  `npm run dev:sync` (= `node src/cli.mjs update .`) per propagare la modifica alla
  radice del repository. Il repository consuma il proprio harness (dogfooding), quindi
  ogni modifica al template va verificata anche qui prima di essere pubblicata.

## File `seeded-once`: root e `template/` sono contenuti separati

`AGENTS.md`, `docs/ARCHITECTURE.md` e `init.config.json` alla radice sono **seeded-once**:
di proprietà di questo repository, mai sovrascritti dall'harness. I loro omonimi dentro
`template/` sono le versioni generiche spedite agli utenti finali (skeleton da riempire in
ogni nuovo progetto). Sono **file separati con contenuto separato**: una modifica a uno dei
due **non** implica alcuna modifica automatica o manuale all'altro. Non copiare a mano il
contenuto della root dentro `template/` (o viceversa) pensando di "sincronizzarli": non
sono la stessa cosa.

## `issues.json`: dati reali vs seed

`issues.json` alla radice sono i dati reali di questo progetto (le issue che tracciano lo
sviluppo dell'harness stesso). `template/issues.json` è il seed vuoto spedito a ogni nuovo
consumer. Non confonderli mai:

- non copiare `issues.json` della root dentro `template/`;
- non aspettarsi che `template/issues.json` contenga le issue di questo repository.

## Prima di ogni commit

`npm run dev:check` (= `node src/cli.mjs update . --dry-run --json`) deve uscire pulito:
zero `updated`, zero `conflicts`. Il workflow CI (`.github/workflows/ci.yml`) esegue lo
stesso comando e fallisce la build se la radice ha divergenze rispetto a `template/`. Se
`dev:check` segnala qualcosa, non è "rumore da ignorare": vuol dire che la radice e
`template/` sono usciti di sincronia e va corretto prima di committare.

## Non usare mai `--force` alla radice del repository

`init --force` e `update --force` sovrascrivono qualunque file, incluse le policy
`seeded-once` e `data`. Alla radice di **questo** repository, `issues.json` contiene le 8
issue reali che tracciano il progetto: `init --force` (o `update --force` su un file che
risultasse in conflitto) le sovrascriverebbe con il seed vuoto del template, distruggendo
il lavoro di tracking del progetto. **Non lanciare mai `init` o `update` con `--force`
sulla radice di questo repository**, né per "provare", né in nessun altro caso. Se
`dev:sync`/`dev:check` segnalano un conflitto su un file managed, risolvilo a mano
(confrontando con il `.new` generato), mai forzando la sovrascrittura.
