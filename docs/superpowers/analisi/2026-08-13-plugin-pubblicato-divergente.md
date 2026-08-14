# Referto — il plugin pubblicato e il repository sono divergenti

Indagine condotta il 2026-08-13 sulla issue `24f39ab4`, con il caso reale di
`C:\Users\diego_martignoni\Documents\Workspace\Projects\activitymanager`.

Tutti i comandi qui sotto sono stati eseguiti davvero e sono **di sola lettura**: nessuno di
loro scrive, né nel repository né nella copia installata né nel progetto consumer. Chi vuole
rifare i conti non deve fidarsi delle tabelle.

## La constatazione di partenza

La copia installata in `.claude/plugins/cache/diemrt/harness/0.6.0/` dichiara la stessa versione
del repository — `0.6.0` — e ha un contenuto diverso: contiene `hooks/`, `src/`, `template/`,
`init.mjs`, `issues.html`, componenti che questo repository non ha più.

L'indagine conferma la divergenza e **corregge la spiegazione** che la issue ne dava. La issue
sosteneva che «chi usa harness in un altro progetto sta eseguendo un `issue-manager.mjs` diverso».
È falso, ed è falso in un modo che conta: nessuno esegue quella copia. Quello che i progetti
consumer eseguono è il **working tree di questo repository, dal vivo**, ed è un problema
diverso e più grande.

## Cosa contiene la copia installata

```bash
C=~/.claude/plugins/cache/diemrt/harness/0.6.0
(cd "$C" && find . -type f | sort)
```

86 file. Le quattro directory che *sono* il plugin sono vuote:

| directory | nel repository | nella copia installata |
|---|---|---|
| `skills/` | `harness/SKILL.md` + 8 reference | `skills/.gitkeep` |
| `commands/` | 7 comandi | `commands/.gitkeep` |
| `agents/` | `harness-verifier.md` | `agents/.gitkeep` |
| `scripts/` | 8 script | `scripts/.gitkeep` |

**La copia pubblicata è un plugin senza skill, senza comandi, senza agent e senza script.** Al
loro posto porta il modello di distribuzione precedente: `issue-manager.mjs` alla radice, `src/`,
`template/`, `hooks/`, `init.mjs`, `issues.html`. Il suo manifest interno lo dice a chiare
lettere:

```bash
cat "$C/.harness-manifest.json" | head -4
#   "harnessVersion": "0.4.0",
#   "generatedAt": "2026-07-17T09:30:39.290Z",
```

Una copia dichiarata `0.6.0` che al suo interno si sa `0.4.0`.

E porta tre cose che non avrebbero mai dovuto uscire dal repository: `issues.json` (il tracker di
harness stesso, 34 issue), `.harness/runs/*.log` con i `prompt-*.txt` dei worker, e
`.claude/settings.local.json`.

## Da dove viene quella copia

```bash
cat ~/.claude/plugins/known_marketplaces.json     # sorgente del marketplace
cat ~/.claude/plugins/installed_plugins.json      # cosa e' installato, quando, da quale sha
```

```json
"diemrt": {
  "source": { "source": "directory", "path": "C:\\...\\Projects\\personal\\herness" },
  "installLocation": "C:\\...\\Projects\\personal\\herness",
  "lastUpdated": "2026-07-29T14:02:36.742Z"
}
```

```json
"harness@diemrt": [{
  "installPath": "C:\\...\\.claude\\plugins\\cache\\diemrt\\harness\\0.6.0",
  "version": "0.6.0",
  "installedAt": "2026-07-29T13:26:10.613Z",
  "lastUpdated": "2026-07-29T13:26:10.613Z",
  "gitCommitSha": "2d18eff0b61fce03ccd304a9485f17d7d85e1d67"
}]
```

Tre fatti, tutti leggibili qui sopra:

1. **Il marketplace `diemrt` non è GitHub: è una directory**, e la directory è questo repository.
   `marketplaces/diemrt` infatti non esiste — non c'è nessun clone, perché non c'è niente da
   clonare. Il `README.md` documenta l'installazione come
   `/plugin marketplace add diemrt/harness`, cioè la forma GitHub. **Il canale documentato e il
   canale reale sono due canali diversi**, e la divergenza vive tutta in questa distanza.
2. **`installedAt` e `lastUpdated` sono lo stesso istante.** La copia non è mai stata aggiornata
   dal 29 luglio. Sulla stessa macchina, `superpowers@claude-plugins-official` ha `installedAt`
   2026-07-02 e `lastUpdated` 2026-08-13: gli altri plugin si aggiornano, harness no.
3. Lo `sha` registrato, `2d18eff`, esiste in questa storia ed è **159 commit indietro**.

```bash
git log -1 --format='%h %ad %s' --date=short 2d18eff   # 2d18eff 2026-07-29 chore: seed backlog for the plugin rewrite
git rev-list --count 2d18eff..HEAD                      # 159
```

Il nome di quel commit è già mezza risposta: *seed backlog for the plugin **rewrite***. La copia
è stata presa il giorno in cui la riscrittura veniva pianificata, prima che esistesse.

## La copia non è un checkout: è il working tree, sporco

Questo è il punto che nessuno si aspettava, e si dimostra confrontando la copia con l'albero
tracciato a quello sha:

```bash
git ls-tree -r --name-only 2d18eff | sort > /tmp/tree.txt
(cd "$C" && find . -type f | sed 's|^\./||' | sort) > /tmp/cache.txt
comm -13 /tmp/tree.txt /tmp/cache.txt    # nella copia ma NON tracciati
```

Nessun file tracciato manca. Ma nella copia ci sono 27 file che a quel commit **non erano
tracciati affatto**: i log dei worker, i prompt, `.gitignore.new`, `.claude/settings.local.json`,
i quattro `.gitkeep`, e `.claude-plugin/plugin.json` stesso — che a `2d18eff` non era ancora
committato.

E tre file tracciati hanno contenuto diverso da quello del commit:

```bash
while read f; do
  a=$(git show "2d18eff:$f" | sha256sum | cut -d' ' -f1)
  b=$(sha256sum "$C/$f" | cut -d' ' -f1)
  [ "$a" != "$b" ] && echo "DIVERSO: $f"
done < /tmp/tree.txt
# DIVERSO: docs/GIT.md
# DIVERSO: issues.json
# DIVERSO: template/docs/GIT.md
```

**L'installazione non ha copiato un commit: ha copiato la cartella com'era in quel momento**,
comprese le modifiche non committate e i file ignorati. Lo `sha` registrato nel registro è solo
la HEAD del momento, e non descrive ciò che è stato copiato.

## Perché non si è mai aggiornata

La risposta è che **per una sorgente `directory` non esiste nessun ciclo di aggiornamento**, e si
vede confrontandola con un plugin che invece si aggiorna. Nel marketplace ufficiale, superpowers
è dichiarato così:

```bash
node -e "..." # oppure: leggere marketplaces/claude-plugins-official/.claude-plugin/marketplace.json
# { "name": "superpowers",
#   "source": { "source": "url",
#               "url": "https://github.com/obra/superpowers.git",
#               "sha": "b36e0829c6d0140e93cfef2ca599b1b07d4a7797" } }
```

**Nessun campo `version`.** Ciò che identifica il contenuto è lo `sha`, e il marketplace stesso è
un'istantanea con il proprio sha:

```bash
cat ~/.claude/plugins/marketplaces/claude-plugins-official/.gcs-sha
# d06d3ed49ff765a8772ae4bc6ece62d58f7fd18c
```

Né il marketplace né le copie in cache sono checkout git — non contengono `.git`. Sono istantanee
scaricate e confrontate per sha. Quando lo sha cambia, la copia viene rimaterializzata; al riavvio
la sessione carica la nuova.

Un marketplace di tipo `directory` non ha niente di tutto questo: nessuno sha da confrontare,
nessun remoto da interrogare. La cartella viene copiata una volta, all'installazione, e da quel
momento nessun meccanismo la riguarda più. Non è che l'aggiornamento sia fallito: **non è mai
stato previsto**.

La versione ha comunque una parte, minore ma non nulla: dà il nome alla cartella di cache
(`cache/diemrt/harness/0.6.0/`) ed è l'unica etichetta leggibile da un umano. E non è mai
cambiata:

```bash
git log --format='%h %ad %s' --date=short -p -- .claude-plugin/plugin.json \
  | grep -E '^[0-9a-f]{7} |^\+.*"version"'
# a607d9d 2026-07-29 feat: scaffold the Claude Code plugin and marketplace
# +  "version": "0.6.0",
```

Una sola riga in tutta la storia del file. `0.6.0` è stata scritta il giorno in cui
`plugin.json` è nato — il 29 luglio, lo stesso giorno dell'installazione — e non è mai stata
incrementata. Sotto quella singola etichetta sono passati 159 commit e la riscrittura completa
del plugin, da modello a template copiati a modello a plugin.

Il tag racconta la stessa cosa da un'altra angolazione:

```bash
git log -1 --format='%h %ad' --date=short v0.6.0   # 69ee1cd 2026-08-12
git rev-list --count v0.6.0..HEAD                  # 48
```

`CONTRIBUTING.md` dice «Consumers install from git, so the release is the tag». Il tag `v0.6.0`
è stato messo il 12 agosto — quattordici giorni **dopo** che la versione 0.6.0 era già stata
installata da qualcuno — ed è già 48 commit indietro rispetto a `main`.

Non esiste nessun istante in cui «0.6.0» abbia identificato un contenuto preciso.

## La riproduzione

Due comandi, stessa cartella, stesso sottocomando, **entrambi in sola lettura**:

```bash
C=~/.claude/plugins/cache/diemrt/harness/0.6.0
R=~/Documents/Workspace/Projects/personal/herness
A=~/Documents/Workspace/Projects/activitymanager

(cd "$A" && node "$C/issue-manager.mjs"         --get-all --status done --page-size 1)
(cd "$A" && node "$R/scripts/issue-manager.mjs" --get-all --status done --page-size 1)
```

| | `totalCount` | prima issue |
|---|---|---|
| copia pubblicata | **34** | `feat: git hook pre-commit come gate di verifica docs/AGENTS.md` |
| copia del repository | **21** | `[F0.3] Registrare la baseline ng17 e la checklist di smoke manuale` |

Il secondo risultato è il tracker di activitymanager. Il primo **non è il tracker di
activitymanager**: sono le issue di harness, quelle contenute nella copia installata.

Il motivo sta in una riga:

```bash
grep -n 'issuesFilePath' "$C/issue-manager.mjs"
# 60: const issuesFilePath = path.join(__dirname, "issues.json");
grep -c 'project-dir' "$C/issue-manager.mjs"   # 0
```

La copia pubblicata risolve il tracker **accanto a sé stessa**, e non conosce `--project-dir`.
Chi la eseguisse da un qualsiasi progetto non leggerebbe il proprio tracker, e scrivendo non
scriverebbe nel proprio: scriverebbe dentro la cache dei plugin, in un file condiviso da ogni
progetto della macchina. Con exit 0 e una busta JSON ben formata. Costoso e invisibile nella
forma più pura che harness abbia incontrato finora.

Per chiudere il cerchio, quella copia non conosce nemmeno lo schema con cui i tracker sono
scritti oggi:

```bash
for k in schema_version covers tier depends_on; do
  printf '%-16s %s\n' "$k" "$(grep -c "$k" "$C/issue-manager.mjs")"
done
# schema_version   0
# covers           0
# tier             0
# depends_on       0
```

## Il caso reale: activitymanager

`activitymanager` è il consumer vero: 34 issue, 21 chiuse, una migrazione Angular 17 → 21
condotta con il workflow, ADR e piani in `docs/`. Il suo `issues.json` dichiara
`schema_version: 3`, e porta `covers` su 34 issue su 34, `tier` su 33, `depends_on` su tutte.

Sono campi che la copia pubblicata non nomina nemmeno una volta (tabella qui sopra). **Quel
tracker non può essere stato scritto da lei.** Non è una deduzione per esclusione: le
trascrizioni delle sue quindici sessioni dicono con quale path harness è stato invocato.

```bash
D=~/.claude/projects/C--Users-diego-martignoni-Documents-Workspace-Projects-activitymanager
grep -ohE 'node "?[^" ]*issue-manager\.mjs' "$D"/*.jsonl | sed 's/^node "\?//' | sort | uniq -c | sort -rn
```

| conteggio | path invocato |
|---|---|
| 84 | `C:/Users/.../personal/herness/scripts/issue-manager.mjs` |
| 83 | `C:/Users/.../personal/herness//scripts/issue-manager.mjs` |
| 40 | `issue-manager.mjs` (relativo) |
| 2 | la stessa cosa con i backslash |

```bash
grep -c 'plugins.cache.diemrt' "$D"/*.jsonl      # nessuna occorrenza in nessun file
```

**Zero invocazioni della copia pubblicata. 168 invocazioni del working tree di questo
repository**, per path assoluto, da un progetto che non è questo repository.

La doppia barra di 83 di quelle invocazioni non è un refuso: è la firma dell'espansione che
Claude Code fa nel testo della skill. Nelle sessioni di activitymanager la skill è arrivata così:

```bash
grep -oh 'Nel resto del documento .\$SCRIPTS. sta per [^\\]*' "$D"/*.jsonl | sort | uniq -c
# 8  ... `$SCRIPTS` sta per `C:/Users/.../personal/herness//scripts`.
```

`${CLAUDE_PLUGIN_ROOT}` si è espanso **nella directory del repository**, non nella cache, in
sessioni aperte altrove. È la prova che per un marketplace di tipo `directory` Claude Code
serve il plugin dal vivo dalla sorgente, e che la copia in cache non è ciò che viene caricato.

## La causa, e cosa non è la causa

**Causa:** harness non ha nessun confine di pubblicazione. Il marketplace `diemrt` è registrato
come `directory` sul working tree dell'autore, quindi ciò che i progetti consumer caricano è la
cartella così com'è nell'istante in cui la caricano — non un tag, non un commit, nemmeno un
albero pulito. E poiché una sorgente `directory` non ha nessuno sha da confrontare, la copia
presa il 29 luglio non aveva nessun meccanismo che potesse rinfrescarla.

**Non è la causa, benché ci somigli:** la versione ferma a `0.6.0`. Gli aggiornamenti non sono
guidati dalla versione ma dallo sha — superpowers si aggiorna senza dichiarare nessuna versione.
Il numero fermo è un difetto reale (rende «quale harness sto eseguendo» una domanda senza
risposta) ma non è ciò che ha congelato la copia.

**Non è la causa:** il ref che la marketplace pubblica. Non c'è nessun ref — non c'è nessun
clone, non c'è nessuna pubblicazione. `ci.yml` è l'unico workflow e non pubblica niente, come
`CONTRIBUTING.md` già dichiara. Su GitHub `main` è allineato con il locale: chi installasse dalla
forma documentata (`/plugin marketplace add diemrt/harness`) otterrebbe oggi i componenti giusti.
Il difetto è che nessuno installa così, nemmeno l'autore.

**Non è la causa:** un rilascio fatto da uno stato di lavoro sbagliato, nel senso di un errore
umano. Non c'è stato nessun rilascio. C'è stata una copia automatica di una cartella, il giorno
in cui la cartella conteneva uno scaffold vuoto.

## Il danno

**Quello già avvenuto** non è l'esecuzione della copia sbagliata: è che ogni progetto che usa
harness esegue il working tree dell'autore. `activitymanager` ha condotto una migrazione Angular
di quattro hop eseguendo script che, negli stessi giorni, venivano riscritti. Le regole del
workflow che quel progetto ha seguito sono state quelle presenti nel file nel momento in cui
l'agente lo leggeva. Non c'è nessun modo, oggi, di dire quale versione di harness ha governato
una qualsiasi di quelle 21 issue chiuse.

Il repository conosce già questo pericolo e lo scrive — `SKILL.md` avverte di non lasciare che
un verificatore giri mentre `issue-manager.mjs` è a metà di una modifica — ma lo scrive come
regola interna, per chi lavora *qui*. Silenziosamente governa anche gli altri progetti, e in
quei progetti nessuno la legge.

**Quello potenziale** è la copia in cache: inerte finché il marketplace resta di tipo
`directory`, letale nel momento in cui qualcosa preferisse `installPath` alla sorgente — un
`installLocation` che cambia, il repository spostato o rinominato, un'installazione su un'altra
macchina fatta dalla forma documentata mentre il registro locale continua a puntare alla cache.
In quel momento il progetto consumer inizierebbe a scrivere le proprie issue dentro
`.claude/plugins/cache/diemrt/harness/0.6.0/issues.json`, senza un errore.

## Cosa resta non dimostrato

- **Se la copia in cache sia raggiungibile da qualche percorso.** L'evidenza dice che oggi non lo
  è (168 invocazioni contro 0, e l'espansione di `${CLAUDE_PLUGIN_ROOT}` sulla directory). Non
  dice che non possa esserlo mai.

## Una domanda che era aperta, e non lo è più

Restava da capire **perché** una sessione aperta nella radice del plugin caricasse la skill dal
working tree: la sorgente `directory` registrata, oppure la cwd che coincide con la radice del
plugin. Le due spiegazioni non erano separabili finché la registrazione restava com'era, e la
distinzione non era oziosa — decideva se, passando a una sorgente remota, lo sviluppo di harness
su sé stesso continuasse a funzionare dal vivo o richiedesse un giro di push per ogni iterazione.

Il 2026-08-14 il marketplace è stato ri-registrato come `github: diemrt/harness` e la sessione
riavviata, **dentro questo repository**. La skill ha annunciato:

```text
Base directory for this skill:
  C:\Users\...\.claude\plugins\cache\diemrt\harness\0.6.0\skills\harness
```

Era la sorgente, non la cwd. **Il working tree non vince sulla registrazione**, nemmeno per il
repository che è il plugin: da qui in avanti una sessione aperta qui legge la skill, gli agent, i
comandi e gli script del **rilascio**, e le modifiche non pubblicate non le vede. Il documento
servito lo conferma da solo: il suo elenco di reference non contiene
`references/install-check.md`, aggiunto su questo ramo e non ancora su `main`.

Non è un difetto da correggere, è il prezzo della pubblicazione — lo stesso che paga superpowers.
Ma cambia il loop di sviluppo di harness, e va scritto dove chi sviluppa lo incontra
([CONTRIBUTING.md](../../../CONTRIBUTING.md)): **provare una modifica ai componenti del plugin in
una sessione reale ora richiede un giro di pubblicazione**, non solo un riavvio. Gli script si
continuano a provare dal repository, invocandoli per path — è quello che fa `npm test`, ed è
perché la suite resta cieca all'installato.

## Cosa deve fare chi ha già una copia divergente installata

Da solo non se ne accorge: la copia funziona, e nella configurazione attuale non viene nemmeno
mai eseguita. Il controllo è uno solo, e sta in una riga:

```bash
ls ~/.claude/plugins/cache/*/harness/*/skills/
```

Se risponde `.gitkeep`, o non risponde niente, la copia installata è quella divergente. Il plugin
vero ha `skills/harness/SKILL.md`.

Il rimedio, nell'ordine:

1. **Non cancellare la cartella a mano.** Il registro in `installed_plugins.json` continuerebbe a
   dichiararla installata, e uno stato mezzo cancellato è peggio di uno stato vecchio coerente.
2. Disinstallare e reinstallare il plugin da Claude Code:
   ```text
   /plugin uninstall harness@diemrt
   /plugin marketplace add diemrt/harness
   /plugin install harness@diemrt
   ```
   La seconda riga registra il marketplace nella forma **GitHub** documentata dal `README.md`,
   che è quella che pubblica un ref invece di una cartella viva.
3. **Riavviare la sessione**: i componenti di un plugin appena installato diventano invocabili
   solo dopo (`CLAUDE.md`).
4. Verificare con lo stesso comando che oggi dimostra la divergenza: `ls .../harness/*/skills/`
   deve mostrare `harness/`, non `.gitkeep`.

Chi sviluppa harness e ha bisogno che le modifiche siano visibili subito negli altri progetti ha
un motivo legittimo per tenere il marketplace `directory` — ma allora **quel motivo va scritto**,
perché in cambio i progetti consumer eseguono lavoro non committato, ed è una scelta, non un
incidente.
