# Comandi di ciclo di vita del tracker, e il link del board

Data: 2026-07-31
Stato: approvato in brainstorming, da pianificare

## Problema

Due cose scorrelate, raccolte qui perché sono state decise nello stesso giro.

**Il link del board apre due pagine.** Un ctrl+click sull'URL stampato al clock-in apre due
schede sullo stesso indirizzo. Costa poco, dà fastidio ogni sessione, ed è l'unico punto in cui
harness tocca il browser.

**Il tracker non ha un ciclo di vita.** `issues.json` nasce al primo `--insert`, cresce e non
torna più indietro: 81 issue chiuse e 283 KB al momento di questo documento, su un progetto di
tre settimane. Non esiste un modo per crearlo di proposito, per portarlo avanti quando lo schema
cambia, né per rimpicciolirlo senza perdere quello che è stato fatto. Sono tre comandi mancanti,
e uno di essi — `upgrade` — presuppone un dato che il file oggi non porta.

## 1. Il link del board

Il server stampa **una** riga di JSON, con **un** URL. Il difetto non è in
`scripts/board-server.mjs`, e questo documento non lo modifica.

L'ipotesi è che in Windows Terminal ci siano due rilevatori di link sovrapposti sullo stesso
testo: Claude Code emette l'URL come hyperlink OSC 8, e Windows Terminal fa comunque la sua
auto-detection sul testo grezzo. Un click li innesca entrambi, e ognuno apre una scheda.

Harness non può correggere né Claude Code né Windows Terminal. Può scegliere **la forma in cui
stampa l'URL**, e le forme non sono equivalenti davanti a quei due rilevatori:

| forma | come si scrive |
|---|---|
| URL nudo su riga propria | `http://127.0.0.1:5173/` |
| code-span | `` `http://127.0.0.1:5173/` `` |
| fenced code block | l'URL dentro un blocco ``` |
| markdown link | `[board](http://127.0.0.1:5173/)` |

Il lavoro è un test A/B con l'utente al click, un giro per forma, contando le schede che si
aprono. L'esito va registrato — quale forma è stata provata, quante schede ha aperto — perché è
l'unica evidenza possibile: nessun test automatico di questo repository può contare le schede di
un browser.

Il deliverable è documentale: `commands/board.md` (passo 4 dell'avvio) e
`references/board.md` (sezione "Ciclo di vita") prescrivono **una sola** forma e dicono perché,
così che la scelta non venga riaperta a ogni riformulazione della frase.

**Fuori scope:** aprire il browser da soli, che resta vietato per la ragione già scritta in
`references/board.md` — rubare il focus a ogni sessione è peggio di un click.

## 2. `schema_version`

`upgrade` deve sapere da dove parte e `init` deve sapere cosa scrivere. Entrambi presuppongono
che il file dichiari il proprio schema, e oggi non lo fa.

- costante `SCHEMA_VERSION` in `scripts/issue-manager.mjs`, valore `1` — lo schema di oggi,
  quello descritto in `references/issues.md`;
- chiave `schema_version` in cima a `issues.json`, accanto a `last_updated`;
- **chiave assente = versione 0, e il file si legge lo stesso.** Nessun comando esistente
  cambia comportamento, nessun progetto va aggiornato per continuare a funzionare. È la stessa
  scelta già fatta per `tier` e per `depends_on`: un campo nuovo non invalida i dati scritti
  prima di lui.

**Il writer preserva quello che trova.** Se il file ha `schema_version`, il salvataggio lo
riscrive identico; se non ce l'ha, non lo aggiunge. Solo `--init` e `--upgrade` scrivono quel
campo. Un `--insert` che timbrasse `1` su un file v0 dichiarerebbe una migrazione mai eseguita,
e il campo perderebbe l'unica cosa che lo rende utile: dire il vero su cosa è stato applicato.

## 3. `--upgrade`

Porta `issues.json` da `schema_version` a `SCHEMA_VERSION`.

- una lista **ordinata** di migrazioni, ognuna con la versione che produce; si applicano solo
  quelle fra la versione del file e quella corrente;
- migrazione `0 → 1`: materializza `depends_on: []` dove la chiave manca;
- **non tocca i valori esistenti e non rimuove niente.** Aggiunge campi nuovi col default e
  basta. Un campo deprecato lo cancella l'utente, quando decide di cancellarlo;
- **idempotente:** file già a `SCHEMA_VERSION` → `ok:true`, `{from, to, migrated: 0}`, e
  nessuna scrittura. Rilanciarlo non è un errore e non produce un secondo giro di modifiche;
- file a versione **superiore** a `SCHEMA_VERSION` → rifiuto: è uno script vecchio davanti a
  dati nuovi, e riscriverli significherebbe degradarli.

`data`: `{ from, to, migrated }`, dove `migrated` è il numero di issue effettivamente toccate.

## 4. `--init`

Crea `issues.json` nella directory del progetto col seed minimo:

```json
{ "schema_version": 1, "last_updated": "<datetime>", "issues": [] }
```

Se il file **esiste già**, rifiuta con un codice nuovo `ALREADY_EXISTS` e non scrive niente. Un
`init` che sovrascrive è un `init` che cancella un tracker vivo, e nessun flag di conferma vale
il rischio: chi vuole ripartire da zero rimuove il file a mano, esplicitamente.

`data`: `{ path, created: true }`.

## 5. `--compact`

Il raggruppamento è giudizio — sapere che "board server" e "card delle dipendenze" sono lo
stesso argomento non è deducibile da un titolo — mentre la scrittura è meccanica. Quindi due
pezzi: una primitiva che non decide niente, e un comando che decide e chiede conferma.

### 5.1 La primitiva

Riceve i blocchi già decisi, sulla stessa forma di payload degli altri comandi
(`--issue-data` / `--issue-data-file`):

```json
{ "blocks": [ { "title": "…", "description": "…", "issue_ids": ["<guid>", "<guid>"] } ] }
```

Sequenza, e ogni passo può fermare tutto prima che si scriva:

1. **valida** — ogni id esiste, ogni issue è `status: done`, nessun id compare in due blocchi,
   nessun blocco è vuoto; `title` e `description` rispettano i limiti già in vigore;
2. **rifiuta se una issue viva dichiara in `depends_on` uno degli id da archiviare**, con
   `INVALID_DEPENDENCY` e la lista degli id che puntano. È la semantica che `--delete` ha già:
   riscrivere quei riferimenti per farli puntare al blocco muterebbe issue che il chiamante non
   ha nominato. Chi compatta scollega prima;
3. **archivia** gli oggetti issue originali, **interi**, in `.harness/archive/<timestamp>.json`,
   insieme allo `schema_version` sotto cui erano scritti. L'archivio si autodescrive: chi lo
   riapre fra sei mesi non deve indovinare quale schema stava leggendo. `.harness/` si
   auto-ignora, quindi il repository non cresce;
4. **sostituisce** — toglie le archiviate da `issues.json` e inserisce una issue per blocco,
   `status: done`, `validation.state: "pass"`, `criteria` con l'evidenza: path dell'archivio e
   lista `id + titolo` delle issue che il blocco copre;
5. **rifiuta sotto `HARNESS_ROLE=worker`** con `FORBIDDEN_ROLE`. La primitiva scrive record
   `done`/`pass`: è esattamente la mossa che il guard anti-self-validation esiste per impedire.

`data`: `{ archivePath, removed, blocks: [ { id, title, archivedCount } ] }`.

**L'archivio non viene riletto da nessuno.** Non è un secondo tracker: `--get`, `--get-all` e il
board continuano a vedere solo `issues.json`. È storia congelata, e il blocco che la sostituisce
porta il path per chi la vuole andare a leggere.

### 5.2 Il comando

`/harness:compact` fa il giro che la primitiva non può fare:

1. legge le issue `done`;
2. propone N blocchi tematici, dicendo quali issue finiscono in ognuno;
3. **aspetta conferma dall'utente** — un raggruppamento sbagliato scritto è un archivio da
   disfare a mano;
4. chiama la primitiva col payload confermato, da file;
5. riporta `archivePath` e i blocchi creati.

## 6. Dove vivono i comandi

`init` e `upgrade` sono meccanici e senza dialogo: diventano argomenti di `/harness:issue`
(`init`, `upgrade`), che è già "operazioni sul tracker". Solo `compact` prende un file comando
suo, perché ha il passo di conferma e un payload da costruire.

Il contratto degli script resta quello di sempre: una riga JSON su stdout, `code` stabile,
niente su stderr.

## Catene di dipendenza

| # | Issue | tier | dipende da |
|---|---|---|---|
| 1 | Board: un click, una pagina | standard | — |
| 2 | `schema_version` nel tracker | standard | — |
| 3 | `--upgrade` | standard | 2 |
| 4 | `--init` | economy | 2 |
| 5 | `--compact`, la primitiva | reasoning | 2 |
| 6 | `/harness:compact`, il comando | standard | 5 |

Due catene. La prima è la sola issue 1, e tocca file che nessun'altra guarda: procede in
parallelo. La seconda è seriale non per prudenza ma perché 2-6 modificano tutte
`scripts/issue-manager.mjs` e `test/plugin-issue-manager.test.mjs`.

Le issue di documentazione le apre il docs gate dopo ogni commit, come per ogni altro lavoro di
questo repository: non vengono pre-aperte qui.

## Fuori scope

- Modifiche a `scripts/board-server.mjs` e a `scripts/board.html`.
- Un archivio interrogabile dalla CLI o mostrato dal board.
- Riscrivere i `depends_on` delle issue vive quando il loro target viene archiviato.
- Rimuovere campi deprecati durante l'upgrade.
- Auto-upgrade all'apertura del file da parte di `--insert` o `--update`.
