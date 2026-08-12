# Approvazione visiva: il blocco task della card

Data: 2026-08-12
Issue: `663a70ae-48ba-4e41-b48d-27af3dc7843b`
Revisione approvata: `844a704` (preceduta da `f34aa50`)
Firma: il committente del repository

## Perché questo file esiste

La spec [2026-08-12-board-task-ui-design.md](../specs/2026-08-12-board-task-ui-design.md), sezione
6, sostituisce i criteri sull'estetica con un gate umano: il board viene avviato e il committente
approva o rifiuta guardandolo.

Quel gate, scritto come azione («l'utente ha guardato e ha approvato»), è **inverificabile da
chiunque non sia il committente**: nessun agente può controllare un'occhiata. Il verificatore
indipendente ha giustamente bloccato la issue —
[references/verification.md](../../../skills/harness/references/verification.md), sezione «Quando
la prova sta fuori dalla portata dell'agent» — e la regola prescrive che la riformulazione la firmi
il committente, mai chi ha svolto il lavoro.

Questo file è quella riformulazione: l'approvazione smette di essere un fatto avvenuto in sessione
e diventa un artefatto committato, che dichiara su quale revisione è stata data.

## Cosa è stato mostrato

Board avviato con `--project-dir` su una **fixture temporanea** fuori dal repository — il tracker
del progetto ha 44 issue chiuse e nessuna con task parziali, e `CLAUDE.md` vieta di scriverci
dentro dati di prova. La fixture portava i quattro casi che il rendering distingue:

| caso | cosa mostrava |
|---|---|
| `0/4` | barra vuota, tono neutro |
| `3/5` più `1/3` di validazione | barre parziali, la seconda dentro il riquadro *Validazione* |
| `3/3` | barra piena, tono `success` |
| nessun task | nessuna riga di riepilogo |

Espandendo i blocchi: icone lucide al posto dei marcatori `[x]`/`[ ]`, titolo barrato sui task
spuntati, conteggio in un badge.

La fixture è stata cancellata dopo l'approvazione e non è mai entrata nel controllo di versione.

## L'approvazione, verbatim

> va bene, chiudi il lavoro e passa alla verifica

e, dopo il `fail` del verificatore sul criterio inverificabile:

> approvo la feature, l'ho vista in azione sulla board lanciata

## Cosa questa firma non copre

Solo l'aspetto del blocco task alla revisione dichiarata. Non copre i criteri controllabili dalla
macchina — suite verde, attributi di `progressBar`, assenza di residui monospace, nessun test
perso, repository pulito — che restano in capo al verificatore indipendente e sono stati
soddisfatti tutti e cinque nel giro che ha bloccato la issue su questo solo punto.
