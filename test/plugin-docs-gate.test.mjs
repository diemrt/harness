// The decision of the docs gate is a function of data in memory: which files count as code, which
// revisions are declared, which commits are left uncovered. No git, no repository, no process —
// exactly the split status-cli.mjs already uses for buildSnapshot, and for the same reason: the
// part worth getting wrong is provable with objects.

import test from "node:test";
import assert from "node:assert/strict";
import {
  globToRegExp,
  isCodeFile,
  declaredRefs,
  buildGateReport,
  renderGateReport,
  WIDTH,
  parseLog,
} from "../scripts/docs-gate.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { serializeIssue } from "../scripts/issue-store.mjs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const INCLUDE = ["**/*.mjs", "**/*.ts"];
const EXCLUDE = ["docs/**", "test/**", "**/*.md", ".harness/**"];

function commit(sha, files, subject = `commit ${sha}`) {
  return { sha, subject, files };
}

test("**/ matches zero directories as well as many", () => {
  // The whole point of the shipped default `**/*.mjs`: a script at the root counts as code too.
  const re = globToRegExp("**/*.mjs");
  assert.ok(re.test("index.mjs"));
  assert.ok(re.test("scripts/docs-gate.mjs"));
  assert.ok(re.test("a/b/c/deep.mjs"));
  assert.ok(!re.test("index.js"));
});

test("a trailing ** matches everything under a directory, and * never crosses a separator", () => {
  assert.ok(globToRegExp("docs/**").test("docs/superpowers/specs/x.md"));
  assert.ok(!globToRegExp("docs/**").test("scripts/x.md"));
  assert.ok(globToRegExp("*.json").test("package.json"));
  assert.ok(!globToRegExp("*.json").test("nested/package.json"));
});

test("a glob's literal characters are escaped, not read as a regexp", () => {
  // Without escaping, `package.json` would also match `packageXjson` — quietly, on exactly the
  // kind of literal filename an exclude list is written with.
  assert.ok(globToRegExp("package.json").test("package.json"));
  assert.ok(!globToRegExp("package.json").test("packageXjson"));
});

test("exclude wins over include", () => {
  // The shipped defaults only work this way round: `**/*.mjs` sweeps in every script, and
  // `test/**` has to be able to take the tests back out.
  assert.ok(isCodeFile("scripts/docs-gate.mjs", INCLUDE, EXCLUDE));
  assert.ok(!isCodeFile("test/plugin-docs-gate.test.mjs", INCLUDE, EXCLUDE));
  assert.ok(!isCodeFile("README.md", INCLUDE, EXCLUDE));
  assert.ok(!isCodeFile(".harness/issues/aaaaaaaa.md", INCLUDE, EXCLUDE), "the tracker is not code");
});

test("declaredRefs collects covers from issues of EVERY status", () => {
  // Coverage means an issue naming the commit EXISTS, not that it is closed. The gate is a
  // tracked reminder, not a veto: filtering by status here would quietly turn it into one.
  const refs = declaredRefs([
    { id: "a", status: "backlog", covers: ["aaa1111"] },
    { id: "b", status: "blocked", covers: ["bbb2222"] },
    { id: "c", status: "done", covers: ["ccc3333"] },
  ]);
  assert.deepEqual(refs, ["aaa1111", "bbb2222", "ccc3333"]);
});

test("declaredRefs treats a missing covers key as [], and drops duplicates and blanks", () => {
  // A tracker still at schema_version 1 has no covers key at all and must simply read as "no
  // declared revisions" — never as a crash.
  const refs = declaredRefs([
    { id: "a", status: "done" },
    { id: "b", status: "done", covers: null },
    { id: "c", status: "done", covers: ["aaa1111", "  ", "aaa1111"] },
  ]);
  assert.deepEqual(refs, ["aaa1111"]);
});

test("a commit touching no code file is not in the report at all", () => {
  const report = buildGateReport({
    commits: [commit("sha1", ["README.md", "docs/spec.md"])],
    covered: new Set(),
    include: INCLUDE,
    exclude: EXCLUDE,
  });
  assert.equal(report.scanned, 1, "it was still scanned");
  assert.equal(report.code.length, 0, "but it is not a code commit");
  assert.equal(report.uncovered.length, 0);
});

test("a code commit nobody names is uncovered; one an issue names is not", () => {
  const report = buildGateReport({
    commits: [
      commit("sha1", ["scripts/a.mjs", "README.md"]),
      commit("sha2", ["scripts/b.mjs"]),
    ],
    covered: new Set(["sha2"]),
    include: INCLUDE,
    exclude: EXCLUDE,
  });
  assert.equal(report.code.length, 2);
  assert.deepEqual(
    report.uncovered.map((entry) => entry.sha),
    ["sha1"]
  );
  assert.deepEqual(
    report.code.find((entry) => entry.sha === "sha1").files,
    ["scripts/a.mjs"],
    "only the code files of the commit are reported, not every file it touched"
  );
});

test("covered may be passed as a plain array", () => {
  const report = buildGateReport({
    commits: [commit("sha1", ["a.mjs"])],
    covered: ["sha1"],
    include: INCLUDE,
    exclude: EXCLUDE,
  });
  assert.equal(report.uncovered.length, 0);
});

test("the rendered report states the three counts, agreeing in number", () => {
  const report = buildGateReport({
    commits: [commit("aaaaaaaabbbb", ["a.mjs"], "feat: something"), commit("ccccccccdddd", ["b.md"])],
    covered: new Set(),
    include: INCLUDE,
    exclude: EXCLUDE,
  });
  const rendered = renderGateReport(report, { project: "harness", window: "finestra da aaaaaaaa" });
  const lines = rendered.split("\n");

  assert.equal(lines[0], " harness · gate documentale");
  assert.equal(lines[1], " finestra da aaaaaaaa", "the window gets its own line, or the header overflows");
  assert.ok(
    lines.some(
      (line) =>
        line.includes("2 commit nella finestra") &&
        // Singular: "1 toccano" reads as a bug in the count, on the line read first.
        line.includes("1 tocca codice") &&
        line.includes("1 non coperto")
    ),
    `the counts line is missing or does not agree in number:\n${rendered}`
  );
  assert.ok(
    lines.some((line) => line.includes("aaaaaaaa") && line.includes("feat: something")),
    "the uncovered commit must appear with its short sha and its subject"
  );
});

test("no line overflows 80 columns, with the window label the script actually builds", () => {
  // The regression this exists for: rendered with a short synthetic window, everything fits and
  // the check passes; rendered with the real label — 55 columns on its own — the header ran to 93
  // and nothing noticed. Both the project name and the window here are the real shapes.
  const report = buildGateReport({
    commits: [
      commit("aaaaaaaabbbb", ["a.mjs"], "fix: canonicalise the tracker project dir before reading it"),
      commit("ccccccccdddd", ["b.mjs"], "feat: alert lines and empty states in the snapshot render"),
    ],
    covered: new Set(),
    include: INCLUDE,
    exclude: EXCLUDE,
  });
  const rendered = renderGateReport(report, {
    project: "activitymanager",
    window: "finestra da 3a612087 · più vecchia revisione dichiarata",
    unresolved: ["deadbeefdeadbeef", "v1.2.0-rc1"],
  });
  for (const line of rendered.split("\n")) {
    assert.ok(line.length <= WIDTH, `line longer than ${WIDTH} columns: ${JSON.stringify(line)}`);
  }
});

test("nothing uncovered is an explicit empty state, not an empty section", () => {
  const report = buildGateReport({
    commits: [commit("sha1", ["a.mjs"])],
    covered: new Set(["sha1"]),
    include: INCLUDE,
    exclude: EXCLUDE,
  });
  const rendered = renderGateReport(report, { project: "harness", window: "finestra da sha1" });
  assert.match(rendered, /nessun commit di codice scoperto/);
});

test("an unresolved reference becomes an alert line above the bar, wrapped and never truncated", () => {
  const report = buildGateReport({ commits: [], covered: new Set(), include: INCLUDE, exclude: EXCLUDE });
  const rendered = renderGateReport(report, {
    project: "harness",
    window: "finestra da aaaaaaaa",
    unresolved: ["deadbee", "notarevision", "another-one-that-is-long", "and-a-fourth-one-here"],
  });
  const lines = rendered.split("\n");

  const bar = lines.findIndex((line) => line.startsWith("═"));
  const alert = lines.findIndex((line) => line.startsWith(" !"));
  assert.ok(alert !== -1 && alert < bar, "the alert must sit above the bar: it is read first");

  for (const ref of ["deadbee", "notarevision", "another-one-that-is-long", "and-a-fourth-one-here"]) {
    assert.ok(rendered.includes(ref), `the unresolved reference ${ref} must survive verbatim`);
  }
  for (const line of lines) {
    assert.ok(line.length <= WIDTH, `line longer than ${WIDTH} columns: ${JSON.stringify(line)}`);
  }
});

// ---------------------------------------------------------------------------
// The shell: everything that needs a real repository. One temporary git repo per test, built with
// a fixed clock — the window autocalibrates on committer date, and two commits made inside the
// same second would make "the oldest" a coin toss.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "docs-gate.mjs");

function sh(cmd, args, cwd, env = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(
    result.status,
    0,
    `${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`
  );
  return result;
}

let minute = 0;

function gitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-gate-"));
  sh("git", ["init", "-q", "-b", "main"], dir);
  sh("git", ["config", "user.email", "test@example.com"], dir);
  sh("git", ["config", "user.name", "Test"], dir);
  return dir;
}

function makeCommit(dir, files, subject) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  sh("git", ["add", "-A"], dir);
  minute += 1;
  const when = `2026-01-01T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
    minute % 60
  ).padStart(2, "0")}:00Z`;
  sh("git", ["commit", "-q", "-m", subject], dir, {
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_DATE: when,
  });
  return sh("git", ["rev-parse", "HEAD"], dir).stdout.trim();
}

// Written AFTER the commits on purpose: the tracker and the config are the gate's input, not part
// of the history it reads.
function writeHarness(dir, { issues = [], docsGate } = {}) {
  mkdirSync(path.join(dir, ".harness", "issues"), { recursive: true });
  writeFileSync(
    path.join(dir, ".harness", "config.json"),
    JSON.stringify({ verify: "npm test", ...(docsGate === undefined ? {} : { docsGate }) }, null, 2),
    "utf8"
  );
  // One file per issue, named by the first eight characters of its id, so a fixture describing
  // several issues needs ids that differ there: position supplies them.
  issues.forEach((entry, index) => {
    const id = `${String(index + 1).repeat(8)}-1111-1111-1111-111111111111`;
    writeFileSync(
      path.join(dir, ".harness", "issues", `${entry.status}-${id.slice(0, 8)}.md`),
      serializeIssue({
        id,
        title: `Issue ${index + 1}`,
        description: "fixture",
        status: entry.status,
        tier: null,
        depends_on: [],
        covers: entry.covers,
        tasks: [],
        validation: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      }),
      "utf8"
    );
  });
}

function issue(covers, status = "backlog") {
  return { id: "11111111-1111-1111-1111-111111111111", status, covers };
}

function runGate(dir, args = []) {
  return spawnSync(process.execPath, [SCRIPT, "--project-dir", dir, ...args], {
    encoding: "utf8",
  });
}

test("parseLog splits records without any quoting", () => {
  const stdout = "\u001fsha1\u001ffeat: one\n\nscripts/a.mjs\nREADME.md\n\u001fsha2\u001ffix: two\n\ndocs/b.md\n";
  assert.deepEqual(parseLog(stdout), [
    { sha: "sha1", subject: "feat: one", files: ["scripts/a.mjs", "README.md"] },
    { sha: "sha2", subject: "fix: two", files: ["docs/b.md"] },
  ]);
});

test("the window starts at the oldest declared revision, and the report is exit 0", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    makeCommit(dir, { "b.mjs": "2" }, "feat: second");
    makeCommit(dir, { "README.md": "3" }, "docs: third");
    writeHarness(dir, { issues: [issue([first])] });

    const result = runGate(dir);
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.stderr, "", "nothing is ever written to stderr");
    assert.match(result.stdout, new RegExp(`finestra da ${first.slice(0, 8)}`));
    // Two commits after the start: the .mjs one is code and uncovered, the .md one is not code.
    assert.match(result.stdout, /2 commit nella finestra/);
    assert.match(result.stdout, /1 tocca codice/);
    assert.match(result.stdout, /1 non coperto/);
    assert.match(result.stdout, /feat: second/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finding uncovered commits is still exit 0: a finding is not a failure", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    makeCommit(dir, { "b.mjs": "2" }, "feat: uncovered");
    writeHarness(dir, { issues: [issue([first])] });

    // A different exit code for "I found uncovered commits" would be handy in CI and would break
    // the contract every other script of this plugin keeps, where 1 means the request was not
    // carried out. Whoever wants a CI gate reads the output.
    assert.equal(runGate(dir).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a short sha in covers resolves to the same revision as the long one", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    const second = makeCommit(dir, { "b.mjs": "2" }, "feat: second");
    writeHarness(dir, { issues: [issue([first]), issue([second.slice(0, 7)])] });

    const result = runGate(dir);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /0 non coperti/);
    assert.match(result.stdout, /nessun commit di codice scoperto/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a covers entry that does not resolve is reported, not silently dropped", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    makeCommit(dir, { "b.mjs": "2" }, "feat: second");
    writeHarness(dir, { issues: [issue([first, "deadbeefdeadbeef"])] });

    const result = runGate(dir);
    assert.equal(result.status, 0, "an unresolved reference is a finding, not an error");
    assert.match(result.stdout, /deadbeefdeadbeef/);
    assert.match(result.stdout, /non risolve/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("coverage counts an issue in backlog: the gate is a reminder, not a veto", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    const second = makeCommit(dir, { "b.mjs": "2" }, "feat: second");
    writeHarness(dir, { issues: [issue([first]), issue([second], "backlog")] });

    assert.match(runGate(dir).stdout, /0 non coperti/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no declared revision and no --since: it stops and asks, exit 1", () => {
  const dir = gitRepo();
  try {
    makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    writeHarness(dir, { issues: [] });

    const result = runGate(dir);
    // A guessed starting point here does not produce an error: it produces a plausible, useless
    // list, which is worse.
    assert.equal(result.status, 1);
    assert.match(result.stdout, /--since/);
    assert.equal(result.stderr, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--since gives an explicit window even with an empty tracker", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    makeCommit(dir, { "b.mjs": "2" }, "feat: second");
    writeHarness(dir, { issues: [] });

    const result = runGate(dir, ["--since", first]);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /--since/);
    assert.match(result.stdout, /1 non coperto/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a --since that does not resolve is exit 1", () => {
  const dir = gitRepo();
  try {
    makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    writeHarness(dir, { issues: [] });

    const result = runGate(dir, ["--since", "not-a-revision"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /not-a-revision/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tracker still on the legacy issues.json is exit 1, naming the command that migrates it", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    writeHarness(dir, { issues: [] });
    // The gate reads the tracker through issue-manager --dump, so an unmigrated project fails the
    // same way everywhere instead of each reader inventing its own answer.
    writeFileSync(
      path.join(dir, "issues.json"),
      JSON.stringify({ schema_version: 3, issues: [issue([first])] }),
      "utf8"
    );

    const result = runGate(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /non è leggibile/);
    assert.match(result.stdout, /--upgrade/);
    assert.equal(result.stderr, "", "nothing is ever written to stderr");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docsGate.enabled false is declared and the script stops, exit 0", () => {
  const dir = gitRepo();
  try {
    makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    writeHarness(dir, { issues: [], docsGate: { enabled: false } });

    const result = runGate(dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /disabilitato/);
    assert.doesNotMatch(result.stdout, /NON COPERTI/, "a disabled gate reports nothing else");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a partial docsGate is completed with the defaults, not left half empty", () => {
  const dir = gitRepo();
  try {
    const first = makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    makeCommit(dir, { "b.mjs": "2" }, "feat: second");
    // Only `exclude` is given: `include` must still come from the defaults, or the gate would
    // report itself as active while matching no file at all.
    writeHarness(dir, { issues: [issue([first])], docsGate: { exclude: ["docs/**"] } });

    assert.match(runGate(dir).stdout, /1 non coperto/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing .harness/config.json is exit 1: the globs are the project's decision", () => {
  const dir = gitRepo();
  try {
    makeCommit(dir, { "a.mjs": "1" }, "feat: first");
    const result = runGate(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /config\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a directory that is not a git repository is exit 1", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-nogit-"));
  try {
    writeHarness(dir, { issues: [] });
    const result = runGate(dir);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "", "git's own noise must never reach stderr through this script");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown flag stops instead of answering a different question", () => {
  const dir = gitRepo();
  try {
    writeHarness(dir, { issues: [] });
    const result = runGate(dir, ["--all"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /--project-dir/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--help exits 0 and needs no project at all", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--since/);
  assert.equal(result.stderr, "");
});
