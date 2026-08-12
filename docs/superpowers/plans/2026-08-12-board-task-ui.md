# Board task UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ridisegnare il blocco task della card del board con i componenti daisyUI che il resto
della pagina usa già, al posto della barra ASCII e dei marcatori `[x]`/`[ ]` in monospace.

**Architecture:** Due funzioni pure in `scripts/board.html` — `progressBar` e `renderTaskBlock` —
cambiano il markup che producono. `progressBar` passa da stringa di glifi a un elemento
`<progress>` di daisyUI; `renderTaskBlock` sostituisce i marcatori monospace con icone lucide e
mette il conteggio in un badge. Nessun file nuovo, nessun CSS nuovo, nessun cambio a server,
CLI o schema.

**Tech Stack:** HTML + JavaScript vanilla in `scripts/board.html`; Tailwind CSS, daisyUI 4.12.10 e
lucide caricati da CDN; test con `node:test` in `test/plugin-board.test.mjs`.

**Spec:** [docs/superpowers/specs/2026-08-12-board-task-ui-design.md](../specs/2026-08-12-board-task-ui-design.md)

## Global Constraints

- Le funzioni toccate restano **pure e senza accesso a `state` o al DOM**: `extractFunctions`
  (`test/plugin-board.test.mjs`) le ritaglia dalla pagina servita e le valuta in uno scope isolato,
  dove nessun globale della pagina esiste.
- `renderTaskBlock` riceve le opzioni come **un oggetto unpacked nel corpo**, mai destrutturato
  nella firma: `extractFunctions` conta le graffe dalla prima dopo il nome, e un pattern di
  destructuring nei parametri la chiuderebbe subito.
- Nessuna modifica a `issues.json` alla radice: le prove si fanno su una directory temporanea
  (`CLAUDE.md`).
- I nomi delle funzioni non cambiano: la lista passata a `extractFunctions` nei test resta
  `["renderTaskBlock", "escapeHtml", "progressBar"]`.
- Icone lucide solo con nomi già presenti nella pagina o loro varianti base: `check-circle`
  (già in `STATUS_META.done`) e `circle`.
- Comando di verifica del progetto: `npm test`.

---

### Task 1: `progressBar` produce un `<progress>` invece di glifi

**Files:**
- Modify: `scripts/board.html:396-405` (commento + corpo di `progressBar`)
- Test: `test/plugin-board.test.mjs:718-736`

**Interfaces:**
- Consumes: niente da task precedenti.
- Produces: `progressBar(done: number, total: number) -> string`. Ritorna `""` se `total` è 0 o
  assente; altrimenti il markup di un singolo elemento `<progress>` con attributi `value="<done>"`
  e `max="<total>"`, e la classe `progress-success` **solo** quando `done >= total`. Task 2 lo
  chiama dentro il `<summary>`.

- [ ] **Step 1: Riscrivere il test sui glifi in un test sugli attributi**

In `test/plugin-board.test.mjs`, sostituire integralmente il test alla riga 718 con:

```js
test("progressBar fills only when the work is actually finished", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { progressBar } = extractFunctions(html, ["progressBar"]);

    assert.equal(progressBar(0, 0), "");

    const empty = progressBar(0, 4);
    assert.match(empty, /<progress\b/);
    assert.match(empty, /value="0"/);
    assert.match(empty, /max="4"/);
    assert.ok(!empty.includes("progress-success"), "an empty bar is never the success tone");

    // Nine of ten is not ten of ten. The tone is the whole message the colour carries, so it
    // arrives only on the last task: a bar that went green at 90% would show as finished work
    // that is not, which is the fresh-looking stale datum this board refuses everywhere else.
    assert.ok(!progressBar(9, 10).includes("progress-success"));

    const full = progressBar(4, 4);
    assert.match(full, /value="4"/);
    assert.match(full, /max="4"/);
    assert.ok(full.includes("progress-success"));

    // The bar is a component now, not a string of characters drawn by hand.
    assert.ok(!full.includes("▓"), "no glyph bar survives");
    assert.ok(!empty.includes("░"), "no glyph bar survives");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Lanciare il test e vederlo fallire**

Run: `node --test test/plugin-board.test.mjs`
Expected: FAIL sul test `progressBar fills only when the work is actually finished` — la funzione
attuale ritorna `"░░░░░░░░░░"`, quindi `assert.match(empty, /<progress\b/)` non trova nulla.

- [ ] **Step 3: Riscrivere `progressBar`**

In `scripts/board.html`, sostituire il commento e il corpo alle righe 396-405 con:

```js
    // A daisyUI progress and not a string of glyphs: everything else on this page is drawn with
    // the design system, and this row was the only place speaking another alphabet.
    //
    // The invariant it used to defend by hand — full only when finished — is now a property of
    // the data: value and max are the real numbers, so 100% exists if and only if every task is
    // checked. What is left to decide is the tone, and that is the same rule: success arrives on
    // the last task, never one before.
    function progressBar(done, total) {
      if (!total) return "";
      const tone = done >= total ? " progress-success" : "";
      return `<progress class="progress${tone} w-24 h-1.5 align-middle" value="${done}" max="${total}"></progress>`;
    }
```

- [ ] **Step 4: Lanciare il test e vederlo passare**

Run: `node --test test/plugin-board.test.mjs`
Expected: PASS su tutti i test del file. I tre test su `renderTaskBlock` (righe 738, 763, 785, 802)
non guardano la barra e devono restare verdi senza modifiche.

- [ ] **Step 5: Commit**

```bash
git add scripts/board.html test/plugin-board.test.mjs
git commit -m "feat: the task bar is a component, not a string of glyphs"
```

---

### Task 2: la riga di riepilogo e i marcatori dei task

**Files:**
- Modify: `scripts/board.html:420-455` (corpo di `renderTaskBlock`: `rows` e il template del
  `<details>`)
- Test: `test/plugin-board.test.mjs` (un test nuovo, subito dopo quello alla riga 738)

**Interfaces:**
- Consumes: `progressBar(done, total)` dal Task 1, chiamata dentro il `<summary>`.
- Produces: `renderTaskBlock(tasks, options) -> string` con firma invariata —
  `options = { issueId, kind, label, expanded }`. Nessun task successivo dipende da questo output
  se non il gate visivo del Task 3.

- [ ] **Step 1: Scrivere il test che fallisce**

In `test/plugin-board.test.mjs`, inserire questo test subito dopo il test
`a task block summarises in one row and keeps the tasks collapsed` (che finisce alla riga 761):

```js
test("the task row is drawn with the design system, not with characters", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { renderTaskBlock } = extractFunctions(html, ["renderTaskBlock", "escapeHtml", "progressBar"]);

    const rendered = renderTaskBlock([boardTask(1, { checked: true }), boardTask(2)], {
      issueId: "abc",
      kind: "exec",
      label: "task",
      expanded: new Set(),
    });

    // The summary row: a real progress element and a badge, the two containers the rest of the
    // card already uses for a bar and for a short discreet datum.
    assert.match(rendered, /<progress\b/);
    assert.match(rendered, /badge badge-ghost/);

    // The markers: the same icon alphabet as every other glyph on the card.
    assert.match(rendered, /data-lucide="check-circle"/);
    assert.match(rendered, /data-lucide="circle"/);

    // And nothing of the terminal left behind.
    assert.ok(!rendered.includes("[x]"), "no monospace checkbox survives");
    assert.ok(!rendered.includes("[ ]"), "no monospace checkbox survives");
    assert.ok(!/font-mono/.test(rendered), "the row carries no monospace class");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Lanciare il test e vederlo fallire**

Run: `node --test test/plugin-board.test.mjs`
Expected: FAIL sul test nuovo — `assert.match(rendered, /badge badge-ghost/)` non trova nulla,
perché il conteggio è ancora un `<span class="font-mono …">`, e i marcatori sono ancora `[x]`/`[ ]`.

- [ ] **Step 3: Riscrivere il markup di `renderTaskBlock`**

In `scripts/board.html`, sostituire la costruzione di `rows` (righe 430-441) con:

```js
      const rows = items
        .map(
          (t) => `
            <li class="flex items-start gap-2">
              <i data-lucide="${t.checked === true ? "check-circle" : "circle"}" class="w-4 h-4 shrink-0 mt-0.5 ${
                t.checked === true ? "text-success" : "opacity-40"
              }"></i>
              <span>
                <span class="${t.checked === true ? "line-through opacity-60" : ""}">${escapeHtml(t.short_title)}</span>
                <span class="block text-xs opacity-60 preserve-newlines">${escapeHtml(t.full_description)}</span>
              </span>
            </li>`
        )
        .join("");
```

e il `return` del template (righe 443-454) con:

```js
      return `
        <details class="mt-2 group" data-issue="${escapeHtml(issueId)}" data-kind="${escapeHtml(kind)}"${
          expanded && expanded.has(key) ? " open" : ""
        }>
          <summary class="flex items-center gap-2 cursor-pointer text-xs uppercase tracking-wide opacity-70">
            <i data-lucide="chevron-right" class="w-3 h-3 transition-transform group-open:rotate-90"></i>
            <span>${escapeHtml(label)}</span>
            ${progressBar(done, items.length)}
            <span class="badge badge-ghost badge-sm normal-case tracking-normal">${done}/${items.length}</span>
          </summary>
          <ul class="mt-2 space-y-1.5 text-sm">${rows}</ul>
        </details>`;
```

L'etichetta e le sue classi non si toccano: `text-xs uppercase tracking-wide opacity-70` è già la
grafia di «Dipende da» e «Validazione» sulla stessa card.

- [ ] **Step 4: Lanciare tutti i test e vederli passare**

Run: `npm test`
Expected: PASS su tutta la suite. In particolare devono restare verdi senza modifiche i test
`a task block summarises in one row and keeps the tasks collapsed` (asserisce `1/2`, che ora vive
dentro il badge), `an expanded block comes back expanded after a re-render`,
`a card with no tasks renders no block at all` e
`task text is escaped like every other field on the card`.

- [ ] **Step 5: Commit**

```bash
git add scripts/board.html test/plugin-board.test.mjs
git commit -m "feat: task markers and count speak the card's language"
```

---

### Task 3: approvazione visiva sul board

Questo task non ha test automatici, e non è una dimenticanza: il gate è l'occhio dell'utente, come
la spec dichiara alla sezione 6. Il lavoro di questo task è **mettere l'utente nelle condizioni di
guardare i quattro casi in una schermata sola**.

**Files:**
- Create: `<scratchpad>/board-fixture/issues.json` — fuori dal repository, mai committato
- Modify: nessuno

**Interfaces:**
- Consumes: il rendering dei Task 1 e 2.
- Produces: un verdetto umano. Approvato → il lavoro è finito. Rifiutato → si torna al Task 1 o 2
  con la correzione richiesta e si ripete questo task.

- [ ] **Step 1: Scrivere il tracker di prova**

Creare `board-fixture/issues.json` nella directory di scratchpad della sessione (mai nel
repository) con questo contenuto esatto — quattro issue, i quattro casi che il rendering distingue:

```json
{
  "schema_version": 3,
  "project": "Fixture board",
  "last_updated": "2026-08-12T00:00:00Z",
  "issues": [
    {
      "id": "aaaaaaaa-0000-4000-8000-000000000001",
      "title": "Nessun task: la card non deve mostrare nessuna riga",
      "description": "Caso di controllo. Senza task non c'e' niente da riassumere e la riga non deve occupare spazio.",
      "status": "backlog",
      "tier": "economy",
      "depends_on": [],
      "covers": [],
      "tasks": [],
      "validation": { "criteria": ["Nessuna riga di riepilogo su questa card."], "tasks": [], "state": "unknown" },
      "created_at": "2026-08-12T00:00:00Z",
      "updated_at": "2026-08-12T00:00:00Z"
    },
    {
      "id": "aaaaaaaa-0000-4000-8000-000000000002",
      "title": "Barra vuota: 0 su 4, neutra",
      "description": "Nessun task spuntato. La barra deve essere completamente vuota e di tono neutro.",
      "status": "in_progress",
      "tier": "standard",
      "depends_on": [],
      "covers": [],
      "tasks": [
        { "id": 1, "short_title": "Primo passo ancora da fare", "full_description": "Descrizione del primo passo, in piccolo sotto il titolo.", "checked": false },
        { "id": 2, "short_title": "Secondo passo ancora da fare", "full_description": "Descrizione del secondo passo.", "checked": false },
        { "id": 3, "short_title": "Terzo passo ancora da fare", "full_description": "Descrizione del terzo passo.", "checked": false },
        { "id": 4, "short_title": "Quarto passo ancora da fare", "full_description": "Descrizione del quarto passo.", "checked": false }
      ],
      "validation": { "criteria": ["La barra e' vuota e neutra."], "tasks": [], "state": "unknown" },
      "created_at": "2026-08-12T00:00:00Z",
      "updated_at": "2026-08-12T00:00:00Z"
    },
    {
      "id": "aaaaaaaa-0000-4000-8000-000000000003",
      "title": "Barra parziale: 3 su 5, con validazione a 1 su 3",
      "description": "Il caso che si vede piu' spesso mentre si lavora: due righe di riepilogo, una sotto la description e una dentro il riquadro Validazione, che sta su uno sfondo diverso.",
      "status": "in_progress",
      "tier": "reasoning",
      "depends_on": [],
      "covers": [],
      "tasks": [
        { "id": 1, "short_title": "Passo concluso", "full_description": "Spuntato: titolo barrato e icona verde.", "checked": true },
        { "id": 2, "short_title": "Secondo passo concluso", "full_description": "Spuntato.", "checked": true },
        { "id": 3, "short_title": "Terzo passo concluso", "full_description": "Spuntato.", "checked": true },
        { "id": 4, "short_title": "Passo aperto", "full_description": "Non spuntato: cerchio opaco, titolo pieno.", "checked": false },
        { "id": 5, "short_title": "Ultimo passo aperto", "full_description": "Non spuntato.", "checked": false }
      ],
      "validation": {
        "criteria": ["La barra dentro il riquadro Validazione si legge sullo sfondo base-200."],
        "tasks": [
          { "id": 1, "short_title": "Criterio gia' verificato", "full_description": "Spuntato dal verificatore.", "checked": true },
          { "id": 2, "short_title": "Criterio ancora da verificare", "full_description": "Non spuntato.", "checked": false },
          { "id": 3, "short_title": "Ultimo criterio da verificare", "full_description": "Non spuntato.", "checked": false }
        ],
        "state": "unknown"
      },
      "created_at": "2026-08-12T00:00:00Z",
      "updated_at": "2026-08-12T00:00:00Z"
    },
    {
      "id": "aaaaaaaa-0000-4000-8000-000000000004",
      "title": "Barra piena: 3 su 3, tono success",
      "description": "Tutti i task spuntati: e' l'unico caso in cui la barra e' piena e verde.",
      "status": "done",
      "tier": "standard",
      "depends_on": [],
      "covers": [],
      "tasks": [
        { "id": 1, "short_title": "Passo concluso", "full_description": "Spuntato.", "checked": true },
        { "id": 2, "short_title": "Secondo passo concluso", "full_description": "Spuntato.", "checked": true },
        { "id": 3, "short_title": "Terzo passo concluso", "full_description": "Spuntato.", "checked": true }
      ],
      "validation": {
        "criteria": "Verificato: la barra e' piena solo qui.",
        "tasks": [
          { "id": 1, "short_title": "Criterio verificato", "full_description": "Spuntato.", "checked": true },
          { "id": 2, "short_title": "Secondo criterio verificato", "full_description": "Spuntato.", "checked": true }
        ],
        "state": "pass"
      },
      "created_at": "2026-08-12T00:00:00Z",
      "updated_at": "2026-08-12T00:00:00Z"
    }
  ]
}
```

- [ ] **Step 2: Avviare il board sulla fixture**

Il processo resta vivo: va staccato, non lanciato in foreground e non messo in un job con pipe.
Su PowerShell:

```powershell
Start-Process -FilePath "node" `
  -ArgumentList '"<repo>/scripts/board-server.mjs"','--project-dir','"<scratchpad>/board-fixture"' `
  -RedirectStandardOutput "<scratchpad>/board-fixture.log" `
  -RedirectStandardError "<scratchpad>/board-fixture.err" -WindowStyle Hidden
```

Poi leggere la riga JSON dal file di log e **controllare `projectDir`** prima di annunciare
qualsiasi cosa: se non è la directory della fixture, il board sta guardando il progetto sbagliato e
mostrerà un tracker che non è quello preparato.

- [ ] **Step 3: Dare l'URL all'utente**

Stampare `url` una volta sola, come URL nudo su una riga propria, senza code-span né link markdown.
Non aprire il browser: il click è dell'utente.

Insieme all'URL, dire cosa guardare — la vista di default è `wip` ed **esclude le `done`**, quindi
il caso della barra piena si vede passando al filtro `Tutti` o `Done`.

- [ ] **Step 4: Aspettare il verdetto**

Non c'è nessun comando da lanciare qui. L'utente guarda e risponde.

- **Approvato** → passare allo Step 5.
- **Rifiutato** → annotare cosa non va, tornare al Task 1 o al Task 2, correggere, rilanciare
  `npm test`, ripetere dallo Step 2 di questo task. Il board va fermato e riavviato: la pagina si
  aggiorna quando cambia `issues.json`, non quando cambia `board.html`.

- [ ] **Step 5: Fermare il board e ripulire**

Fermare il processo col `pid` della riga di avvio (`Stop-Process -Id <pid>`) e cancellare la
directory della fixture. Nessun processo orfano, e niente della fixture deve finire nel repository:

```powershell
Stop-Process -Id <pid>
Remove-Item -Recurse -Force "<scratchpad>/board-fixture"
git status --porcelain
```

L'ultimo comando deve mostrare solo i file del repository che i Task 1 e 2 hanno toccato.

---

## Note per chi esegue

**Il gate di pubblicazione è quello di harness.** I commit dei Task 1 e 2 sono punti fermi locali;
niente raggiunge il ramo condiviso prima del `pass` di un verificatore indipendente, e
l'approvazione visiva del Task 3 non è quel `pass` — è il contenuto che il verificatore leggerà.

**I componenti del plugin appena modificati** si vedono solo in una sessione nuova per skill e
agent; `board.html` invece è servito a ogni richiesta, quindi per questo lavoro basta ricaricare la
pagina dopo aver riavviato il server.
