// The renderer's promise is that the board can be proved without a browser: it takes the graph
// board-graph.mjs computed and returns a string, so every claim about how the board looks is an
// assertion on text. That is what this file checks — the module imported for real, not scraped out
// of a rendered page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildGraph } from "../scripts/board-graph.mjs";
import {
  components,
  paint,
  renderCard,
  renderCards,
  renderChains,
  renderCriteria,
  SEP,
  shortId,
  STATUS_COLOR,
  wrapText,
} from "../scripts/board-render.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDER_PATH = path.resolve(__dirname, "..", "scripts", "board-render.mjs");

const A = "aaaaaaaa-1111-1111-1111-111111111111";
const B = "bbbbbbbb-2222-2222-2222-222222222222";
const C = "cccccccc-3333-3333-3333-333333333333";
const D = "dddddddd-4444-4444-4444-444444444444";
const E = "eeeeeeee-5555-5555-5555-555555555555";

function issue(id, extra = {}) {
  return {
    id,
    title: `titolo ${id.slice(0, 4)}`,
    description: "",
    status: "backlog",
    tier: "standard",
    depends_on: [],
    validation: null,
    created_at: "2026-07-30T10:00:00Z",
    updated_at: "2026-07-30T10:00:00Z",
    ...extra,
  };
}

const opts = { project: "harness", branch: "main", width: 78 };

// --- The module is a module: pure, and blind to the process it runs in -------------------------

test("board-render.mjs is pure: no fs, no process, no console", () => {
  assert.equal(typeof components, "function");
  assert.equal(typeof renderChains, "function");
  assert.equal(typeof SEP, "function");
  assert.equal(typeof shortId, "function");
  assert.equal(typeof wrapText, "function");
  assert.equal(typeof renderCriteria, "function");
  assert.equal(typeof renderCard, "function");
  assert.equal(typeof renderCards, "function");

  const source = readFileSync(RENDER_PATH, "utf8");
  assert.doesNotMatch(source, /node:fs/);
  assert.doesNotMatch(source, /node:process/);
  assert.doesNotMatch(source, /\bconsole\b/);
  assert.doesNotMatch(source, /\bprocess\b/);
});

test("una issue senza dipendenze finisce sotto 'senza catena', non in una catena", () => {
  const graph = buildGraph([issue(A)]);
  assert.equal(components(graph).length, 0, "niente archi, niente componenti");
  const out = renderChains({ graph, ...opts, counts: { open: 1, done: 0 } });
  assert.match(out, /senza catena/);
  assert.match(out, /aaaaaaaa {2}titolo aaaa/);
  assert.match(out, /► lavorabile/);
});

test("una catena si identifica con l'id corto della sua radice", () => {
  const graph = buildGraph([issue(A), issue(B, { depends_on: [A] })]);
  const out = renderChains({ graph, ...opts, counts: { open: 2, done: 0 } });
  assert.match(out, /catena · aaaaaaaa/, "il titolo della sezione è la radice");
  assert.equal(out.includes("senza catena"), false, "entrambe sono in catena");
});

test("una issue con dipendenze aperte non è lavorabile, una con dipendenze chiuse sì", () => {
  const graph = buildGraph([
    issue(A, { status: "done" }),
    issue(B, { depends_on: [A] }),
    issue(C, { depends_on: [B] }),
  ]);
  const out = renderChains({ graph, ...opts, counts: { open: 2, done: 1 } });
  const lineB = out.split("\n").find((l) => l.includes("bbbbbbbb"));
  const lineC = out.split("\n").find((l) => l.includes("cccccccc"));
  assert.match(lineB, /► lavorabile/, "A è done, quindi B si può lavorare");
  assert.equal(lineC.includes("► lavorabile"), false, "B è aperta, C attende");
  assert.match(out, /✓ aaaaaaaa/, "la dipendenza chiusa resta visibile come fantasma");
});

test("un nodo con tre genitori compare una volta sola, con le attese in riga", () => {
  const graph = buildGraph([
    issue(A),
    issue(B, { depends_on: [A] }),
    issue(C, { depends_on: [A] }),
    issue(D, { depends_on: [A] }),
    issue(E, { depends_on: [B, C, D] }),
  ]);
  const out = renderChains({ graph, ...opts, counts: { open: 5, done: 0 } });
  const lines = out.split("\n");
  const occurrences = lines.filter((l) => l.includes("eeeeeeee  titolo")).length;
  assert.equal(occurrences, 1, "una riga sola per issue, non una per arco");
  assert.match(out, /attende bbbbbbbb cccccccc dddddddd/);

  // La riga delle attese sta sotto il nodo che le dichiara, rientrata oltre il suo marcatore:
  // a sinistra sembrerebbe detta da un antenato.
  const nodeLine = lines.find((l) => l.includes("eeeeeeee  titolo"));
  const waitLine = lines.find((l) => l.includes("attende bbbbbbbb"));
  assert.ok(
    waitLine.indexOf("attende") > nodeLine.indexOf("○"),
    "la riga 'attende' è rientrata oltre il marcatore della sua issue"
  );
});

// Regressione. La prima versione raggruppava con chainOf(), che risale per dependsOn e scende per
// dependents ma non attraversa i fratelli: una componente usciva a pezzi e un nodo presente in più
// pezzi veniva disegnato una volta per pezzo. Sul tracker reale la issue che ha introdotto questa
// vista compariva due volte, sotto due intestazioni distinte.
test("una componente connessa è una sezione sola, anche quando si arriva ai nodi solo alternando i versi", () => {
  const F = "ffffffff-6666-6666-6666-666666666666";
  const graph = buildGraph([
    issue(A, { depends_on: [C] }),
    issue(B, { depends_on: [C] }),
    issue(C, { depends_on: [D, E, F] }),
    issue(D),
    issue(E),
    issue(F),
  ]);

  assert.equal(components(graph).length, 1, "sei issue collegate sono una catena sola");

  const out = renderChains({ graph, ...opts, counts: { open: 6, done: 0 } });
  const lines = out.split("\n");
  assert.equal(
    lines.filter((l) => l.startsWith("catena · ")).length,
    1,
    "una sola intestazione di catena"
  );
  for (const id of [A, B, C, D, E, F]) {
    assert.equal(
      lines.filter((l) => l.includes(`${shortId(id)}  titolo`)).length,
      1,
      `${shortId(id)} compare una volta sola`
    );
  }
  assert.equal(
    lines.filter((l) => l.includes("attende")).length,
    1,
    "e con essa la riga delle attese, che è del nodo e non della sezione"
  );
});

test("un ciclo non si disegna: si stampano gli id e si ripiega sull'elenco piatto", () => {
  const graph = buildGraph([
    issue(A, { depends_on: [B] }),
    issue(B, { depends_on: [A] }),
  ]);
  const out = renderChains({ graph, ...opts, counts: { open: 2, done: 0 } });
  assert.match(out, /ciclo/i);
  assert.match(out, /aaaaaaaa/);
  assert.match(out, /bbbbbbbb/);
});

test("l'intestazione porta progetto, conteggi e branch", () => {
  const graph = buildGraph([issue(A)]);
  const out = renderChains({ graph, ...opts, counts: { open: 6, done: 84 } });
  assert.match(out, /harness · 6 aperte · 84 chiuse/);
  assert.match(out, /main/);
});

// --- La card: i sette campi della issue, senza perdite -----------------------------------------

const card = (extra) => renderCard(issue(A, extra), { width: 70 });

test("wrapText va a capo sulle parole e conserva le newline originali", () => {
  assert.deepEqual(wrapText("uno due tre quattro", 9), ["uno due", "tre", "quattro"]);
  assert.deepEqual(wrapText("prima\n\nseconda", 20), ["prima", "", "seconda"]);
  assert.deepEqual(wrapText("", 20), [""]);
  // Una parola più lunga della larghezza non si spezza: si sfora, perché un id tagliato a metà
  // non è più un id.
  assert.deepEqual(wrapText("parolalunghissima", 5), ["parolalunghissima"]);
  // Il limite è la larghezza, inclusa: una riga che la riempie esatta non va a capo.
  assert.deepEqual(wrapText("abc def", 7), ["abc def"]);
  assert.deepEqual(wrapText("abc def", 6), ["abc", "def"]);
  // Una riga di soli spazi è una riga vuota: rendere gli spazi lascerebbe sporcizia invisibile
  // in coda a una riga che il lettore vede vuota.
  assert.deepEqual(wrapText("prima\n   \nseconda", 20), ["prima", "", "seconda"]);
  // Un campo assente non è una riga di testo: è nessun testo.
  assert.deepEqual(wrapText(null, 20), [""]);
  assert.deepEqual(wrapText(undefined, 20), [""]);
});

test("la card porta tutti e sette i campi", () => {
  const out = card({
    status: "in_progress",
    tier: "reasoning",
    title: "titolo della issue",
    description: "prima riga\nseconda riga",
    validation: { state: "unknown", criteria: ["primo criterio", "secondo criterio"] },
    created_at: "2026-07-30T21:09:41Z",
    updated_at: "2026-07-31T07:14:34Z",
  });
  assert.match(out, /in_progress/);
  assert.match(out, /reasoning/);
  assert.match(out, /titolo della issue/);
  assert.match(out, /prima riga/);
  assert.match(out, /seconda riga/);
  assert.match(out, /Validazione · unknown/);
  assert.match(out, /primo criterio/);
  assert.match(out, /secondo criterio/);
  assert.match(out, new RegExp(A), "l'id è completo, non abbreviato");
  // Data e ora locali: il fuso della macchina decide le cifre, non il test.
  assert.match(
    out,
    /creata \d{2} \S+ \d{2}:\d{2} · aggiornata \d{2} \S+ \d{2}:\d{2}/,
    "le due date, con data e ora"
  );
});

test("un titolo lunghissimo senza spazi resta intero nella card", () => {
  const title = "riprogettazioneincrementaledellagenerazionedelletestatedellaboard";
  const out = card({ title });
  assert.ok(
    out.split("\n").includes(title),
    "il titolo sfora la larghezza invece di essere spezzato a metà parola"
  );
});

test("criteria come stringa è reso quanto criteria come array", () => {
  const out = card({ validation: { state: "pass", criteria: "evidenza della verifica" } });
  assert.match(out, /Validazione · pass/);
  assert.match(out, /evidenza della verifica/);
});

test("criteria come stringa multilinea non lascia righe di soli spazi", () => {
  const out = card({ validation: { state: "fail", criteria: "prima riga\n\nseconda riga" } });
  const lines = out.split("\n");
  assert.ok(lines.includes("  prima riga"));
  assert.ok(lines.includes("  seconda riga"));
  assert.equal(
    lines.some((line) => line !== line.trimEnd()),
    false,
    "una riga vuota è vuota, non due spazi che nessuno vede"
  );
});

test("criteria array vuoto: il blocco resta, l'elenco no", () => {
  const out = card({ validation: { state: "unknown", criteria: [] } });
  assert.match(out, /Validazione · unknown/);
  assert.equal(out.includes("○"), false, "nessun pallino senza criterio dietro");
  assert.equal(/\n\n\n/.test(out), false, "e nessun blocco vuoto al posto dell'elenco");
});

test("renderCriteria scarta le voci che non sono testo", () => {
  assert.deepEqual(renderCriteria([null, "", "   ", 42, "vero criterio"], 70), ["  ○ vero criterio"]);
  assert.deepEqual(renderCriteria(undefined, 70), []);
  assert.deepEqual(renderCriteria("   ", 70), []);
});

test("una issue senza validation non stampa il blocco di validazione", () => {
  assert.equal(card({ validation: null }).includes("Validazione"), false);
  assert.equal(card({ validation: {} }).includes("Validazione"), false);
});

test("description vuota non apre un blocco vuoto", () => {
  assert.equal(/\n\n\n/.test(card({ description: "" })), false);
  assert.equal(/\n\n\n/.test(card({ description: "   \n  " })), false);
});

test("tier assente vale standard", () => {
  const out = card({ tier: undefined });
  assert.match(out, /standard/);
});

test("una data mancante o illeggibile non diventa il primo gennaio 1970", () => {
  // new Date(null) è l'epoch, non una data invalida: senza guardia la card daterebbe al 1970
  // ogni issue a cui manca il campo.
  assert.match(card({ created_at: null, updated_at: "ieri" }), /creata — · aggiornata —/);
});

test("renderCards separa le card e dice quando non ce ne sono", () => {
  const out = renderCards([issue(A), issue(B)], { width: 70 });
  assert.equal((out.match(/aaaaaaaa|bbbbbbbb/g) || []).length, 2);

  // Il righello è un confine: fra due card ce n'è uno, non due incollati.
  const lines = out.split("\n");
  const rule = SEP(70);
  assert.equal(lines.filter((line) => line === rule).length, 3, "tre confini per due card");
  for (let i = 1; i < lines.length; i += 1) {
    assert.equal(lines[i] === rule && lines[i - 1] === rule, false, "due righelli adiacenti");
  }

  assert.match(renderCards([], { width: 70 }), /nessuna issue/i);
  assert.match(renderCards(null, { width: 70 }), /nessuna issue/i);
});

// --- Il colore: decorazione quando è acceso, nessuna traccia quando è spento -------------------

// eslint-disable-next-line no-control-regex
const ANSI = "\\u001b\\[[0-9;]*m";
const stripAnsi = (text) => text.replace(new RegExp(ANSI, "g"), "");
const hasAnsi = (text) => new RegExp(ANSI).test(text);

const STATUSES = ["backlog", "in_progress", "in_review", "blocked", "done"];

// Un grafo che tocca ogni riga che il renderer sa disegnare: intestazione, testata di catena,
// nodo lavorabile e non, fantasma di una dipendenza chiusa, riga delle attese, sezione senza
// catena. Se il colore rompe una larghezza, la rompe qui.
function motleyGraph() {
  return buildGraph([
    issue(A, { status: "done" }),
    issue(B, { depends_on: [A], status: "in_progress", tier: "reasoning" }),
    issue(C, { depends_on: [A], status: "blocked" }),
    issue(D, { depends_on: [B, C], status: "in_review", tier: "economy" }),
    issue(E, { status: "backlog" }),
  ]);
}

const chains = (colors) =>
  renderChains({ graph: motleyGraph(), ...opts, counts: { open: 4, done: 1 }, colors });

test("paint avvolge il testo solo quando il colore è acceso", () => {
  assert.equal(paint("x", "in_progress", false), "x", "spento non lascia byte di escape");

  const painted = paint("x", "in_progress", true);
  assert.match(painted, new RegExp(`^\u001b\\[38;5;${STATUS_COLOR.in_progress}m`), "ANSI 256");
  assert.match(painted, /\u001b\[0m$/, "e richiude");
  assert.equal(stripAnsi(painted), "x", "in mezzo c'è il testo, invariato");

  assert.equal(paint("x", "chiave-che-non-esiste", true), "x", "una chiave ignota non colora");
});

test("colors è una decisione booleana: tutto ciò che non è true vale spento", () => {
  // Emettere escape per sbaglio è il verso che fa danno — una pipe si riempie di sporcizia.
  for (const value of [undefined, null, 0, 1, "true", "sì", {}]) {
    assert.equal(paint("x", "in_progress", value), "x", `colors=${JSON.stringify(value)}`);
  }
  assert.equal(hasAnsi(renderCard(issue(A), { width: 70, colors: "true" })), false);
  assert.equal(hasAnsi(chains("true")), false);
});

test("ogni stato del tracker ha un colore in STATUS_COLOR", () => {
  for (const status of STATUSES) {
    assert.equal(typeof STATUS_COLOR[status], "number", `manca il colore di ${status}`);
    assert.ok(
      Number.isInteger(STATUS_COLOR[status]) &&
        STATUS_COLOR[status] >= 0 &&
        STATUS_COLOR[status] <= 255,
      `${status} non è un indice della tavolozza a 256`
    );
  }
  assert.equal(
    new Set(STATUSES.map((s) => STATUS_COLOR[s])).size,
    STATUSES.length,
    "due stati con lo stesso colore sarebbero indistinguibili"
  );
});

test("con il colore spento non esce un byte di escape, da nessuna vista", () => {
  assert.equal(hasAnsi(chains(false)), false, "albero");
  assert.equal(hasAnsi(chains(undefined)), false, "albero, colors omesso");
  assert.equal(hasAnsi(renderCards([issue(A, { status: "blocked" }), issue(B)], { width: 70 })), false);
  for (const status of STATUSES) {
    assert.equal(hasAnsi(renderCard(issue(A, { status }), { width: 70, colors: false })), false, status);
  }
});

test("il colore è additivo: spento e acceso-e-ripulito danno lo stesso testo", () => {
  const plain = chains(false).split("\n");
  const coloured = chains(true).split("\n");
  assert.notEqual(coloured.join("\n"), plain.join("\n"), "acceso qualcosa deve pur cambiare");
  assert.equal(coloured.length, plain.length, "il colore non aggiunge né toglie righe");
  for (let i = 0; i < plain.length; i += 1) {
    assert.equal(stripAnsi(coloured[i]), plain[i], `riga ${i} diversa una volta ripulita`);
  }
});

// Il difetto che questo task rischia: colorare prima di misurare. `width - left.length` conta
// anche gli escape, il riempimento si accorcia di una dozzina di caratteri e la colonna di destra
// si sposta solo quando il colore è acceso — invisibile a un test che cerchi solo gli escape.
test("le sequenze di escape non entrano nel calcolo delle larghezze", () => {
  const plain = chains(false).split("\n");
  const coloured = chains(true).split("\n").map(stripAnsi);

  const withTier = plain
    .map((line, i) => [line, coloured[i]])
    .filter(([line]) => line.includes("[reasoning]") || line.includes("[economy]"));
  assert.ok(withTier.length >= 2, "il grafo di prova ha righe con la colonna di destra");
  for (const [line, cleaned] of withTier) {
    assert.equal(cleaned.length, line.length, "la riga colorata è larga uguale");
    assert.equal(
      cleaned.indexOf("["),
      line.indexOf("["),
      "la colonna del tier cade nella stessa colonna"
    );
  }

  // Anche la testata, che ha lo stesso riempimento fra progetto e branch.
  assert.equal(coloured[0].length, plain[0].length);
  assert.equal(coloured[0].lastIndexOf("main"), plain[0].lastIndexOf("main"));
});

test("una riga già al limite della larghezza non si allarga col colore", () => {
  const title = "un titolo cosí lungo da mangiarsi tutta la riga e anche il riempimento minimo";
  const graph = buildGraph([issue(A, { title }), issue(B, { depends_on: [A] })]);
  const args = { graph, ...opts, counts: { open: 2, done: 0 } };
  const plain = renderChains({ ...args, colors: false }).split("\n");
  const coloured = renderChains({ ...args, colors: true }).split("\n");
  const find = (lines) => lines.find((line) => stripAnsi(line).includes(title));
  assert.equal(stripAnsi(find(coloured)), find(plain));
  assert.match(find(plain), /  \[standard\]/, "il riempimento è già al minimo di due spazi");
});

test("la card allinea uguale con e senza colore", () => {
  const it = issue(A, {
    status: "in_review",
    tier: "reasoning",
    description: "una descrizione\nsu due righe",
    validation: { state: "unknown", criteria: ["primo criterio", "secondo criterio"] },
  });
  const plain = renderCard(it, { width: 70, colors: false }).split("\n");
  const coloured = renderCard(it, { width: 70, colors: true }).split("\n");
  assert.equal(coloured.length, plain.length);
  for (let i = 0; i < plain.length; i += 1) {
    assert.equal(stripAnsi(coloured[i]), plain[i], `riga ${i}`);
  }
  const head = plain.find((line) => line.includes("in_review"));
  assert.equal(head.length, 70, "la testata riempie la larghezza chiesta");

  // Anche impilate: il righello di confine resta uno solo, e colorarlo non ne fa spuntare un altro.
  const stack = (colors) => renderCards([issue(A), issue(B)], { width: 70, colors });
  assert.equal(stripAnsi(stack(true)), stack(false));
});

test("il colore non porta informazione da solo: ogni stato resta scritto in lettere", () => {
  for (const status of STATUSES) {
    const it = issue(A, { status });
    const coloured = renderCard(it, { width: 70, colors: true });
    assert.ok(
      stripAnsi(coloured).includes(`● ${status}`),
      `${status} deve restare leggibile in lettere`
    );
    assert.ok(
      coloured.includes(`\u001b[38;5;${STATUS_COLOR[status]}m`),
      `${status} deve usare il colore della tavolozza`
    );
    assert.ok(
      renderCard(it, { width: 70, colors: false }).includes(`● ${status}`),
      `${status} resta leggibile anche senza colore`
    );
  }
});

test("uno stato fuori tavolozza si stampa lo stesso, semplicemente non colorato", () => {
  const out = renderCard(issue(A, { status: "wontfix" }), { width: 70, colors: true });
  const head = out.split("\n").find((line) => line.includes("wontfix"));
  assert.ok(stripAnsi(head).startsWith("● wontfix"), "lo stato ignoto resta scritto");
  assert.doesNotMatch(head, /\u001b\[38;5;\d+m● wontfix/, "e non prende un colore inventato");

  // Nemmeno una issue senza stato deve far esplodere il renderer.
  assert.doesNotThrow(() => renderCard({ id: A, title: "x" }, { width: 70, colors: true }));
});
