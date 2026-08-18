# Gate documentale

Dopo un commit che tocca codice va aperta una issue docs. Lo prescrive
[SKILL.md](../SKILL.md) — e in `SKILL.md` è un'istruzione che qualcuno deve **ricordarsi** di
eseguire. Sul primo progetto che ha usato harness per un lavoro lungo ha retto una volta su tre, e
il risultato misurabile è un `ARCHITECTURE.md` che descriveva un framework di due versioni prima e
una pipeline di test che non esiste.

`docs-gate.mjs` non impedisce di dimenticarsene. Rende il dimenticarsene **recuperabile**:

> quali commit hanno toccato codice senza che nessuna issue li nomini.

`$SCRIPTS` = `${CLAUDE_PLUGIN_ROOT}/scripts`.

```bash
node "$SCRIPTS/docs-gate.mjs" [--project-dir <path>] [--since <rev>] [--help]
```

**Non scrive niente. Nessun flag lo fa scrivere.** Le issue che mancano le apre chi legge
l'output, con `--insert`, dichiarando in `covers` la revisione coperta ([issues.md](issues.md)).

Non c'è nessuna configurazione nuova: `docsGate.include` / `docsGate.exclude` in
`.harness/config.json` esistono già e servono già esattamente a questo ([config.md](config.md)).
Con `docsGate.enabled: false` lo script lo dichiara in una riga e si ferma.

## Cumulativo, mai puntuale

È il vincolo da cui nasce tutto il resto. Un controllo su `HEAD`, lanciato a mano dopo quindici
commit, direbbe la cosa giusta **sul commit sbagliato**.

I numeri che lo impongono vengono dal progetto in cui il gate è saltato: tredici sessioni, 82
commit, 41 riepiloghi del tracker. Il riepilogo gira ai **confini** — clock-in, clock-out, fine di
un blocco — e *dentro* le sessioni lunghe collassa: in una finestra ci sono undici commit
consecutivi senza un solo `status`, in un'altra quindici. E quella finestra di undici commit è
esattamente il tratto di lavoro la cui issue docs non è mai nata.

La conclusione non è «serve un rito migliore»: è che **nessun rito è affidabile durante il
lavoro**. Quindi il controllo risponde su una finestra di storia, non sull'ultimo commit — e chi
se ne ricorda una volta a fine giornata recupera tutti e quindici i commit, non l'ultimo.

**Cosa questo compra, e cosa no.** Un comando dedicato **non** difende dal dimenticarsene: è la
stessa forma dell'istruzione che è già fallita. Quello che lo rende comunque utile è la
cumulatività: il costo del dimenticarsene diventa un **ritardo, non una perdita**, ed è questo —
non la puntualità — il difetto che si stava riparando.

## La finestra, e come si autocalibra

La finestra parte dal **più vecchio commit nominato da una issue** in `covers`, e arriva a `HEAD`.
Quel commit è coperto per definizione — è quello che una issue nomina — quindi la finestra è ciò
che gli è venuto dopo.

Perché non «tutta la storia»: harness conosce solo il periodo in cui è stato usato, e su un
repository che lo precede di anni una finestra totale produrrebbe migliaia di righe.

**Al primo uso, quando nessuna issue nomina niente, lo script si ferma e chiede `--since <rev>`
esplicito.** Non indovina un punto di partenza: un default sbagliato qui non produce un errore,
produce un elenco plausibile e inutile, che è peggio. Vale anche per un tracker ancora a
`schema_version: 1`, dove il campo `covers` non c'è: zero revisioni dichiarate, quindi `--since`,
che è il comportamento corretto.

I **merge** non entrano nella finestra: `--name-only` non stampa file per un merge, e contarli
gonfierebbe il conteggio con righe che non possono mai essere codice.

## I riferimenti si risolvono, non si confrontano come stringhe

Ogni riferimento dichiarato passa per `git rev-parse`, così **uno SHA corto e uno lungo sono la
stessa revisione** e un tag è il commit che punta.

Un riferimento che **non risolve** viene riportato in un'allerta, non silenziosamente ignorato: è
la differenza fra un dato sbagliato che si vede e uno che passa. Non è un errore e non cambia il
codice d'uscita — è un dato del report come gli altri.

## Copertura significa «esiste», non «chiusa»

Una issue in `backlog` che nomina quel commit **basta** a considerarlo coperto. Il gate è un
promemoria tracciato, non un veto — è scritto così in [SKILL.md](../SKILL.md), e stringere qui lo
trasformerebbe in un blocco.

## Il canale è stdout, e il formato è testo

**Stdout porta tutto, anche gli errori. Su stderr non finisce mai niente**, nemmeno il rumore di
git. **L'output è testo, mai JSON**: come `status-cli.mjs` ([status.md](status.md)), questo
comando parla a un umano che legge un blocco di codice, non ha consumatori automatici e non deve
acquisirne.

## Come si legge l'output

```
 harness · gate documentale
 finestra da a1b2c3d4 · più vecchia revisione dichiarata
 ! 1 riferimento dichiarato non risolve: deadbeef
════════════════════════════════════════════════════════════════════════════════
 12 commit nella finestra · 7 toccano codice · 3 non coperti

 NON COPERTI
 ───────────────────────────────────────────────────────────────────────────────
  4f2a1b8c  feat: alert lines and empty states             3 file
  9c31e07d  feat: header, proportional bar and legend      5 file
  a47813e7  fix: canonicalise the tracker project dir      2 file
 ───────────────────────────────────────────────────────────────────────────────
 coperto = una issue lo dichiara in covers, in qualunque stato
```

Larghezza fissa **80 colonne**, niente colore e niente ANSI: l'output finisce in un blocco
markdown reso dalla sessione, e le distinzioni le portano allineamento e icone.

- **intestazione, due righe** — progetto sulla prima, finestra sulla seconda col motivo per cui
  parte da lì: `--since` oppure `più vecchia revisione dichiarata`. Sono due righe e non una
  perché insieme sfondano le 80 colonne su un nome di progetto qualsiasi.
- **allerte** — righe con `!`, **sopra la barra** perché sono la prima cosa da leggere. Vanno a
  capo, non si troncano: il riferimento irrisolto è la stringa che va copiata fuori.
- **conteggi** — `<n> commit nella finestra` è tutto ciò che è stato guardato; `<n> toccano
  codice` è il sottoinsieme che `docsGate` seleziona; `<n> non coperti` è il lavoro da fare.
  Al singolare la riga concorda — `1 tocca codice · 1 non coperto` — perché un verbo plurale su
  un elemento solo si legge come un errore nel conteggio.
- **NON COPERTI** — sha corto a 8 caratteri, soggetto troncato a 45, e quanti **file di codice**
  quel commit ha toccato (non quanti file in tutto). Solo gli scoperti: elencare anche i coperti
  produrrebbe una lista che nessuno legge.
- **stato vuoto** — `nessun commit di codice scoperto` è il risultato buono, e si scrive perché
  una sezione vuota si legge come un output rotto.

## Codici d'uscita

| caso | uscita |
|---|---|
| report stampato, **anche con commit scoperti** | 0 |
| `--help` | 0 |
| `docsGate.enabled: false` | 0, una riga |
| nessuna revisione dichiarata e nessun `--since` | 1, una riga che chiede `--since` |
| `--since` che non risolve | 1, una riga |
| `--project-dir` inesistente | 1, una riga |
| `.harness/config.json` mancante o illeggibile | 1, una riga |
| tracker che `issue-manager --dump` non riesce a leggere, o non ancora migrato | 1, una riga |
| la directory non è un repository git, o git non c'è | 1, una riga |
| flag sconosciuto | 1, una riga |

**Trovare commit scoperti non è un fallimento, ed esce 0.** Un codice d'uscita diverso sarebbe
comodo in CI e romperebbe il contratto che ogni altro script del plugin rispetta, dove `1`
significa *la richiesta non è stata eseguita*. Chi vuole un gate di CI legge l'output.

Un `.harness/config.json` mancante esce 1 invece di ripiegare su un default: quali file contano
come codice è una decisione del progetto, e indovinarla in silenzio è la cosa che
[config.md](config.md) vieta. Un `docsGate` **parziale** dentro un config che esiste viene invece
completato campo per campo con i default, come fa già `harness-config.mjs` alla scrittura.

## Le due superfici

**Dentro la sessione** — `/harness:docs-gate`. L'agente lancia lo script e ne ristampa l'output
verbatim in un blocco di codice.

**Da un terminale esterno** — `node <path-plugin>/scripts/docs-gate.mjs`, stesso identico testo.
