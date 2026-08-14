# CLAUDE.md

Regole per chi sviluppa **questo repository**, non per chi usa harness (per quello:
[README.md](README.md); per il loop di sviluppo e il rilascio: [CONTRIBUTING.md](CONTRIBUTING.md)).

## Questo repository è il plugin, e lo usa su sé stesso

I file del plugin sono l'unica copia autorata: non esiste un template da cui rigenerarli né
una copia materializzata da tenere in sincrono. Allo stesso tempo questo progetto è il primo
consumer di harness — il suo sviluppo è tracciato in `issues.json` alla radice e procede col
workflow che il plugin impone (clock-in, una issue in corso per catena, verifica indipendente,
niente sul ramo condiviso prima del `pass`).

Conseguenza operativa: **ogni modifica al plugin va provata qui prima di essere rilasciata.**
Averla scritta e committata non basta, e nemmeno `npm test` basta: una skill, un agent o un
comando nuovo va invocato in una sessione reale di questo repository.

**Ma una sessione aperta qui non carica questo working tree**: carica la copia installata, anche
se la cwd è la radice del plugin. Misurato il 2026-08-14 — la skill harness annuncia come base
directory `~/.claude/plugins/cache/diemrt/harness/0.6.0/skills/harness`, e da lì discende anche
`$SCRIPTS`. Per provare davvero un componente serve quindi un giro di pubblicazione: merge, push,
`/plugin marketplace update diemrt`, riavvio della sessione. Gli script si continuano a provare
dal repository invocandoli per path (`node scripts/…`), che è la copia appena modificata.

## `issues.json` alla radice sono dati reali

Le issue in `issues.json` tracciano lo sviluppo di harness: non sono un fixture, non sono un
seed di esempio e non esiste una copia da cui recuperarle.

- **Non modificare `issues.json` a mano**, nemmeno un campo: si passa sempre da
  `node scripts/issue-manager.mjs` (contratto in `skills/harness/references/issues.md`), che è
  l'unico posto in cui vivono le validazioni dello schema.
- Non sovrascriverlo, non svuotarlo, non "resettarlo" per provare uno scenario: per esercitare
  il tracker si usa una directory temporanea, come fa già la suite di test.
