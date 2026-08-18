# AGENTS.md

Questo repository **è** il plugin harness per Claude Code: issue tracciate in `.harness/issues/`,
una sola issue in corso per catena di dipendenza, verifica indipendente obbligatoria prima di
pubblicare sul ramo condiviso. Cosa fa e come si installa: [README.md](README.md).

Qui non sono scritte regole operative, per non averne due versioni:

- le regole di harness sono la skill del plugin — `skills/harness/SKILL.md` e
  `skills/harness/references/`, fonte autorevole, da seguire alla lettera;
- le regole per sviluppare questo repository sono in [CLAUDE.md](CLAUDE.md);
- il loop di sviluppo, la struttura delle cartelle e il rilascio sono in
  [CONTRIBUTING.md](CONTRIBUTING.md).

Se stai lavorando qui con una CLI che non carica i plugin di Claude Code (il caso del worker
esterno), leggi la skill come un documento qualsiasi: gli script stanno in `scripts/`, quindi
`${CLAUDE_PLUGIN_ROOT}` corrisponde alla radice di questo repository.
