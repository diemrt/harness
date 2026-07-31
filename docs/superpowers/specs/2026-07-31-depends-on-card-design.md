# Board: la card delle dipendenze

Data: 2026-07-31
Stato: approvato in brainstorming, da pianificare

## Problema

Il campo `depends_on` esiste, è validato ed è popolato su dati reali
([spec del 2026-07-30](2026-07-30-board-workflow-design.md), sezioni 1-3), ma il board non lo
mostra. Una issue che dipende da altre tre si presenta identica a una che non dipende da
niente: l'unica informazione che il campo ha aggiunto al tracker è invisibile proprio nel posto
dove si decide cosa lavorare.

Il tentativo precedente rispondeva con una vista a grafo intera, ed è stato ritirato — non
perché non funzionasse, ma perché decideva in un colpo solo una dozzina di questioni di
interfaccia che nessuno aveva ancora avuto il bisogno di porsi. Questo documento fa la cosa più
piccola che rende il dato utile, e si ferma lì.

## Cosa cambia, in una riga

Ogni card elenca le issue da cui dipende, come chip cliccabili che portano a quella issue.

## 1. La funzione

Una funzione pura in `scripts/board.html`, sulla falsariga di `renderCriteria`:

```js
renderDependsOn(dependsOn, visibleIds, titleById) -> string
```

| argomento | tipo | cosa contiene |
|---|---|---|
| `dependsOn` | `string[]` | il campo della issue, così com'è; assente o vuoto vale "niente da rendere" |
| `visibleIds` | `Set<string>` | gli id renderizzati in questo giro |
| `titleById` | `Map<string,string>` | id → titolo, per il tooltip |

**Perché tre argomenti e non zero.** `extractFunctions`
(`test/plugin-board.test.mjs:287`) ritaglia una funzione dalla pagina servita contando le
graffe e la valuta in uno scope isolato: può chiamare solo ciò che le si passa. Una funzione
che legge `state` o interroga il DOM non è chiamabile da lì, e il test ripiegherebbe su una
regexp sull'HTML — che passa su un renderer presente e sbagliato. Gli argomenti non sono uno
stile, sono la condizione perché il test valga qualcosa.

I due indici si calcolano in `renderIssues()` a partire da `items`, **prima** del
`.map(issueCard)`: sono già la lista di ciò che sta per finire sul DOM, quindi nessuna
interrogazione del DOM e nessuna seconda fonte di verità.

## 2. Il markup

Un blocco fra la riga del titolo (`board.html:353-361`) e la description (`:363`):

```
Dipende da  [10067a5b] [4829cd1d] [2e2e7220]
             ↑ cliccabile          ↑ grigio, inerte
```

- **Chip cliccabile** — `<a href="#issue-<guid>">`, mono, primi 8 caratteri del GUID.
- **Chip inerte** — `<span>`, grigio. Non un `<a>` disabilitato: non deve entrare nell'ordine
  di tabulazione fingendosi un comando che poi non risponde.
- **`title`** — il GUID intero, più il titolo della issue puntata quando quell'id è nel
  payload; il solo GUID quando non c'è.
- Ordine dei chip = ordine dell'array. Non riordinato, non deduplicato: il campo è già
  validato contro i duplicati dalla CLI.
- `depends_on` assente o vuoto → stringa vuota, nessun contenitore, nessuna etichetta. È lo
  stesso comportamento di `renderTierBadge` col tier assente: l'assenza è il caso normale, non
  un errore da segnalare.

**Otto caratteri e non trentasei.** Un GUID intero è 36 caratteri; tre dipendenze in fila sono
oltre cento caratteri di esadecimale sopra la description, e il fan-in reale su questo tracker
arriva a tre. Otto è la convenzione git, è univoco su qualunque tracker di questa scala, e il
GUID intero resta a un hover di distanza per il copia-incolla.

## 3. Due rami, non tre

Il chip è cliccabile se e solo se `visibleIds.has(id)`. Tutto il resto è grigio.

Questo fa collassare due situazioni diverse nello stesso stato visivo:

| situazione | perché succede |
|---|---|
| la issue esiste ma è filtrata via | il board filtra client-side per stato e per ricerca; la vista di default è `wip` (`board.html:140`), che esclude `done` |
| l'id non esiste nel tracker | la CLI lo vieta, ma `issues.json` è un file e qualcuno può editarlo a mano |

La distinzione sopravvive solo nel testo del `title`, dove costa un ternario. Un terzo stato
visivo pretenderebbe che la differenza importi a chi guarda, e non importa: in entrambi i casi
il salto non ha dove atterrare, ed è quello che il grigio dice.

**Conseguenza accettata:** nella vista `wip` di default una dipendenza già chiusa è sempre
grigia. Sul tracker al momento della decisione erano 2 archi su 11. È il prezzo di non avere
logica di recupero, ed è stato scelto sapendolo.

## 4. Il salto

Nessun JavaScript: nessun handler, nessun `scrollIntoView`, nessun timer.

- `id="issue-<guid>"` sull'`<article>` di ogni card;
- `html { scroll-behavior: smooth }`, annullato sotto `prefers-reduced-motion: reduce`;
- `.issue-card:target { outline: … }` per dire quale card è quella richiesta.

**Perché `:target` e non una classe applicata a mano.** `renderIssues()` ricostruisce la lista
con `innerHTML` a ogni evento SSE. Una classe `.flash` messa da JavaScript verrebbe spazzata
via da quella ricostruzione e andrebbe riapplicata a mano. `:target` si valuta contro l'hash
dell'URL, che il re-render non tocca: l'evidenziazione si riapplica da sola, gratis.

Un hash che punta a una card non più renderizzata non fa nulla e non rompe nulla.

## 5. Test

In `test/plugin-board.test.mjs`, `renderDependsOn` estratta con `extractFunctions` insieme a
`escapeHtml`:

- array vuoto e campo assente → `""`;
- dipendenza fra le visibili → `<a href="#issue-…">`, chip di 8 caratteri;
- dipendenza filtrata via → `<span>`, nessun `href`;
- id ignoto → `<span>`, `title` col solo GUID;
- ordine dei chip = ordine dell'array;
- titolo contenente `<script>` escapato nel `title`.

Più i marker sulla pagina servita, nella prova che già controlla i marker: `id="issue-` e
`.issue-card:target`.

**Gap dichiarato:** lo scroll e l'evidenziazione `:target` non sono coperti da test — sono
comportamento del browser e il repository non ha un headless. Restano alla prova manuale in
sessione, che `CLAUDE.md` impone comunque per ogni modifica al plugin.

## Fuori scope

- L'arco inverso ("quali issue dipendono da questa").
- Qualsiasi vista, filtro o toggle nuovo; nessun cambio alla vista `wip` e ai filtri di stato.
- Qualsiasi scrittura dal board: resta una vista, le modifiche passano dalla CLI.
- Riaprire il restyle senza CDN e il ritiro di `proposals/board-minimal.html`, che tornano a
  essere questioni aperte e non vengono decise qui.
