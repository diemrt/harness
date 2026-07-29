// Behavioural suite for the plugin's issue-manager: identical contract to the v1 script, but
// the data directory is decided by the caller (cwd or --project-dir) rather than by where the
// script happens to live.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(rootDir, "scripts", "issue-manager.mjs");

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ID_ONE = "11111111-1111-1111-1111-111111111111";
const ID_TWO = "22222222-2222-2222-2222-222222222222";
const ID_THREE = "33333333-3333-3333-3333-333333333333";
const UNKNOWN_GUID = "99999999-9999-9999-9999-999999999999";

function baseSeed() {
  return {
    project: "Test",
    last_updated: "1970-01-01T00:00:00Z",
    rules: { single_active_issue: false },
    status_legend: {
      backlog: "Work has not begun.",
      in_progress: "The issue is the current active task.",
      blocked: "Work cannot continue until a documented blocker is resolved.",
      done: "The issue has been completed and verified.",
    },
    tags: ["feature", "bug", "chore", "documentation", "testing"],
    issues: [
      {
        id: ID_ONE,
        title: "Issue One",
        description: "Desc one",
        status: "backlog",
        validation: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: ID_TWO,
        title: "Issue Two",
        description: "Desc two",
        status: "backlog",
        validation: { criteria: "criteria two", state: "unknown" },
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
      {
        id: ID_THREE,
        title: "Issue Three",
        description: "Desc three",
        status: "in_progress",
        validation: null,
        created_at: "2026-01-03T00:00:00Z",
        updated_at: "2026-01-03T00:00:00Z",
      },
    ],
  };
}

// Sets up a fresh temp project directory, seeded with an issues.json unless seed === null.
// The script itself is never copied: it stays in the plugin and resolves issues.json against
// the project directory it is pointed at.
function setupTempProject(seed = baseSeed()) {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-"));
  if (seed !== null) {
    writeFileSync(path.join(dir, "issues.json"), JSON.stringify(seed, null, 2), "utf8");
  }
  return { dir };
}

// Role-neutral by design: HARNESS_ROLE is dropped so the suite behaves the same whether or not the
// test-runner itself was launched as a worker. Tests that need a role use runWithRole() instead.
function run(cwd, args) {
  const env = { ...process.env };
  delete env.HARNESS_ROLE;
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: "utf8",
    env,
    cwd,
  });
}

// Asserts the subprocess produced exactly the envelope shape the contract mandates: one line of
// JSON on stdout, nothing on stderr, and an exit code consistent with `ok`.
function assertEnvelope(result) {
  assert.equal(result.stderr, "", "stderr must be empty");
  const lines = result.stdout.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1, `stdout must be exactly one line, got: ${JSON.stringify(result.stdout)}`);
  let parsed;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(lines[0]);
  }, "stdout line must be parsable JSON");
  return parsed;
}

function assertOk(result) {
  const parsed = assertEnvelope(result);
  assert.equal(result.status, 0, "exit code must be 0 on success");
  assert.equal(parsed.ok, true);
  assert.ok("data" in parsed, "success envelope must carry a data field");
  return parsed.data;
}

function assertFail(result, code) {
  const parsed = assertEnvelope(result);
  assert.equal(result.status, 1, "exit code must be 1 on failure");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, code);
  assert.equal(typeof parsed.error, "string");
  assert.ok(parsed.error.length > 0);
  return parsed;
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// --get
// ---------------------------------------------------------------------------

test("--get returns the issue object", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--get", "--issue-id", ID_ONE]);
    const data = assertOk(result);
    assert.equal(data.id, ID_ONE);
    assert.equal(data.title, "Issue One");
    assert.equal(data.status, "backlog");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// --get-all
// ---------------------------------------------------------------------------

test("--get-all returns the pagination shape and defaults to backlog status", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--get-all"]);
    const data = assertOk(result);
    assert.deepEqual(Object.keys(data).sort(), ["issues", "page", "pageSize", "totalCount"].sort());
    assert.equal(data.totalCount, 2); // ID_ONE and ID_TWO are backlog
    assert.equal(data.page, 0);
    assert.equal(data.pageSize, 10);
    assert.ok(Array.isArray(data.issues));
    assert.equal(data.issues.length, 2);
    assert.deepEqual(data.issues.map((i) => i.id), [ID_ONE, ID_TWO]);
  } finally {
    cleanup(dir);
  }
});

test("--get-all --order desc reverses the sort order", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--get-all", "--order", "desc"]);
    const data = assertOk(result);
    assert.deepEqual(data.issues.map((i) => i.id), [ID_TWO, ID_ONE]);
  } finally {
    cleanup(dir);
  }
});

test("--get-all --status filters by status", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--get-all", "--status", "in_progress"]);
    const data = assertOk(result);
    assert.equal(data.totalCount, 1);
    assert.deepEqual(data.issues.map((i) => i.id), [ID_THREE]);
  } finally {
    cleanup(dir);
  }
});

test("--get-all page past the end returns an empty issues array", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--get-all", "--page", "5", "--page-size", "10"]);
    const data = assertOk(result);
    assert.equal(data.totalCount, 2);
    assert.deepEqual(data.issues, []);
  } finally {
    cleanup(dir);
  }
});

test("--get-all negative page is treated as 0", () => {
  const { dir } = setupTempProject();
  try {
    const resultNeg = run(dir, ["--get-all", "--page", "-3"]);
    const resultZero = run(dir, ["--get-all", "--page", "0"]);
    const dataNeg = assertOk(resultNeg);
    const dataZero = assertOk(resultZero);
    assert.deepEqual(dataNeg.issues, dataZero.issues);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// --insert
// ---------------------------------------------------------------------------

test("--insert generates an id and sets created_at/updated_at", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({
      title: "New Issue",
      description: "New Description",
      status: "backlog",
    });
    const result = run(dir, ["--insert", "--issue-data", payload]);
    const data = assertOk(result);
    assert.ok(GUID_RE.test(data.id), `id must be a GUID, got: ${data.id}`);
    assert.equal(data.title, "New Issue");
    assert.equal(data.description, "New Description");
    assert.equal(data.status, "backlog");
    assert.equal(data.validation, null);
    assert.ok(data.created_at, "created_at must be set");
    assert.equal(data.created_at, data.updated_at);

    // Confirm it was actually persisted
    const getResult = run(dir, ["--get", "--issue-id", data.id]);
    const getData = assertOk(getResult);
    assert.equal(getData.title, "New Issue");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// --update
// ---------------------------------------------------------------------------

test("--update merges: omitted fields keep their current value", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ status: "done" });
    const result = run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", payload]);
    const data = assertOk(result);
    assert.equal(data.id, ID_ONE);
    assert.equal(data.status, "done");
    // Omitted fields preserved from seed
    assert.equal(data.title, "Issue One");
    assert.equal(data.description, "Desc one");
    assert.equal(data.created_at, "2026-01-01T00:00:00Z");
    assert.notEqual(data.updated_at, "2026-01-01T00:00:00Z");
  } finally {
    cleanup(dir);
  }
});

test('--update with explicit "validation": null clears the validation object', () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ validation: null });
    const result = run(dir, ["--update", "--issue-id", ID_TWO, "--issue-data", payload]);
    const data = assertOk(result);
    assert.equal(data.id, ID_TWO);
    assert.equal(data.validation, null);
    // Other fields untouched
    assert.equal(data.title, "Issue Two");
    assert.equal(data.status, "backlog");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// --delete
// ---------------------------------------------------------------------------

test("--delete returns { id, deleted } and removes the issue", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--delete", "--issue-id", ID_ONE]);
    const data = assertOk(result);
    assert.deepEqual(data, { id: ID_ONE, deleted: true });

    const getResult = run(dir, ["--get", "--issue-id", ID_ONE]);
    assertFail(getResult, "NOT_FOUND");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// --help
// ---------------------------------------------------------------------------

test("--help prints plain text usage on stdout, exits 0, and writes nothing to stderr", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--help"]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.ok(result.stdout.includes("Usage:"));
    assert.ok(result.stdout.includes("--get-all"));
    // Help text is NOT a single JSON line
    assert.throws(() => JSON.parse(result.stdout.trim()));
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

test("INVALID_ID: --get with a non-GUID issue id", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--get", "--issue-id", "not-a-guid"]);
    assertFail(result, "INVALID_ID");
  } finally {
    cleanup(dir);
  }
});

test("INVALID_STATUS: --insert with an out-of-enum status", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ title: "t", description: "d", status: "bogus" });
    const result = run(dir, ["--insert", "--issue-data", payload]);
    assertFail(result, "INVALID_STATUS");
  } finally {
    cleanup(dir);
  }
});

test("INVALID_STATE: --insert with an out-of-enum validation.state", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({
      title: "t",
      description: "d",
      status: "backlog",
      validation: { criteria: "c", state: "bogus" },
    });
    const result = run(dir, ["--insert", "--issue-data", payload]);
    assertFail(result, "INVALID_STATE");
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: unknown field in payload", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ title: "t", description: "d", status: "backlog", foo: "bar" });
    const result = run(dir, ["--insert", "--issue-data", payload]);
    assertFail(result, "INVALID_INPUT");
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: empty required field", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ title: "", description: "d", status: "backlog" });
    const result = run(dir, ["--insert", "--issue-data", payload]);
    assertFail(result, "INVALID_INPUT");
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: empty object {} rejected on --update", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", "{}"]);
    assertFail(result, "INVALID_INPUT");
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: --page-size 0 is rejected", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--get-all", "--page-size", "0"]);
    assertFail(result, "INVALID_INPUT");
  } finally {
    cleanup(dir);
  }
});

test("INVALID_JSON: malformed JSON payload", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--insert", "--issue-data", "{not json"]);
    assertFail(result, "INVALID_JSON");
  } finally {
    cleanup(dir);
  }
});

test("NOT_FOUND: --get with a well-formed but absent GUID", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--get", "--issue-id", UNKNOWN_GUID]);
    assertFail(result, "NOT_FOUND");
  } finally {
    cleanup(dir);
  }
});

test("a project without issues.json reads as an empty tracker, and stays untouched", () => {
  const { dir } = setupTempProject(null);
  try {
    const result = run(dir, ["--get-all"]);
    const data = assertOk(result);
    assert.equal(data.totalCount, 0);
    assert.deepEqual(data.issues, []);
    assert.equal(
      existsSync(path.join(dir, "issues.json")),
      false,
      "a read must not create issues.json"
    );
  } finally {
    cleanup(dir);
  }
});

test("FILE_NOT_FOUND: --issue-data-file points at a nonexistent path", () => {
  const { dir } = setupTempProject();
  try {
    const missingPath = path.join(dir, "does-not-exist.json");
    const result = run(dir, ["--insert", "--issue-data-file", missingPath]);
    assertFail(result, "FILE_NOT_FOUND");
  } finally {
    cleanup(dir);
  }
});

test("MISSING_ARGS: --issue-data and --issue-data-file passed together", () => {
  const { dir } = setupTempProject();
  try {
    const dataFilePath = path.join(dir, "payload.json");
    writeFileSync(dataFilePath, JSON.stringify({ title: "t", description: "d", status: "backlog" }), "utf8");
    const result = run(dir, [
      "--insert",
      "--issue-data",
      '{"title":"t","description":"d","status":"backlog"}',
      "--issue-data-file",
      dataFilePath,
    ]);
    assertFail(result, "MISSING_ARGS");
  } finally {
    cleanup(dir);
  }
});

test("MISSING_ARGS: --get without --issue-id", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--get"]);
    assertFail(result, "MISSING_ARGS");
  } finally {
    cleanup(dir);
  }
});

test("UNKNOWN_COMMAND: no recognized command flag", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, []);
    assertFail(result, "UNKNOWN_COMMAND");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// Role guard (HARNESS_ROLE=worker cannot self-validate)
// ---------------------------------------------------------------------------

// Same as run(), but forwards an explicit HARNESS_ROLE env var (or its absence) to the subprocess
// instead of relying on whatever happens to be set in the parent test-runner's environment.
function runWithRole(cwd, args, role) {
  const env = { ...process.env };
  if (role === undefined) {
    delete env.HARNESS_ROLE;
  } else {
    env.HARNESS_ROLE = role;
  }
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: "utf8",
    env,
    cwd,
  });
}

test("FORBIDDEN_ROLE: worker cannot --update status to done", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ status: "done" });
    const result = runWithRole(
      dir,
      ["--update", "--issue-id", ID_ONE, "--issue-data", payload],
      "worker"
    );
    assertFail(result, "FORBIDDEN_ROLE");

    // Confirm nothing was persisted: the issue must still be in its original status
    const getResult = run(dir, ["--get", "--issue-id", ID_ONE]);
    const data = assertOk(getResult);
    assert.equal(data.status, "backlog");
  } finally {
    cleanup(dir);
  }
});

test("FORBIDDEN_ROLE: worker cannot --update validation.state to pass", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ validation: { criteria: "x", state: "pass" } });
    const result = runWithRole(
      dir,
      ["--update", "--issue-id", ID_ONE, "--issue-data", payload],
      "worker"
    );
    assertFail(result, "FORBIDDEN_ROLE");
  } finally {
    cleanup(dir);
  }
});

test("FORBIDDEN_ROLE: worker cannot --insert an issue with status done", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ title: "t", description: "d", status: "done" });
    const result = runWithRole(dir, ["--insert", "--issue-data", payload], "worker");
    assertFail(result, "FORBIDDEN_ROLE");
  } finally {
    cleanup(dir);
  }
});

test("FORBIDDEN_ROLE: worker cannot --insert an issue with validation.state pass", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({
      title: "t",
      description: "d",
      status: "backlog",
      validation: { criteria: "x", state: "pass" },
    });
    const result = runWithRole(dir, ["--insert", "--issue-data", payload], "worker");
    assertFail(result, "FORBIDDEN_ROLE");
  } finally {
    cleanup(dir);
  }
});

test("worker MAY set status up to in_review", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ status: "in_review" });
    const result = runWithRole(
      dir,
      ["--update", "--issue-id", ID_ONE, "--issue-data", payload],
      "worker"
    );
    const data = assertOk(result);
    assert.equal(data.status, "in_review");
  } finally {
    cleanup(dir);
  }
});

test("worker MAY set validation.state up to unknown", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ validation: { criteria: "x", state: "unknown" } });
    const result = runWithRole(
      dir,
      ["--update", "--issue-id", ID_ONE, "--issue-data", payload],
      "worker"
    );
    const data = assertOk(result);
    assert.deepEqual(data.validation, { criteria: "x", state: "unknown" });
  } finally {
    cleanup(dir);
  }
});

test("no HARNESS_ROLE set: status=done via --update behaves unchanged (allowed)", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ status: "done" });
    const result = runWithRole(
      dir,
      ["--update", "--issue-id", ID_ONE, "--issue-data", payload],
      undefined
    );
    const data = assertOk(result);
    assert.equal(data.status, "done");
  } finally {
    cleanup(dir);
  }
});

test("HARNESS_ROLE set to a non-worker value: status=done is unaffected", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ status: "done" });
    const result = runWithRole(
      dir,
      ["--update", "--issue-id", ID_ONE, "--issue-data", payload],
      "reviewer"
    );
    const data = assertOk(result);
    assert.equal(data.status, "done");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// project resolution — the plugin script serves any project without being copied into it
// ---------------------------------------------------------------------------

// Runs the script from a cwd that is deliberately NOT the project, so only --project-dir can
// point it at the right issues.json.
function runFrom(cwd, args) {
  const env = { ...process.env };
  delete env.HARNESS_ROLE;
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: "utf8", env, cwd });
}

test("--project-dir operates on that project, not on the cwd", () => {
  const target = setupTempProject();
  const elsewhere = setupTempProject(null);
  try {
    const result = runFrom(elsewhere.dir, ["--get", "--issue-id", ID_ONE, "--project-dir", target.dir]);
    const data = assertOk(result);
    assert.equal(data.title, "Issue One");
    assert.equal(
      existsSync(path.join(elsewhere.dir, "issues.json")),
      false,
      "the cwd must be left alone when --project-dir is given"
    );
  } finally {
    cleanup(target.dir);
    cleanup(elsewhere.dir);
  }
});

test("two projects stay independent through the same installed script", () => {
  const one = setupTempProject();
  const two = setupTempProject();
  try {
    const deleted = run(one.dir, ["--delete", "--issue-id", ID_ONE]);
    assertOk(deleted);

    assertFail(run(one.dir, ["--get", "--issue-id", ID_ONE]), "NOT_FOUND");
    assert.equal(assertOk(run(two.dir, ["--get", "--issue-id", ID_ONE])).id, ID_ONE);
  } finally {
    cleanup(one.dir);
    cleanup(two.dir);
  }
});

test("the first insert creates issues.json in a project that had none", () => {
  const { dir } = setupTempProject(null);
  try {
    const issuesPath = path.join(dir, "issues.json");
    assert.equal(existsSync(issuesPath), false);

    const payload = JSON.stringify({
      title: "First",
      description: "First issue ever",
      status: "backlog",
    });
    const created = assertOk(run(dir, ["--insert", "--issue-data", payload]));
    assert.match(created.id, GUID_RE);

    assert.equal(existsSync(issuesPath), true, "the first write must create issues.json");
    const stored = JSON.parse(readFileSync(issuesPath, "utf8"));
    assert.equal(stored.issues.length, 1);
    assert.equal(stored.issues[0].title, "First");
    assert.equal(typeof stored.last_updated, "string");

    const listed = assertOk(run(dir, ["--get-all"]));
    assert.equal(listed.totalCount, 1);
  } finally {
    cleanup(dir);
  }
});

test("no temp file is left behind next to issues.json after a write", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ title: "T", description: "D", status: "backlog" });
    assertOk(run(dir, ["--insert", "--issue-data", payload]));
    const leftovers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    cleanup(dir);
  }
});

test("FILE_NOT_FOUND: --project-dir points at a directory that does not exist", () => {
  const { dir } = setupTempProject();
  try {
    const missing = path.join(dir, "nope", "still-nope");
    assertFail(run(dir, ["--get-all", "--project-dir", missing]), "FILE_NOT_FOUND");
  } finally {
    cleanup(dir);
  }
});
