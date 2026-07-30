# CLAUDE.md

Regole per chi sviluppa **questo repository**, non per chi usa harness (per quello:
[README.md](README.md); per il loop di sviluppo e il rilascio: [CONTRIBUTING.md](CONTRIBUTING.md)).

## Questo repository è il plugin, e lo usa su sé stesso

I file del plugin sono l'unica copia autorata: non esiste un template da cui rigenerarli né
una copia materializzata da tenere in sincrono. Allo stesso tempo questo progetto è il primo
consumer di harness — il suo sviluppo è tracciato in `issues.json` alla radice e procede col
workflow che il plugin impone (clock-in, una issue in corso per catena, verifica indipendente,
commit solo dopo il `pass`).

Conseguenza operativa: **ogni modifica al plugin va provata qui prima di essere rilasciata.**
Averla scritta e committata non basta, e nemmeno `npm test` basta: una skill, un agent o un
comando nuovo va invocato in una sessione reale di questo repository. I componenti appena
aggiunti diventano invocabili solo dopo un riavvio della sessione di Claude Code.

## `issues.json` alla radice sono dati reali

Le issue in `issues.json` tracciano lo sviluppo di harness: non sono un fixture, non sono un
seed di esempio e non esiste una copia da cui recuperarle.

- **Non modificare `issues.json` a mano**, nemmeno un campo: si passa sempre da
  `node scripts/issue-manager.mjs` (contratto in `skills/harness/references/issues.md`), che è
  l'unico posto in cui vivono le validazioni dello schema.
- Non sovrascriverlo, non svuotarlo, non "resettarlo" per provare uno scenario: per esercitare
  il tracker si usa una directory temporanea, come fa già la suite di test.
