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
} from "../scripts/docs-gate.mjs";

const INCLUDE = ["**/*.mjs", "**/*.ts"];
const EXCLUDE = ["docs/**", "test/**", "**/*.md", "issues.json"];

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
  assert.ok(globToRegExp("*.json").test("issues.json"));
  assert.ok(!globToRegExp("*.json").test("nested/issues.json"));
});

test("a glob's literal characters are escaped, not read as a regexp", () => {
  // Without escaping, `issues.json` would also match `issuesXjson` — quietly, and only on the one
  // file the default exclude list exists to protect.
  assert.ok(globToRegExp("issues.json").test("issues.json"));
  assert.ok(!globToRegExp("issues.json").test("issuesXjson"));
});

test("exclude wins over include", () => {
  // The shipped defaults only work this way round: `**/*.mjs` sweeps in every script, and
  // `test/**` has to be able to take the tests back out.
  assert.ok(isCodeFile("scripts/docs-gate.mjs", INCLUDE, EXCLUDE));
  assert.ok(!isCodeFile("test/plugin-docs-gate.test.mjs", INCLUDE, EXCLUDE));
  assert.ok(!isCodeFile("README.md", INCLUDE, EXCLUDE));
  assert.ok(!isCodeFile("issues.json", INCLUDE, EXCLUDE));
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
      commit("aaaaaaaabbbb", ["a.mjs"], "fix: canonicalise the board's project dir before watching it"),
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
