// The board as a command. board-render.mjs is verified for what it draws; this file is about the
// half the renderer refuses to know: which arguments are legal, which project gets read, which
// issues survive the filters, whether colour is allowed, and what the script says when it cannot
// do any of it.
//
// Half the tests import the exported helpers and half spawn the script. Both halves are needed:
// an exported function that is never reached by a real invocation still passes its unit test, and
// the entrypoint guard — a comparison between `import.meta.url` and `process.argv[1]`, which on
// Windows are a file:// URL and a backslashed path — is exactly the kind of code that fails
// silently, printing nothing and exiting 0.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "scripts", "board-cli.mjs");

const { parseArgs, selectIssues, decideColors, readIssues, draw, watchProject } = await import(
  pathToFileURL(CLI).href
);

// The escape byte, not the bracket: `[standard]` is on every line of the tree, so a test looking
// for a plain "[" would call every board coloured.
const ANSI = /\u001b\[/;

function run(args, options = {}) {
  try {
    return {
      code: 0,
      out: execFileSync("node", [CLI, ...args], {
        encoding: "utf8",
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
      }),
    };
  } catch (error) {
    return { code: error.status, out: error.stdout };
  }
}

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "board-cli-"));
}

function tempProject(issues, raw = null) {
  const dir = tempDir();
  writeFileSync(
    path.join(dir, "issues.json"),
    raw === null ? JSON.stringify({ issues }) : raw,
    "utf8"
  );
  return dir;
}

const A = "aaaaaaaa-1111-1111-1111-111111111111";
const B = "bbbbbbbb-2222-2222-2222-222222222222";
const C = "cccccccc-3333-3333-3333-333333333333";

function issue(id, extra = {}) {
  return {
    id,
    title: `titolo ${id.slice(0, 4)}`,
    description: "descrizione",
    status: "backlog",
    tier: "standard",
    depends_on: [],
    validation: null,
    created_at: "2026-07-30T10:00:00Z",
    updated_at: "2026-07-30T10:00:00Z",
    ...extra,
  };
}

// --- arguments ---------------------------------------------------------------------------

test("senza argomenti il progetto è la cwd e la vista è l'albero", () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.projectDir, process.cwd());
  assert.equal(parsed.value.view, "chains");
  assert.deepEqual(parsed.value.status, []);
  assert.equal(parsed.value.width, null);
  assert.equal(parsed.value.all, false);
});

test("--project-dir diventa assoluto anche se lo si passa relativo", () => {
  const parsed = parseArgs(["--project-dir", "."]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.projectDir, path.resolve("."));
});

test("--status è ripetibile e i valori si sommano", () => {
  const parsed = parseArgs(["--status", "backlog", "--status", "blocked"]);
  assert.deepEqual(parsed.value.status, ["backlog", "blocked"]);
});

test("la forma --flag=valore è la stessa cosa della forma con lo spazio", () => {
  const parsed = parseArgs(["--view=cards", "--search=Ciao"]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.view, "cards");
  // Confrontata in minuscolo: la ricerca non distingue le maiuscole.
  assert.equal(parsed.value.search, "ciao");
});

test("un flag che non esiste è UNKNOWN_ARGUMENT, non un valore da indovinare", () => {
  const parsed = parseArgs(["--inventato"]);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "UNKNOWN_ARGUMENT");
});

test("un positional senza flag è UNKNOWN_ARGUMENT: lo script non ha sottocomandi", () => {
  assert.equal(parseArgs(["start"]).code, "UNKNOWN_ARGUMENT");
});

test("un flag noto senza valore è INVALID_ARGUMENT, in coda o seguito da un altro flag", () => {
  assert.equal(parseArgs(["--project-dir"]).code, "INVALID_ARGUMENT");
  // Il caso che conta davvero: `--search --all` non cerca la stringa "--all", si lamenta.
  const parsed = parseArgs(["--search", "--all"]);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "INVALID_ARGUMENT");
});

test("--view accetta chains o cards e rifiuta il resto", () => {
  assert.equal(parseArgs(["--view", "chains"]).ok, true);
  assert.equal(parseArgs(["--view", "cards"]).ok, true);
  assert.equal(parseArgs(["--view", "grafo"]).code, "INVALID_ARGUMENT");
});

test("--width vuole un intero da 20 in su", () => {
  assert.equal(parseArgs(["--width", "80"]).value.width, 80);
  assert.equal(parseArgs(["--width", "abc"]).code, "INVALID_ARGUMENT");
  assert.equal(parseArgs(["--width", "80.5"]).code, "INVALID_ARGUMENT");
  assert.equal(parseArgs(["--width", "-5"]).code, "INVALID_ARGUMENT");
  assert.equal(parseArgs(["--width", "10"]).code, "INVALID_ARGUMENT");
  // 80 seguito da spazzatura non è 80: il troncamento silenzioso di parseInt è un errore, non un
  // valore di default.
  assert.equal(parseArgs(["--width", "80px"]).code, "INVALID_ARGUMENT");
});

// --- filters -----------------------------------------------------------------------------

const FILTERS = { status: [], tier: [], search: null, all: false };

test("le issue done restano fuori finché non si passa --all", () => {
  const issues = [issue(A, { status: "done" }), issue(B)];
  assert.deepEqual(
    selectIssues(issues, FILTERS).map((entry) => entry.id),
    [B]
  );
  assert.equal(selectIssues(issues, { ...FILTERS, all: true }).length, 2);
});

test("status e tier filtrano, e un tier assente vale standard", () => {
  const issues = [issue(A, { status: "in_progress" }), issue(B, { tier: "economy" })];
  const senzaTier = [issue(A, { tier: undefined })];
  assert.deepEqual(
    selectIssues(issues, { ...FILTERS, status: ["in_progress"] }).map((entry) => entry.id),
    [A]
  );
  assert.deepEqual(
    selectIssues(issues, { ...FILTERS, tier: ["economy"] }).map((entry) => entry.id),
    [B]
  );
  assert.equal(selectIssues(senzaTier, { ...FILTERS, tier: ["standard"] }).length, 1);
});

test("--search guarda id, titolo e descrizione, senza distinguere le maiuscole", () => {
  const issues = [issue(A, { title: "Rinomina il Board" }), issue(B, { description: "watcher" })];
  const found = (term) => selectIssues(issues, { ...FILTERS, search: term }).map((e) => e.id);
  assert.deepEqual(found("board"), [A]);
  assert.deepEqual(found("watcher"), [B]);
  assert.deepEqual(found("bbbbbbbb"), [B]);
  assert.deepEqual(found("niente di niente"), []);
});

test("una issue senza descrizione non fa esplodere la ricerca", () => {
  const issues = [{ id: A, title: "solo titolo", status: "backlog" }];
  assert.deepEqual(
    selectIssues(issues, { ...FILTERS, search: "titolo" }).map((entry) => entry.id),
    [A]
  );
  assert.deepEqual(selectIssues(issues, { ...FILTERS, search: "undefined" }), []);
});

// --- colour ------------------------------------------------------------------------------

test("il colore è acceso solo con un TTY", () => {
  assert.equal(decideColors({ noColor: false }, {}, true), true);
  assert.equal(decideColors({ noColor: false }, {}, false), false);
  assert.equal(decideColors({ noColor: false }, {}, undefined), false);
});

test("--no-color e NO_COLOR valorizzato spengono il colore, NO_COLOR vuoto no", () => {
  assert.equal(decideColors({ noColor: true }, {}, true), false);
  assert.equal(decideColors({ noColor: false }, { NO_COLOR: "1" }, true), false);
  assert.equal(decideColors({ noColor: false }, { NO_COLOR: "0" }, true), false);
  // La convenzione NO_COLOR parla di variabile *valorizzata*: vuota non conta.
  assert.equal(decideColors({ noColor: false }, { NO_COLOR: "" }, true), true);
});

// La decisione sul colore è verificabile da sola, ma "spento" passerebbe anche se il colore non
// arrivasse mai al renderer. Questo finge il terminale che i test non hanno e guarda gli escape.
function withFakeTTY(env, body) {
  const wasTTY = process.stdout.isTTY;
  const wasNoColor = process.env.NO_COLOR;
  process.stdout.isTTY = true;
  if (env.NO_COLOR === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = env.NO_COLOR;
  }
  try {
    return body();
  } finally {
    process.stdout.isTTY = wasTTY;
    if (wasNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = wasNoColor;
    }
  }
}

test("con un terminale il colore arriva davvero al disegno, e NO_COLOR lo ferma", () => {
  const dir = tempProject([issue(A, { status: "in_progress" })]);
  const options = { ...parseArgs(["--view", "cards"]).value, projectDir: dir };
  try {
    assert.equal(ANSI.test(withFakeTTY({}, () => draw(options))), true);
    assert.equal(ANSI.test(withFakeTTY({ NO_COLOR: "1" }, () => draw(options))), false);
    assert.equal(
      ANSI.test(withFakeTTY({}, () => draw({ ...options, noColor: true }))),
      false,
      "--no-color vince sul terminale"
    );
    // Lo stato resta scritto in lettere sotto l'escape: senza colore non si perde niente.
    assert.match(withFakeTTY({ NO_COLOR: "1" }, () => draw(options)), /in_progress/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- reading the tracker -----------------------------------------------------------------

test("un progetto senza issues.json legge come tracker vuoto", () => {
  const dir = tempDir();
  try {
    assert.deepEqual(readIssues(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("un issues.json che non è l'oggetto atteso legge come tracker vuoto, non come crash", () => {
  // Le tre forme che un file scritto a mano può prendere. La lettura è quella che issue-manager e
  // board-server danno già: `data.issues` o niente.
  for (const raw of ["[]", `[${JSON.stringify(issue(A))}]`, "null", '{"altro":1}']) {
    const dir = tempProject(null, raw);
    try {
      assert.deepEqual(readIssues(dir), [], `letto da ${raw}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// --- the command itself ------------------------------------------------------------------

test("stampa l'albero delle catene del progetto indicato", () => {
  const dir = tempProject([issue(A), issue(B, { depends_on: [A] })]);
  try {
    const { code, out } = run(["--project-dir", dir]);
    assert.equal(code, 0);
    assert.match(out, /catena · aaaaaaaa/);
    assert.match(out, /titolo bbbb/);
    assert.equal(ANSI.test(out), false, "senza TTY il colore è spento");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("senza --project-dir il progetto è la cwd del processo", () => {
  const dir = tempProject([issue(A)]);
  try {
    const { code, out } = run([], { cwd: dir });
    assert.equal(code, 0);
    assert.match(out, /aaaaaaaa/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("un progetto senza issues.json stampa il tracker vuoto ed esce con 0", () => {
  const dir = tempDir();
  try {
    const { code, out } = run(["--project-dir", dir]);
    assert.equal(code, 0);
    assert.match(out, /Nessuna issue aperta/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--project-dir inesistente esce 1 con FILE_NOT_FOUND su una riga sola di JSON", () => {
  const { code, out } = run(["--project-dir", path.join(tmpdir(), "non-esiste-affatto")]);
  assert.equal(code, 1);
  assert.equal(out.trim().split("\n").length, 1);
  const payload = JSON.parse(out);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "FILE_NOT_FOUND");
  assert.match(payload.error, /non-esiste-affatto/);
});

test("un file al posto di una directory è comunque FILE_NOT_FOUND", () => {
  const dir = tempProject([issue(A)]);
  try {
    const { code, out } = run(["--project-dir", path.join(dir, "issues.json")]);
    assert.equal(code, 1);
    assert.equal(JSON.parse(out).code, "FILE_NOT_FOUND");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("i tre codici di errore arrivano davvero fino a stdout, con exit 1", () => {
  const sconosciuto = run(["--sconosciuto"]);
  assert.equal(sconosciuto.code, 1);
  assert.equal(JSON.parse(sconosciuto.out).code, "UNKNOWN_ARGUMENT");

  const senzaValore = run(["--project-dir"]);
  assert.equal(senzaValore.code, 1);
  assert.equal(JSON.parse(senzaValore.out).code, "INVALID_ARGUMENT");
});

test("un issues.json illeggibile è un errore dichiarato, non uno stack trace", () => {
  const dir = tempProject(null, "{ questo non e' json");
  try {
    const { code, out } = run(["--project-dir", dir]);
    assert.equal(code, 1);
    const payload = JSON.parse(out);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "ERROR");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--view cards stampa le card e i filtri le riducono", () => {
  const dir = tempProject([
    issue(A, { status: "in_progress" }),
    issue(B, { status: "backlog", tier: "economy" }),
  ]);
  try {
    const all = run(["--project-dir", dir, "--view", "cards"]).out;
    assert.match(all, new RegExp(A));
    assert.match(all, new RegExp(B));

    const byStatus = run(["--project-dir", dir, "--view", "cards", "--status", "in_progress"]).out;
    assert.match(byStatus, new RegExp(A));
    assert.equal(byStatus.includes(B), false);

    const byTier = run(["--project-dir", dir, "--view", "cards", "--tier", "economy"]).out;
    assert.match(byTier, new RegExp(B));
    assert.equal(byTier.includes(A), false);

    const bySearch = run(["--project-dir", dir, "--view", "cards", "--search", "bbbb"]).out;
    assert.match(bySearch, new RegExp(B));
    assert.equal(bySearch.includes(A), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("un filtro che non lascia niente lo dice e resta un successo", () => {
  const dir = tempProject([issue(A)]);
  try {
    const { code, out } = run(["--project-dir", dir, "--view", "cards", "--search", "zzz"]);
    assert.equal(code, 0);
    assert.match(out, /Nessuna issue da mostrare con questi filtri/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("le card chiuse restano fuori finché non si passa --all", () => {
  const dir = tempProject([issue(A, { status: "done" }), issue(B)]);
  try {
    const standard = run(["--project-dir", dir, "--view", "cards"]).out;
    assert.equal(standard.includes(A), false);
    assert.match(run(["--project-dir", dir, "--view", "cards", "--all"]).out, new RegExp(A));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--width stringe la vista invece di essere ignorato", () => {
  const dir = tempProject([issue(A), issue(B, { depends_on: [A] })]);
  try {
    const stretta = run(["--project-dir", dir, "--width", "40"]).out;
    const larga = run(["--project-dir", dir, "--width", "120"]).out;
    const piuLunga = (text) => Math.max(...text.split("\n").map((line) => line.length));
    assert.ok(piuLunga(stretta) < piuLunga(larga), "la larghezza chiesta cambia il disegno");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- watch -------------------------------------------------------------------------------
//
// Il piano proponeva di verificare il watch con un figlio e tre `setTimeout` in fila, e dichiarava
// da sé il rischio: su una macchina carica quel test lampeggia, e la reazione tipica — allungare le
// attese finché smette — non dimostra niente di più. Qui il watcher è pilotato a livello di
// funzione: `watchProject` riceve chi crea il watcher e chi scrive, così il test *provoca* l'evento
// invece di aspettarlo, e resta un solo test di processo, quello che verifica che il primo disegno
// arrivi davvero da una vera invocazione.

// L'unica attesa rimasta, e non è un'attesa sul lavoro altrui: con `debounceMs: 0` il timer del
// debounce scade prima di questo, perché i timer di node partono in ordine di scadenza e non di
// registrazione. Non è una scommessa sulla velocità della macchina.
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

// Un fs.watch finto: tiene il callback da parte e lo lascia chiamare al test.
function fakeWatcher() {
  const watched = [];
  let listener = null;
  let closed = 0;
  return {
    watched,
    closed: () => closed,
    create(dir, callback) {
      watched.push(dir);
      listener = callback;
      return {
        close() {
          closed += 1;
        },
      };
    },
    fire(filename, event = "change") {
      listener(event, filename);
    },
  };
}

function startWatch(dir, extra = []) {
  const spy = fakeWatcher();
  const written = [];
  const options = { ...parseArgs(["--watch", "--width", "80", ...extra]).value, projectDir: dir };
  const session = watchProject(options, {
    write: (text) => written.push(text),
    createWatcher: spy.create,
    debounceMs: 0,
    clear: false,
  });
  return { spy, written, session };
}

test("--watch è un flag booleano e non prende un valore", () => {
  assert.equal(parseArgs([]).value.watch, false);
  assert.equal(parseArgs(["--watch"]).value.watch, true);
  assert.equal(parseArgs(["--watch=1"]).code, "INVALID_ARGUMENT");
});

test("in watch il disegno è l'albero più le card delle sole issue in volo", () => {
  const dir = tempProject([
    issue(A, { status: "in_progress" }),
    issue(B, { status: "backlog" }),
    issue(C, { status: "done" }),
  ]);
  try {
    const frame = draw({ ...parseArgs(["--watch", "--width", "80"]).value, projectDir: dir });
    // L'albero c'è tutto: le catene sono un fatto del grafo e non si filtrano.
    assert.match(frame, /aperte/, "l'intestazione dell'albero è al suo posto");
    assert.match(frame, /titolo bbbb/, "le issue non in volo restano nell'albero");
    // Le card no: solo quelle in volo. `● <stato>` è la riga di testa di una card, l'albero
    // scrive `○` e non nomina mai lo stato.
    assert.match(frame, /● in_progress/);
    assert.equal(frame.includes("● backlog"), false, "una issue ferma non merita una card");
    assert.equal(frame.includes("● done"), false, "una issue chiusa nemmeno");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("in watch anche in_review e blocked hanno la loro card", () => {
  const dir = tempProject([
    issue(A, { status: "in_review" }),
    issue(B, { status: "blocked" }),
    issue(C, { status: "backlog" }),
  ]);
  try {
    const frame = draw({ ...parseArgs(["--watch", "--width", "80"]).value, projectDir: dir });
    assert.match(frame, /● in_review/);
    assert.match(frame, /● blocked/);
    assert.equal(frame.includes("● backlog"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("senza niente in volo il watch lo dice, invece di parlare di filtri", () => {
  const dir = tempProject([issue(A)]);
  try {
    const frame = draw({ ...parseArgs(["--watch"]).value, projectDir: dir });
    assert.match(frame, /Nessuna issue in volo/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("il watch disegna subito e ridisegna a ogni scrittura su issues.json", async () => {
  const dir = tempProject([issue(A, { status: "in_progress" })]);
  const { spy, written, session } = startWatch(dir);
  try {
    assert.equal(written.length, 1, "il primo disegno non aspetta un evento");
    assert.match(written[0], /aaaaaaaa/);

    writeFileSync(
      path.join(dir, "issues.json"),
      JSON.stringify({ issues: [issue(A, { status: "in_progress" }), issue(B)] }),
      "utf8"
    );
    spy.fire("issues.json");
    await tick();
    assert.equal(written.length, 2, "l'evento ha ridisegnato");
    assert.match(written[1], /bbbbbbbb/, "la issue nuova compare senza rilanciare il comando");
  } finally {
    session.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("il watcher osserva la directory, non il file, e ignora gli altri file", async () => {
  const dir = tempProject([issue(A)]);
  const { spy, written, session } = startWatch(dir);
  try {
    // La ragione per cui guarda la directory: issue-manager scrive un temporaneo e poi lo rinomina
    // sopra il tracker, e un watcher legato al file resterebbe attaccato a quello sostituito.
    assert.deepEqual(spy.watched, [dir]);

    spy.fire("altro.txt");
    await tick();
    assert.equal(written.length, 1, "una scrittura su un altro file non ridisegna");

    spy.fire("issues.json.tmp");
    await tick();
    assert.equal(written.length, 1, "nemmeno il temporaneo di issue-manager");
  } finally {
    session.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("una raffica di eventi produce un solo ridisegno", async () => {
  const dir = tempProject([issue(A)]);
  const { spy, written, session } = startWatch(dir);
  try {
    spy.fire("issues.json", "rename");
    spy.fire("issues.json", "change");
    spy.fire("issues.json", "change");
    await tick();
    assert.equal(written.length, 2, "un disegno iniziale più uno solo per la raffica");
  } finally {
    session.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("un issues.json illeggibile non uccide il watch: stampa e resta in attesa", async () => {
  const dir = tempProject([issue(A)]);
  const { spy, written, session } = startWatch(dir);
  try {
    writeFileSync(path.join(dir, "issues.json"), "{ questo non e' json", "utf8");
    spy.fire("issues.json");
    await tick();
    assert.equal(written.length, 2);
    assert.match(written[1], /illeggibile/i, "l'errore è una riga, non uno stack trace");

    // Il punto vero: il watcher è ancora lì, e la scrittura successiva ridisegna.
    writeFileSync(path.join(dir, "issues.json"), JSON.stringify({ issues: [issue(B)] }), "utf8");
    spy.fire("issues.json");
    await tick();
    assert.equal(written.length, 3);
    assert.match(written[2], /bbbbbbbb/, "dopo il file transitorio il watch riprende a disegnare");
  } finally {
    session.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("chiudere la sessione chiude il watcher e annulla il ridisegno in coda", async () => {
  const dir = tempProject([issue(A)]);
  const { spy, written, session } = startWatch(dir);
  try {
    spy.fire("issues.json");
    session.close();
    await tick();
    assert.equal(spy.closed(), 1, "il watcher è chiuso");
    assert.equal(written.length, 1, "il debounce in coda non disegna dopo la chiusura");
  } finally {
    session.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// L'unico test di processo del watch: che una vera invocazione con --watch disegni e resti viva.
// Attende l'output invece di attendere un tempo, e uccide il figlio comunque vada l'asserzione.
function firstFrame(child, pattern, ms = 15000) {
  return new Promise((resolve, reject) => {
    let seen = "";
    const timer = setTimeout(() => reject(new Error(`nessun disegno in ${ms}ms. Visto: ${seen}`)), ms);
    const stop = (error, value) => {
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    child.stdout.on("data", (chunk) => {
      seen += chunk.toString();
      if (pattern.test(seen)) {
        stop(null, seen);
      }
    });
    child.on("error", (error) => stop(error));
    child.on("exit", (code) => stop(new Error(`il watch è uscito con ${code}. Visto: ${seen}`)));
  });
}

test("--watch disegna e resta vivo, lanciato davvero", async () => {
  const dir = tempProject([issue(A, { status: "in_progress" })]);
  const child = spawn("node", [CLI, "--project-dir", dir, "--watch", "--width", "80"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const seen = await firstFrame(child, /aaaaaaaa/);
    assert.match(seen, /● in_progress/, "il primo disegno ha già le card di chi è in volo");
    assert.equal(child.exitCode, null, "il comando non è uscito dopo il primo disegno");
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- il lanciatore -------------------------------------------------------------------------
//
// In installazione globale il percorso del plugin è lungo e agganciato alla versione. Va bene per
// l'agente, che lo riceve sostituito a ogni invocazione, ed è inservibile per una persona che deve
// aprire un secondo terminale — e al primo aggiornamento del plugin il comando salvato punta a una
// cartella che non esiste più. `--write-launcher` scrive i due file col percorso risolto in quel
// momento, e la skill li riscrive a ogni clock-in.
//
// Due cose qui non si verificano leggendo: che le virgolette reggano uno spazio nel percorso, e
// che il watch parta sul progetto da cui *lanci* il file e non su quello in cui è stato scritto.
// Per quelle i lanciatori si eseguono, perché uno script di shell che nessuno ha mai lanciato è
// uno script che non funziona.

function launcherPaths(projectDir) {
  return {
    cmd: path.join(projectDir, ".harness", "board.cmd"),
    sh: path.join(projectDir, ".harness", "board.sh"),
  };
}

// Directory con uno spazio nel nome: `C:\Program Files\…` non è un caso esotico, ed è il caso che
// scopre se quello che il lanciatore interpola è virgolettato davvero.
function tempSpacedProject(issues) {
  const dir = mkdtempSync(path.join(tmpdir(), "board cli "));
  writeFileSync(path.join(dir, "issues.json"), JSON.stringify({ issues }), "utf8");
  return dir;
}

// Il plugin come lo si trova installato: sotto un percorso con uno spazio, e copiato per intero
// perché board-cli.mjs importa i suoi due vicini per percorso relativo. Serve a esercitare
// davvero il percorso virgolettato dentro i due script, che con il repo di sviluppo — senza spazi
// — passerebbe anche senza virgolette.
function fakePluginInstall() {
  const dir = mkdtempSync(path.join(tmpdir(), "board plugin "));
  for (const file of ["board-cli.mjs", "board-graph.mjs", "board-render.mjs"]) {
    copyFileSync(path.join(__dirname, "..", "scripts", file), path.join(dir, file));
  }
  return path.join(dir, "board-cli.mjs");
}

// Il figlio appena ucciso può tenere ancora per un istante la directory in cui sta: su Windows
// rimuovere la cwd di un processo vivo è EPERM, e un test che fallisce nel `finally` racconta una
// bugia su cosa si è rotto. Una directory temporanea sopravvissuta è un problema del sistema.
function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  } catch {
    /* vedi sopra */
  }
}

// `child.kill()` sul figlio ucciderebbe solo il cmd.exe (o la sh) che fa da guscio: il node in
// watch resterebbe vivo per sempre, e la suite lascerebbe processi appesi.
function killTree(child) {
  if (!child.pid) {
    return;
  }
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    child.kill("SIGKILL");
  }
}

function runSync(command, args, cwd) {
  try {
    return { code: 0, out: execFileSync(command, args, { cwd, encoding: "utf8" }) };
  } catch (error) {
    return { code: error.status, out: error.stdout };
  }
}

// La sh c'è su questa macchina (Git for Windows la porta) ma non è garantita su una Windows nuda:
// il test che la usa si salta invece di fallire per una ragione che non riguarda il lanciatore.
const HAS_SH = (() => {
  try {
    execFileSync("sh", ["-c", "exit 0"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("--write-launcher è un flag booleano e non prende un valore", () => {
  assert.equal(parseArgs([]).value.writeLauncher, false);
  assert.equal(parseArgs(["--write-launcher"]).value.writeLauncher, true);
  assert.equal(parseArgs(["--write-launcher=1"]).code, "INVALID_ARGUMENT");
});

test("--write-launcher crea .harness/, scrive i due file e ne stampa i percorsi", () => {
  const dir = tempProject([issue(A)]);
  try {
    const { code, out } = run(["--project-dir", dir, "--write-launcher"]);
    assert.equal(code, 0);
    const paths = launcherPaths(dir);
    assert.equal(existsSync(paths.cmd), true, ".harness/board.cmd è sul disco");
    assert.equal(existsSync(paths.sh), true, ".harness/board.sh è sul disco");
    assert.ok(out.includes(paths.cmd), "il percorso del .cmd è stampato");
    assert.ok(out.includes(paths.sh), "il percorso del .sh è stampato");
    // Scrive e basta: il board non lo disegna, o il secondo terminale nascerebbe già sporco.
    assert.equal(out.includes("aaaaaaaa"), false);
  } finally {
    cleanup(dir);
  }
});

test("i lanciatori portano il percorso reale di questo board-cli, virgolettato, e chiedono il watch", () => {
  const dir = tempProject([issue(A)]);
  try {
    run(["--project-dir", dir, "--write-launcher"]);
    const paths = launcherPaths(dir);
    const cmd = readFileSync(paths.cmd, "utf8");
    const sh = readFileSync(paths.sh, "utf8");

    assert.ok(cmd.includes(`"${CLI}"`), "il .cmd cita board-cli.mjs per intero e fra virgolette");
    // Nel .sh lo stesso percorso con le barre in avanti: node le accetta anche su Windows, e una
    // barra rovescia dentro le virgolette doppie è a un passo dall'essere mangiata dalla shell.
    assert.ok(
      sh.includes(`"${CLI.split(path.sep).join("/")}"`),
      "il .sh cita lo stesso file, fra virgolette"
    );
    // Il percorso corto 8.3 funziona ed è illeggibile: è esattamente ciò che il lanciatore esiste
    // per evitare, quindi non deve comparire.
    assert.equal(/~\d/.test(cmd), false, "niente percorso 8.3 nel .cmd");

    assert.match(cmd, /--watch/);
    assert.match(sh, /--watch/);
    // Il progetto è quello di chi lancia, non quello in cui il file è stato scritto.
    assert.ok(cmd.includes('--project-dir "%CD%"'), "il .cmd guarda la directory corrente");
    assert.ok(sh.includes('--project-dir "$PWD"'), "il .sh guarda la directory corrente");
    assert.equal(cmd.includes(dir), false, "il progetto non è inchiodato dentro il .cmd");
    assert.equal(sh.includes(dir), false, "né dentro il .sh");
  } finally {
    cleanup(dir);
  }
});

test("board.sh dichiara l'interprete nella prima riga e non ha i ritorni a capo di Windows", () => {
  const dir = tempProject([issue(A)]);
  try {
    run(["--project-dir", dir, "--write-launcher"]);
    const sh = readFileSync(launcherPaths(dir).sh, "utf8");
    assert.match(sh.split("\n")[0], /^#!/, "la prima riga dichiara l'interprete");
    // Un \r dopo `#!/bin/sh` entra nel nome dell'interprete: `/bin/sh^M: not found`.
    assert.equal(sh.includes("\r"), false);
  } finally {
    cleanup(dir);
  }
});

test("rilanciare --write-launcher sovrascrive senza errore e lascia file ancora buoni", () => {
  const dir = tempProject([issue(A)]);
  try {
    assert.equal(run(["--project-dir", dir, "--write-launcher"]).code, 0);
    // Riscritti a ogni clock-in: è così che un aggiornamento di versione del plugin li ripara da
    // solo. Se la seconda scrittura fallisse su un file già esistente, non riparerebbe niente.
    const again = run(["--project-dir", dir, "--write-launcher"]);
    assert.equal(again.code, 0);
    assert.match(readFileSync(launcherPaths(dir).cmd, "utf8"), /board-cli\.mjs/);
    assert.match(readFileSync(launcherPaths(dir).sh, "utf8"), /^#!/);
  } finally {
    cleanup(dir);
  }
});

test(".harness/ appena creata si auto-ignora, e un .gitignore già suo non viene toccato", () => {
  const nuovo = tempProject([issue(A)]);
  const esistente = tempProject([issue(A)]);
  try {
    // I lanciatori contengono un percorso assoluto con dentro la home di qualcuno: se questa è la
    // chiamata che crea .harness/, la directory deve nascere già invisibile a git.
    run(["--project-dir", nuovo, "--write-launcher"]);
    assert.match(readFileSync(path.join(nuovo, ".harness", ".gitignore"), "utf8"), /^\*$/m);

    execFileSync("node", [CLI, "--project-dir", esistente, "--write-launcher"], {
      encoding: "utf8",
    });
    writeFileSync(path.join(esistente, ".harness", ".gitignore"), "# mio\n*\n", "utf8");
    run(["--project-dir", esistente, "--write-launcher"]);
    assert.equal(readFileSync(path.join(esistente, ".harness", ".gitignore"), "utf8"), "# mio\n*\n");
  } finally {
    cleanup(nuovo);
    cleanup(esistente);
  }
});

test("--write-launcher su un --project-dir inesistente resta FILE_NOT_FOUND", () => {
  const assente = path.join(tmpdir(), "non-esiste-affatto-nemmeno-per-il-lanciatore");
  const { code, out } = run(["--project-dir", assente, "--write-launcher"]);
  assert.equal(code, 1);
  assert.equal(JSON.parse(out).code, "FILE_NOT_FOUND");
  assert.equal(existsSync(path.join(assente, ".harness")), false, "non ha creato niente");
});

// --- i lanciatori, eseguiti davvero --------------------------------------------------------

test(
  "il .cmd lanciato da un altro progetto guarda quel progetto, e regge gli spazi nei percorsi",
  { skip: process.platform === "win32" ? false : "il .cmd è di cmd.exe" },
  async () => {
    const cli = fakePluginInstall();
    const scritto = tempProject([issue(A, { status: "in_progress" })]);
    const lanciato = tempSpacedProject([issue(B, { status: "in_progress" })]);
    execFileSync("node", [cli, "--project-dir", scritto, "--write-launcher"], { encoding: "utf8" });
    const child = spawn("cmd.exe", ["/c", launcherPaths(scritto).cmd], {
      cwd: lanciato,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const seen = await firstFrame(child, /bbbbbbbb/);
      assert.equal(
        seen.includes("aaaaaaaa"),
        false,
        "guarda il progetto da cui lo lanci, non quello in cui è stato scritto"
      );
      assert.match(seen, /● in_progress/, "è il watch, con le card di chi è in volo");
      assert.equal(child.exitCode, null, "e resta vivo");
    } finally {
      killTree(child);
      cleanup(lanciato);
      cleanup(scritto);
      cleanup(path.dirname(cli));
    }
  }
);

test(
  "il .sh lanciato da un altro progetto guarda quel progetto, e regge gli spazi nei percorsi",
  { skip: HAS_SH ? false : "nessuna sh su questa macchina" },
  async () => {
    const cli = fakePluginInstall();
    const scritto = tempProject([issue(A, { status: "in_progress" })]);
    const lanciato = tempSpacedProject([issue(B, { status: "in_progress" })]);
    execFileSync("node", [cli, "--project-dir", scritto, "--write-launcher"], { encoding: "utf8" });
    const child = spawn("sh", [launcherPaths(scritto).sh], {
      cwd: lanciato,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    try {
      const seen = await firstFrame(child, /bbbbbbbb/);
      assert.equal(seen.includes("aaaaaaaa"), false, "il progetto è quello di chi lancia");
      assert.match(seen, /● in_progress/);
      assert.equal(child.exitCode, null);
    } finally {
      killTree(child);
      cleanup(lanciato);
      cleanup(scritto);
      cleanup(path.dirname(cli));
    }
  }
);

test(
  "i lanciatori inoltrano in coda quello che gli si passa",
  { skip: process.platform === "win32" ? false : "il .cmd è di cmd.exe" },
  () => {
    const dir = tempProject([issue(A)]);
    try {
      run(["--project-dir", dir, "--write-launcher"]);
      // `--width abc` è rifiutato dagli argomenti, quindi il comando esce subito invece di restare
      // in watch: prova che la coda arriva davvero al board, senza lasciare un processo appeso.
      const { code, out } = runSync("cmd.exe", ["/c", launcherPaths(dir).cmd, "--width", "abc"], dir);
      assert.equal(code, 1);
      assert.equal(JSON.parse(out).code, "INVALID_ARGUMENT");
    } finally {
      cleanup(dir);
    }
  }
);
