# Il substrato del tracker: cosa harness deve possedere

Data: 2026-08-13
Stato: **ricerca aperta**, nessuna decisione presa.

Questo documento non è una spec e non propone un design. È il referto di un'analisi che si
riprende più volte, e che a ogni giro deve poter ripartire senza rileggere la conversazione che
l'ha prodotta. Per questo la parte che pesa di più è la **prima**: quella su harness. Gli
strumenti esaminati passano, i criteri con cui li si giudica restano.

## La domanda

`issues.json` è il cuore di harness: è lì che la skill legge come procedere, ed è lì che vivono
task, descrizioni, dipendenze e avanzamento. La domanda che apre la ricerca è se quella strada
sia stata **ruota reinventata** — se lo stesso risultato si ottenga appoggiandosi a tecnologie
già affermate, riducendo o cancellando pezzi di harness invece di continuare a scriverli.

Non è insoddisfazione: il sistema funziona. È il sospetto di pagare un costo che non si vede.

## 1. Perché, davvero

Due motivi, e vanno tenuti insieme perché portano a due architetture opposte se presi da soli.

**Poter continuare ad aggiungere funzionalità.** La separazione dei ruoli e la validazione sono
nate così — da un'idea venuta usando lo strumento. Qualunque strada non deve chiudere quella
porta.

**Non mantenere infrastruttura che reinventa cose affermate.** Per due ragioni distinte: nel
tempo si resta indietro rispetto a chi quel pezzo lo cura a tempo pieno, e un formato proprietario
è una barriera all'adozione quando esistono competitor importanti.

**Quello che questa ricerca non è.** Non è insoddisfazione delle funzionalità (multiutenza,
notifiche, link con le PR non sono richiesti), e non è un esercizio teorico.

**La tesi che governa tutto.** Harness non è mai stato un tentativo di reinventare un approccio:
è un **supertype che si cala sopra altro e collabora**. È già così che viene usato — `superpowers`
per spec e documentazione, harness accanto per il workflow. Ogni opzione va giudicata su quanto
rispetta questa forma, non su quante feature porta.

## 2. La decomposizione di harness

È il risultato principale finora, ed è indipendente da qualunque strumento si adotti. Le ~3.657
righe di `.mjs` più le 625 di `board.html` non sono una cosa sola: sono **due**, con destini
diversi.

### Substrato — commodity, delegabile

Cose che altri già fanno, spesso meglio:

- persistenza e CRUD delle issue;
- DAG aciclico e sua difesa (id inesistenti, self-reference, duplicati, cicli diretti e indiretti);
- calcolo delle catene come componenti connesse, e di cosa è lavorabile adesso;
- paginazione (`--page`, `--page-size`, `--order`);
- board (`board.html`, `board-server.mjs`) e riepilogo (`status-cli.mjs`);
- `--compact`, archivio, `--upgrade`, `schema_version`.

A questa lista va aggiunto un **difetto** del substrato attuale, non solo una ridondanza:
`issues.json` è un file monolitico committato, e due catene che avanzano in parallelo confliggono
su di lui. Chi ha uno storage a grana di cella questo problema non ce l'ha.

### Tesi — proprietaria, non delegabile

Cose che nessuno degli strumenti esaminati ha:

- `validation` come sotto-oggetto di **giudizio**, con `criteria` che cambia semantica in base a
  `state` — contratto di accettazione finché è `unknown`, evidenza alla chiusura;
- lo stato `in_review`, e il fatto che il passaggio a `pass` spetti a un agente **diverso** da chi
  ha lavorato;
- il guard di ruolo `HARNESS_ROLE=worker` → `FORBIDDEN_ROLE`;
- l'aggiornamento appaiato prosa ↔ decomposizione, con `--decomposition-unchanged` come unica via
  d'uscita;
- il rifiuto di portare `in_progress` una issue senza `tasks`;
- `tier` come stima di costo che al dispatch diventa scelta di modello e reasoning;
- `covers` e il gate documentale: quali revisioni una issue dichiara di coprire;
- le regole di `SKILL.md` che non sono dati — la bussola «costoso e invisibile», la verifica
  leggera a lista chiusa, il gate sulla pubblicazione.

**La conseguenza.** La ruota reinventata è il substrato, non la tesi. Il codice che si vorrebbe
smettere di scrivere e il codice che dà valore a harness sono già separabili, e stanno oggi nello
stesso file.

## 3. La rubrica

I criteri con cui giudicare qualunque candidato, oggi e ai giri successivi. I primi tre sono
requisiti dichiarati; gli altri tre sono emersi durante l'analisi.

1. **Campi strutturati arbitrari.** `depends_on` e `tasks` devono restare dati usabili — array di
   oggetti annidati — non testo libero da riparsare.
2. **Comportamenti forzati dal codice.** Parte del valore di harness è che certi errori non si
   commettono perché uno script li rifiuta, non perché una skill li sconsiglia.
3. **Ambiente isolato.** Le informazioni vivono col repository e non si curano se stia su GitHub o
   GitLab. Non è un vincolo assoluto — si potrebbe configurare un sistema esterno — ma è una
   comodità reale, usata fino ad ora.
4. **Costo di uscita, non longevità.** «Vivrà per sempre?» non ha risposta. «Quanto costa uscirne
   se muore?» sì, e si misura: se la tesi ha viaggiato come blob proprietario, uscire è un export;
   se si è spalmata sui campi nativi di qualcun altro, è una migrazione.
5. **Nessuna barriera d'ingresso nuova.** Oggi harness richiede solo Node, che chi usa Claude Code
   ha già. Aggiungere un prerequisito è attrito proprio sul motivo — l'adozione — per cui si stava
   standardizzando. **Tensione dichiarata, non risolta.**
6. **La tesi non si mappa sui campi nativi.** `tier` non deve diventare `priority`, `in_review` non
   deve diventare uno status altrui. Il punto 4 dipende interamente da questo.

## 4. Decisioni già prese

Da non rimettere in discussione a ogni giro, salvo motivo nuovo.

- **Il motivo è manutenzione più adozione**, non feature mancanti né dubbio astratto.
- **Harness è protocollo, non tracker.** La forma da preservare è quella del supertype.
- **Il guard sui ruoli non è il perno.** Era nato per un modello in cui l'orchestratore delegava a
  CLI di agenti esterni (Copilot e simili) come worker. Nella pratica è servito raramente, e nel
  caso peggiore l'orchestratore rimediava. Non giustifica da solo il possesso dello storage.
- **L'enforcement può spostarsi dalla scrittura alla pubblicazione.** Harness questa mossa l'ha già
  fatta una volta, nel gate che è passato dal commit al push. Un audit sulla storia prima di
  pubblicare è più debole in scrittura e più forte dove conta: diventa evidenza controllabile.
- **Non esiste uno standard a cui conformarsi** (§5). La premessa «mi sono perso qualcosa di
  affermato» è stata verificata ed è falsa: harness non ha duplicato una specifica esistente. Resta
  vero il costo di manutenzione, che è un'altra cosa e va deciso a parte.
- **MCP serve in uscita, non in entrata** (§6). Non astrae lo store; espone harness a chi non usa
  Claude Code. Non è alternativo a nessuna altra strada: si somma a tutte.

## 5. Standard: non ce n'è uno

Era la domanda posta per prima — non *quale strumento*, ma se siano nati **approcci più
strutturati** su cui appoggiarsi. La risposta è no, e il modo in cui è no conta.

**Uno standard vero esiste, ed è di un altro mondo.**
[OSLC Change Management 3.0](https://docs.oasis-open-projects.org/oslc-op/cm/v3.0/change-mgt-spec.html)
(OASIS, ottobre 2020) definisce interfacce REST e tipi RDF — `oslc_cm:Defect`, `oslc_cm:Task` —
per l'interscambio di change request fra strumenti ALM. È lo standard che si cerca quando si
chiede «esiste uno standard per le issue»: la risposta è sì, ha sei anni, ed è pensato per far
parlare Jira con IBM DOORS. Nessuno in questo spazio lo usa, è RDF, presuppone server. Non si
applica a un tracker che vive nel repository.

**Due standard vivi parlano di un'altra cosa, con la stessa parola.**
Il `Task` di [A2A](https://a2a-protocol.org/latest/specification/) e la
[MCP Tasks extension](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
(SEP-2663) modellano entrambi un **task in volo**: la chiamata lunga che deve sopravvivere alla
connessione, con stati `working`, `input_required`, `completed`, `failed`, `cancelled` e un handle
per fare polling. MCP Tasks è per di più ristretto a `tools/call`, `sampling/createMessage` ed
`elicitation/create`, e sta in un repo `experimental-ext-tasks` che avverte di poter «change or
disappear».

Nessuno dei due modella dipendenze, criteri di accettazione o un backlog che sopravvive alle
sessioni. **Adottarli sarebbe un errore di categoria**: stessa parola, cosa diversa. Vale la pena
scriverlo qui perché la confusione è facile e costerebbe un giro intero.

**Una proposta si spaccia per standard.** OSSA («Open Standard for Software Agents») ha `kind:
Task` e `kind: Workflow` in roadmap per Q1 2026, ma è la proposta di una persona — il founder di
Bluefly.io — pubblicata su Medium, a v0.2.9, con la governance Linux Foundation dichiarata come
aspirazione per il **Q4 2026**. E descrive *definizioni di agenti*, non work item.

### Cosa se ne ricava

**Non esiste uno standard per un grafo di work item repo-local, con dipendenze e criteri di
accettazione, orientato agli agenti.** Il de-facto sta emergendo come **prodotto** — il JSONL di
beads — non come specifica.

Questo cambia la premessa della ricerca. Harness non ha reinventato una ruota che esisteva: ha
costruito una ruota dove la ruota non è standardizzata. Il costo che si paga è reale
(manutenzione, adozione), ma non è il costo dell'ignoranza: è il costo di essere arrivati prima
che qualcuno normasse la cosa. «Conformarsi» non è un'opzione disponibile, perché non c'è nulla a
cui conformarsi.

## 6. Prodotti esaminati

Registro sintetico. Si allunga a ogni giro.

### Beads (`bd`) — esaminato a fondo, non adottato

Tracker git-native per agenti. [Repo](https://github.com/gastownhall/beads).

*Copre il substrato quasi per intero*: grafo con link tipizzati (blocks, parent-child,
discovered-from, related), `bd ready` che è la regola 1-WIP calcolata invece che applicata, storage
Dolt con merge a livello di cella, export JSONL, server MCP, plugin Claude Code, federation
multi-agente.

*Non ha nulla della tesi*: i campi di una issue sono `id, title, description, type, status,
priority, labels, created_at, updated_at`. Niente assignee o ruolo, niente acceptance criteria,
niente checklist, niente stato di validazione.

*L'estensione è prevista per design*, ed è il fatto che rende l'opzione praticabile: `metadata`
accetta **JSON arbitrario** ed è dichiarato il punto di estensione preferito per dati «specific to
an integration, orchestrator, team workflow», con prefissi riservati (`bd:`, `_`) contro le
collisioni future. La doc scoraggia esplicitamente di aggiungere helper di primo livello per
leggerlo: lo si legge con `bd show <id> --json | jq`. Lo strato sopra è atteso, e atteso come
macchina.

*Salute, misurata il 2026-08-13*: 26.269 stelle, 1.767 fork, 100+ contributori, 10.647 commit nelle
ultime 52 settimane con le ultime tre fra le più dense dell'anno, ultimo push lo stesso giorno,
v1.0.0 ad aprile 2026 e v1.2.1 l'11 agosto, MIT, Go, ~23k download npm al mese. Il repo è stato
trasferito da un account personale all'org `gastownhall`, e fra i primi contributori c'è un
ingegnere DoltHub: il vendor dello storage partecipa.

*Contro*: **bus factor uno** — Yegge ha 4.794 contributi, il secondo 772. **Dieci mesi di vita**:
adozione esplosiva, longevità non dimostrata. **607 issue aperte** e ~200 commit a settimana: il
contratto JSON non si rompe (c'è `schema_version` con regola additiva dichiarata, e l'unico
breaking noto — l'envelope di v2.0 — ha già la via d'uscita `BD_JSON_ENVELOPE=0`), ma doc, comandi
e prassi si muovono, e stargli dietro è lavoro. **Binario Go**: viola il criterio 5.

*Da verificare se si riprende*: se gli status siano estendibili (fonti contraddittorie) — decide se
`in_review` esiste come stato o diventa un dato in `metadata`.

### GitHub Issue fields — squalificato sui numeri

I [campi strutturati sulla issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-and-managing-issue-fields)
sono in public preview per tutte le organizzazioni da maggio 2026, con API REST e GraphQL complete
e webhook `field_added`/`field_removed`. Colmano il buco che squalificava la forge, ma i numeri
chiudono la questione prima del criterio 3:

- **quattro tipi soltanto**: single select, text, number, date. Niente array, niente oggetti,
  niente JSON;
- **venticinque campi per organizzazione**, non per repository: un budget condiviso fra tutti i
  progetti dell'org.

`tasks[]` e `depends_on[]` diventerebbero JSON serializzato dentro un campo text — cioè esattamente
«solo puro testo», la cosa che il criterio 1 esiste per impedire. **Fallisce il criterio 1 sui
fatti**, prima ancora di arrivare al 3.

### Backlog.md — struttura a metà

[Repo](https://github.com/MrLesk/Backlog.md). Letto un file di task reale invece della vetrina:

```yaml
id: BACK-239
title: 'Feature: Auto-link tasks to documents/decisions + backlinks'
status: To Do
assignee: ['@codex']
labels: [web, enhancement, docs]
dependencies: []
priority: medium
ordinal: 6000
```

`dependencies` è dato vero. Ma i criteri di accettazione **non sono struttura**: sono checkbox
markdown dentro un blocco delimitato da commenti HTML (`<!-- AC:BEGIN -->`, voci `- [ ] #1 …`),
cioè una convenzione testuale che un parser ricava. E non ci sono campi custom.

Fallisce il criterio 1 **esattamente dove harness ha la sua tesi**: `validation` e `tasks`
tornerebbero testo da riparsare. Ha in compenso ciò che a beads manca sul piano umano — board da
terminale e web UI locale, Definition of Done configurabile, `--json` versionato.

### MCP come porta — idea ribaltata

L'ipotesi era: harness non adotta uno store, parla MCP con quello che il progetto già ha. **Non
regge**, e il motivo è verificabile.

Il server MCP di beads espone `ready, list, show, create, claim, update, close, reopen, dep,
comment, comments, note, blocked, stats, context, admin`: vocabolario suo. Linear, Jira e GitHub
espongono il proprio. **Non esiste un vocabolario comune per i tracker su MCP** — MCP standardizza
il *trasporto*, non il dominio. Quindi «harness parla MCP» non dà portabilità: dà N adattatori,
con in più latenza e nessuna garanzia di schema. Un adapter locale sarebbe più semplice e più
solido.

**Il ribaltamento, che è il risultato utile.** MCP conviene in **uscita**, non in entrata: harness
può esporre *sé stesso* come server MCP, diventando usabile da Copilot, Cursor, Codex e chiunque
parli il protocollo. È adozione (motivo C) **senza toccare lo storage e senza dipendenze nuove**,
e non è alternativo a nessuna delle altre strade: si somma. È il candidato più economico emerso
finora.

### Non tracker, da non confondere

- **Framework SDD** (Spec Kit, OpenSpec, BMAD, Kiro) — producono documenti e un `tasks.md`. Sono il
  livello *sopra* harness, non un sostituto. Vicini con cui collaborare, coerentemente con la tesi
  del supertype.
- **Tracker markdown minori** (git-issues, tkr, trackdown) — più leggeri, nessun guard
  programmatico. Sotto la soglia del criterio 2, da confermare se serve.

### Bilancio dopo il secondo giro

Sul **criterio 1** — campi strutturati arbitrari — passa **solo beads**, grazie a `metadata` come
JSON arbitrario. GitHub e Backlog.md falliscono entrambi lì, e lì c'è la tesi di harness. È un
risultato scomodo e va tenuto per quello che è: non un'indicazione ad adottare beads, ma la
constatazione che il campo dei sostituti è più stretto di quanto sembrasse.

## 7. Domande aperte

- Harness deve funzionare per chi non ha installato lo strumento sottostante? (criterio 5)
- Backend unico, adapter con più backend, o formato nativo degradato a import/export?
- Che ne è di `in_review` e degli stati, se lo store ha i propri?
- Il board resta di harness o si eredita quello del substrato?
- **Esporre harness come server MCP**: quanto costa, e cosa espone — solo lettura, o anche le
  mutazioni con i guard dentro?
- **Dimagrire invece di standardizzarsi**: strada non ancora esaminata. Harness resta proprietario
  dello storage ma cancella il substrato opzionale (board, paginazione, `--compact`, `--upgrade`)
  e tiene un core minimo. Zero dipendenze nuove, zero barriera, meno codice.

*Chiuse al secondo giro:* esistono standard su cui appoggiarsi? No (§5). MCP può astrarre lo
store? No, ma serve in uscita (§6).

## Come si riprende

Rileggere §2, §3 e §4: sono il progetto, e valgono qualunque strumento si guardi. §5 è stabile —
uno standard non nasce in un trimestre, ma vale la pena ricontrollare se OSSA sia sopravvissuto e
se qualcuno abbia normato il de-facto di beads. §6 è materiale deperibile: i numeri vanno
rimisurati, non fidarsi di quelli scritti qui a distanza di mesi.

Aggiungere il candidato nuovo a §6 giudicandolo sui sei criteri di §3, uno per uno, e dire quale
non passa invece di dare un voto complessivo. Un candidato che fallisce il criterio 1 è fuori
senza bisogno di guardare il resto: è lì che vive la tesi.
