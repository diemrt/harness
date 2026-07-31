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
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "scripts", "board-cli.mjs");

const { parseArgs, selectIssues, decideColors, readIssues, draw } = await import(
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
