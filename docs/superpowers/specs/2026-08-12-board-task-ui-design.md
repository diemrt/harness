# Board: il blocco task parla la lingua della pagina

Data: 2026-08-12
Stato: approvato in brainstorming, da pianificare

## Problema

Il blocco task è arrivato sulla card in una sessione in cui il resto della pagina non è stato
guardato, e si vede. Tutta `scripts/board.html` è disegnata con daisyUI — badge a pillola,
`rounded-xl` sui contatori, ombre leggere, icone lucide, colori semantici presi da `STATUS_META`
e `VALIDATION_META`. Il blocco task, e solo lui, è disegnato come un terminale:

- la barra di avanzamento è una stringa di glifi, `"▓".repeat(n) + "░".repeat(10 - n)`, resa in
  `font-mono` (`board.html:399-405`);
- i marcatori dei singoli task sono `[x]` e `[ ]`, anch'essi in `font-mono`
  (`board.html:434`);
- il conteggio `3/5` è in `font-mono` accanto alla barra (`board.html:451`).

Non è un difetto funzionale: il blocco fa quello che deve, e l'invariante che difende — barra
piena solo a lavoro finito — è giusta e va conservata. È un difetto di coerenza, ed è l'unico
punto della pagina in cui un lettore vede due design system nello stesso riquadro.

**Questo documento non adotta un design unificato** e non tocca nessun altro componente: porta il
blocco task dentro il linguaggio che la pagina già parla, e si ferma lì.

## Cosa cambia, in una riga

La barra ASCII diventa il `progress` di daisyUI, i marcatori `[x]`/`[ ]` diventano icone lucide,
e dalla riga di riepilogo sparisce ogni `font-mono`.

## 1. La riga di riepilogo

Resta una riga sola, resta dentro il `<summary>`, resta l'unica cosa visibile a blocco chiuso.
Cambiano i tre elementi a destra dell'etichetta:

```
› TASK  (═════─────)  (3/5)
        ↑ progress    ↑ badge badge-ghost badge-sm
          w-24 h-1.5
          arrotondato
```

| elemento | prima | dopo |
|---|---|---|
| chevron | `<i data-lucide="chevron-right">` con `group-open:rotate-90` | invariato |
| etichetta `task` | `text-xs uppercase tracking-wide opacity-70` | invariata |
| barra | `▓░` in `font-mono` | `<progress class="progress w-24 h-1.5 align-middle">` |
| conteggio | `3/5` in `font-mono` | `3/5` dentro `<span class="badge badge-ghost badge-sm">` |

**L'etichetta non cambia** di proposito: `text-xs uppercase tracking-wide opacity-70` è già la
grafia delle altre due micro-intestazioni della card, «Dipende da» (`board.html:391`) e
«Validazione» (`board.html:468`). Era l'unica parte del blocco già coerente.

**Il conteggio va in un badge** perché il badge è il contenitore che questa pagina usa per ogni
dato breve e discreto: stato, tier, esito di validazione, chip di dipendenza. `badge-ghost` è la
variante neutra, la stessa che `VALIDATION_META.unknown` usa già.

## 2. I colori: neutro finché parziale, success a completo

`progress` senza modificatore (neutro) finché `done < total`; `progress progress-success` solo
quando `done === total`.

Il colore dice una cosa sola — finito / non finito — che è anche l'unica cosa che la barra ha
sempre voluto dire. Le alternative sono state guardate e scartate: colorare la barra con lo stato
della issue ripete un'informazione che il badge accanto al titolo porta già, e un colore fisso
(`progress-primary`) rende la barra decorativa.

**L'invariante cambia natura, non contenuto.** Oggi «piena solo se finita» è una difesa contro
l'arrotondamento, scritta a mano in `progressBar` (`Math.min(cells - 1, …)`): senza quel
correttivo, 9 task su 10 riempirebbero tutte e dieci le celle. Con `value`/`max` sui numeri veri
la difesa non serve più — il 100% esiste se e solo se `done === total` — e resta come proprietà
del dato invece che come correzione del rendering.

## 3. I marcatori dei task

Nell'elenco espanso, al posto di `[x]` / `[ ]`:

| stato | markup |
|---|---|
| spuntato | `<i data-lucide="check-circle" class="w-4 h-4 text-success shrink-0">` |
| aperto | `<i data-lucide="circle" class="w-4 h-4 opacity-40 shrink-0">` |

`check-circle` è il nome già usato da `STATUS_META.done` (`board.html:143`): la pagina lo rende
correttamente con la versione di lucide che carica, e riusarlo non introduce una dipendenza da un
nome nuovo.

**Icone e non checkbox.** Una `checkbox` daisyUI disabilitata sarebbe il componente più aderente
al design system, e sarebbe la scelta sbagliata: dal browser i task non si spuntano — non è una
funzione mancante, è il guard anti-self-validation che vive nell'environment del processo
(`references/board.md`, «Cosa non fa») — e una casella spenta invita a un click che non esiste.

Restano invariati il `line-through opacity-60` sul titolo spuntato e la `full_description` in
`text-xs opacity-60` sotto ogni voce.

## 4. Il codice toccato

Due funzioni in `scripts/board.html`, nient'altro.

**`progressBar(done, total)` cambia contratto**: da stringa di glifi a markup del `<progress>`.
Il nome resta, così la lista di `extractFunctions` nei test non si muove e il diff resta leggibile.

```js
progressBar(0, 0)  -> ""                       // nessun task: nessuna barra
progressBar(3, 5)  -> '<progress class="progress w-24 h-1.5 align-middle" value="3" max="5">…'
progressBar(4, 4)  -> '<progress class="progress progress-success w-24 h-1.5 …" value="4" max="4">…'
```

Resta pura e resta senza dipendenze dallo scope della pagina: è la condizione perché
`extractFunctions` possa ritagliarla e valutarla in isolamento.

**`renderTaskBlock(tasks, options)`** cambia solo il markup che compone — riga di riepilogo e
righe dei task. Firma, opzioni, gestione di `expanded`, escaping e ritorno vuoto su array vuoto
restano identici.

Non si toccano: `issueCard`, `renderCriteria`, `renderDependsOn`, `bindTaskExpansion`, il CSS in
`<style>`, `board-server.mjs`, la CLI, lo schema.

## 5. Test

`test/plugin-board.test.mjs`. Un test cambia, tre restano:

- **da riscrivere** — `progressBar fills only when the work is actually finished` (`:718`)
  asserisce oggi i glifi `▓`/`░`. Le stesse proprietà, sugli attributi: `progressBar(0, 0)` vuoto;
  `value` e `max` uguali ai numeri passati; `progress-success` assente a `3/5` e a `9/10`,
  presente a `4/4`. Il nome del test resta valido — è la proprietà che descrive, non il glifo;
- **invariati** — il riepilogo in una riga (`:738`, asserisce `1/2`, il titolo e la
  `full_description`), l'espansione che sopravvive al re-render (`:763`), il blocco vuoto
  (`:785`), l'escaping (`:802`). Nessuno di questi guarda la grafica.

## 6. Validazione: il gate è l'occhio dell'utente

Non ci sono criteri elaborati sull'aspetto, per scelta esplicita: un criterio scritto su
un'estetica è un criterio che un altro agente non sa applicare, e sarebbe finto.

- **gate automatico** — `npm test` verde. È l'unica cosa che una macchina può dire su questo
  lavoro;
- **gate umano** — il board viene avviato e l'utente approva o rifiuta guardandolo. Se rifiuta, si
  corregge e si ri-avvia. Non c'è nessun altro criterio di accettazione, e questo va scritto nella
  issue così com'è.

**Su un progetto temporaneo, non sul tracker vero.** Delle 44 issue di questo repository, 7 portano
task: tutte `done`, tutte con l'array di esecuzione completo (`6/6`, `7/7`, `5/5`, `3/3`), e nessuna
con `validation.tasks`. Il tracker vero mostra quindi **un solo** dei quattro casi — la barra piena
— e per giunta sotto un filtro diverso da quello di default, che esclude le `done`. Gli altri tre e
la riga dentro il riquadro *Validazione* non esistono su questi dati, e non si possono fabbricare
scrivendo nel tracker: `CLAUDE.md` lo vieta esplicitamente («per esercitare il tracker si usa una
directory temporanea, come fa già la suite di test»).

Il board si avvia quindi con `--project-dir` su una directory temporanea seminata con quattro
casi, che sono i quattro stati che il rendering distingue:

| caso | cosa deve mostrare |
|---|---|
| `0/4` | barra vuota, neutra |
| `3/5` | barra parziale, neutra, con almeno una cella libera |
| `5/5` | barra piena, `progress-success` |
| nessun task | nessuna riga di riepilogo, nessuno spazio occupato |

Almeno una delle issue porta anche `validation.tasks`, perché la seconda riga di riepilogo — quella
dentro il riquadro *Validazione* — sta su uno sfondo diverso (`bg-base-200/60`) ed è lì che un
colore neutro sbagliato si vedrebbe.

## Fuori scope

- Un design system unificato per la pagina: dichiarato non desiderato adesso.
- La dipendenza da CDN di Tailwind/daisyUI/lucide e il destino di `proposals/board-minimal.html`:
  restano questioni aperte, non vengono decise qui.
- Qualsiasi altro componente della card: titolo, badge di stato, tier, dipendenze, criteri, piè di
  pagina.
- Spuntare i task dal browser: resta impossibile, e per un motivo che non è estetico.
- Il tema della pagina (`data-theme="light"` fissato su `<html>`) e qualsiasi dark mode.
