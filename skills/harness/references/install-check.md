# Controllo dell'installazione

Confronta la copia di harness che Claude Code ha installato con il repository da cui dovrebbe
venire, e dice se quello che gli altri progetti caricano è quello che qui viene verificato.

**Non è un passo del workflow.** Non si esegue al clock-in, non riguarda le issue e non tocca
nessun tracker: parla di una macchina, non di un progetto. Lo esegue chi rilascia — il passo sta
in [CONTRIBUTING.md](../../../CONTRIBUTING.md), sezione *Releasing* — e chiunque sospetti di
star eseguendo una copia diversa da quella che sta leggendo.

## Comando

`$SCRIPTS` = la base directory annunciata dal tool Skill, più `../../scripts`.

```bash
node "$SCRIPTS/install-check.mjs" [--plugin-dir <path>] [--claude-dir <path>] [--help]
```

`--plugin-dir` è il repository con cui confrontare, default la directory corrente; deve contenere
`.claude-plugin/plugin.json` e `.claude-plugin/marketplace.json`. `--claude-dir` è la directory di
configurazione di Claude Code, default `$CLAUDE_CONFIG_DIR` oppure `~/.claude`.

Output: **una riga JSON**, lo stesso contratto di `issue-manager.mjs`. Niente su stderr.

```json
{"ok":true,"data":{"plugin":"harness@diemrt","source":"github","state":"aligned","contentDrift":0}}
```

| `code` | Quando | Cosa significa |
|---|---|---|
| `LOCAL_SOURCE` | il marketplace è registrato con sorgente `directory` | i progetti non caricano un rilascio: caricano una cartella di questa macchina com'è, lavoro non committato compreso |
| `DIVERGENT_INSTALL` | la copia installata non ha la stessa forma del repository | file mancanti, file di troppo, o resti di un modello di distribuzione precedente alla radice |
| `NOT_INSTALLED` | nessuna installazione registrata | non è una divergenza: non c'è niente da confrontare |
| `MISSING_MANIFEST` | `--plugin-dir` non è la radice di un plugin | |
| `FILE_NOT_FOUND` | una directory dichiarata non esiste | anche il caso di un `installPath` registrato ma sparito |
| `INVALID_JSON` | un registro non è leggibile | |
| `UNKNOWN_ARGUMENT` | un flag che lo script non dichiara | |

## Cosa confronta, e cosa no

Confronta la **forma**: l'elenco dei file sotto `agents/`, `commands/`, `scripts/` e `skills/`,
più le voci alla radice presenti nell'installato e assenti dal repository. `commands/` è nella
lista pur non essendo più spedita: una copia installata che la porta ancora è una copia di prima
che le operazioni diventassero skill, e registra ogni `/harness:*` due volte. Toglierla dall'elenco
renderebbe invisibile proprio la divergenza che questo controllo esiste per vedere. Un `.gitkeep` non
conta come componente — è esattamente ciò che portava la copia rimasta congelata, ed è il modo
in cui una directory vuota riesce a sembrare piena.

**Non confronta il contenuto**, e non è una dimenticanza. Fra un rilascio e il commit successivo
i byte differiscono per costruzione: far fallire il controllo su quello significherebbe farlo
gridare ogni giorno finché qualcuno smette di ascoltarlo. La deriva viene riportata come numero,
`contentDrift`, e non fa mai uscire 1. Una copia con `skills/` vuoto invece non è un rilascio
indietro: è un altro artefatto, e quello fallisce.

Il controllo si ferma alla **prima** risposta utile: con una sorgente `directory` non confronta
niente, perché il difetto è la sorgente e il diff direbbe «tutto a posto» proprio mentre il
problema è che non esiste nessuna pubblicazione.

**Su un ramo di lavoro fallisce, ed è corretto.** Un file di componente aggiunto e non ancora
pubblicato è, per la copia installata, un file mancante: `DIVERGENT_INSTALL` con l'elenco di ciò
che il rilascio non ha ancora portato. Non è un falso allarme, è la stessa domanda posta prima
del momento giusto — il controllo si esegue **dopo** che il rilascio è atterrato, non a metà di
un ramo. Se lo lanci mentre lavori, leggi `missing` come «ecco cosa non è ancora uscito».

## Perché esiste

Fra il 2026-07-29 e il 2026-08-13 il marketplace `diemrt` è stato registrato come `directory`
sul working tree dell'autore. Per quindici giorni ogni progetto che usava harness ha eseguito
quella cartella dal vivo — non un tag, non un commit, nemmeno un albero pulito — mentre la copia
in cache restava ferma al giorno in cui le quattro directory dei componenti erano vuote.

Né `npm test` né il tracker potevano accorgersene: la suite gira sul repository, mai
sull'installato. Il referto con le prove sta in
[docs/superpowers/analisi/2026-08-13-plugin-pubblicato-divergente.md](../../../docs/superpowers/analisi/2026-08-13-plugin-pubblicato-divergente.md).
