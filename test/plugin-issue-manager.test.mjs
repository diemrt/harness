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

// A bare --get-all on a tracker with mixed statuses is exactly the call that used to read as
// "the whole tracker" while it silently returns only the backlog slice (ID_THREE is in_progress
// and must NOT show up here). This default is a deliberate, documented choice — see showHelp()
// and references/issues.md — not something a caller can discover by staring at the output alone.
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

// --status has a real default (see the "status" option in main()): a bare --get-all silently
// filters to backlog instead of returning the whole tracker. The help text must say so up front,
// not just list backlog as one of several allowed values, or the CLI's own contract re-creates
// the exact confusion this issue was filed over.
test("--help declares the --status default for --get-all, not just its allowed values", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--help"]);
    assert.match(result.stdout, /--status[^\n]*default:\s*backlog/i);
    assert.match(result.stdout, /totalCount\/issues are counted AFTER the --status filter/i);
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

// ---------------------------------------------------------------------------
// tier — the expected cost of the work
// ---------------------------------------------------------------------------

function insertWithTier(dir, tier) {
  const payload = JSON.stringify({ title: "t", description: "d", status: "backlog", tier });
  return run(dir, ["--insert", "--issue-data", payload]);
}

test("every tier is accepted and survives a round trip", () => {
  const { dir } = setupTempProject();
  try {
    for (const tier of ["economy", "standard", "reasoning"]) {
      const data = assertOk(insertWithTier(dir, tier));
      assert.equal(data.tier, tier);
      assert.equal(assertOk(run(dir, ["--get", "--issue-id", data.id])).tier, tier);
    }
  } finally {
    cleanup(dir);
  }
});

test("an issue inserted without a tier stores null", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ title: "t", description: "d", status: "backlog" });
    const data = assertOk(run(dir, ["--insert", "--issue-data", payload]));
    assert.equal(data.tier, null);
  } finally {
    cleanup(dir);
  }
});

test("INVALID_TIER: a value outside the enum, on insert and on update", () => {
  const { dir } = setupTempProject();
  try {
    assertFail(insertWithTier(dir, "cheap"), "INVALID_TIER");
    assertFail(
      run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", '{"tier":"expensive"}']),
      "INVALID_TIER"
    );
  } finally {
    cleanup(dir);
  }
});

test("an explicit null clears the tier, and a tier-only update leaves everything else alone", () => {
  // A tier that went stale after a change of scope is not a defect, so it has to stay removable.
  const { dir } = setupTempProject();
  try {
    const set = assertOk(
      run(dir, ["--update", "--issue-id", ID_TWO, "--issue-data", '{"tier":"reasoning"}'])
    );
    assert.equal(set.tier, "reasoning");
    assert.equal(set.title, "Issue Two", "a tier-only update must not touch the other fields");
    assert.equal(set.status, "backlog");
    assert.equal(set.validation.criteria, "criteria two");

    const cleared = assertOk(
      run(dir, ["--update", "--issue-id", ID_TWO, "--issue-data", '{"tier":null}'])
    );
    assert.equal(cleared.tier, null);
  } finally {
    cleanup(dir);
  }
});

test("an issue stored before the field gets an explicit null, not a missing key", () => {
  // The records in a real tracker have no tier at all. Carrying an undefined through the rebuild
  // would drop the key from the stored object instead of stating that no tier is set.
  const { dir } = setupTempProject();
  try {
    const data = assertOk(
      run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", '{"status":"in_progress"}'])
    );
    assert.equal(data.tier, null);
    assert.ok("tier" in data, "the stored issue must carry the key");
  } finally {
    cleanup(dir);
  }
});

test("tier does not open the payload to other unknown fields", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({
      title: "t",
      description: "d",
      status: "backlog",
      tier: "economy",
      cost: 3,
    });
    assertFail(run(dir, ["--insert", "--issue-data", payload]), "INVALID_INPUT");
  } finally {
    cleanup(dir);
  }
});

test("--help documents tier and INVALID_TIER", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /INVALID_TIER/);
    assert.match(result.stdout, /economy \| standard \| reasoning/);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// LIMIT_EXCEEDED — length caps on the free text of an issue
// ---------------------------------------------------------------------------

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 1200;

test("LIMIT_EXCEEDED: --insert with a title one character over the cap", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({
      title: "t".repeat(TITLE_MAX + 1),
      description: "d",
      status: "backlog",
    });
    const result = run(dir, ["--insert", "--issue-data", payload]);
    const parsed = assertFail(result, "LIMIT_EXCEEDED");
    // The message must name both the measured length and the maximum: the caller has to know how
    // much to cut, not just that it cut too little.
    assert.match(parsed.error, /'title'/);
    assert.match(parsed.error, new RegExp(String(TITLE_MAX + 1)));
    assert.match(parsed.error, new RegExp(String(TITLE_MAX)));
  } finally {
    cleanup(dir);
  }
});

test("LIMIT_EXCEEDED: --insert with a description one character over the cap", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({
      title: "t",
      description: "d".repeat(DESCRIPTION_MAX + 1),
      status: "backlog",
    });
    const result = run(dir, ["--insert", "--issue-data", payload]);
    const parsed = assertFail(result, "LIMIT_EXCEEDED");
    assert.match(parsed.error, /'description'/);
    assert.match(parsed.error, new RegExp(String(DESCRIPTION_MAX + 1)));
  } finally {
    cleanup(dir);
  }
});

test("a title and a description exactly at the cap are accepted", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({
      title: "t".repeat(TITLE_MAX),
      description: "d".repeat(DESCRIPTION_MAX),
      status: "backlog",
    });
    const data = assertOk(run(dir, ["--insert", "--issue-data", payload]));
    assert.equal(data.title.length, TITLE_MAX);
    assert.equal(data.description.length, DESCRIPTION_MAX);
  } finally {
    cleanup(dir);
  }
});

test("the cap is measured on the trimmed value, so padding never decides the outcome", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({
      title: `   ${"t".repeat(TITLE_MAX)}   `,
      description: "d",
      status: "backlog",
    });
    assertOk(run(dir, ["--insert", "--issue-data", payload]));
  } finally {
    cleanup(dir);
  }
});

test("LIMIT_EXCEEDED: the cap applies to --update too, on the fields it carries", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ title: "t".repeat(TITLE_MAX + 1) });
    const result = run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", payload]);
    assertFail(result, "LIMIT_EXCEEDED");
  } finally {
    cleanup(dir);
  }
});

test("an --update that omits an over-limit field still succeeds: the merge does not revalidate it", () => {
  // The issues already in a real tracker predate the caps. Updating their status must keep working,
  // or the caps would freeze every issue written before them.
  const seed = baseSeed();
  seed.issues[0].description = "d".repeat(4150);
  const { dir } = setupTempProject(seed);
  try {
    const data = assertOk(
      run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", '{"status":"in_progress"}'])
    );
    assert.equal(data.status, "in_progress");
    assert.equal(data.description.length, 4150);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// validation.criteria — a bullet list at creation, free-form evidence at closure
// ---------------------------------------------------------------------------

const CRITERION_MAX = 200;
const CRITERIA_COUNT_MAX = 7;

function insertWithCriteria(dir, criteria, state = "unknown") {
  const payload = JSON.stringify({
    title: "t",
    description: "d",
    status: "backlog",
    validation: { criteria, state },
  });
  return run(dir, ["--insert", "--issue-data", payload]);
}

test("criteria as a bare string is rejected while the state is unknown", () => {
  const { dir } = setupTempProject();
  try {
    assertFail(insertWithCriteria(dir, "- one\n- two"), "INVALID_INPUT");
  } finally {
    cleanup(dir);
  }
});

test("criteria as an array of short strings is accepted and stored as an array", () => {
  const { dir } = setupTempProject();
  try {
    const criteria = ["the command exits 0", "the file is not created"];
    const data = assertOk(insertWithCriteria(dir, criteria));
    assert.deepEqual(data.validation.criteria, criteria);
    const reread = assertOk(run(dir, ["--get", "--issue-id", data.id]));
    assert.deepEqual(reread.validation.criteria, criteria, "the shape must survive a round trip");
  } finally {
    cleanup(dir);
  }
});

test("LIMIT_EXCEEDED: more criteria than the cap allows", () => {
  const { dir } = setupTempProject();
  try {
    const criteria = Array.from({ length: CRITERIA_COUNT_MAX + 1 }, (_, i) => `criterion ${i}`);
    const parsed = assertFail(insertWithCriteria(dir, criteria), "LIMIT_EXCEEDED");
    assert.match(parsed.error, new RegExp(String(CRITERIA_COUNT_MAX + 1)));
    assert.match(parsed.error, new RegExp(String(CRITERIA_COUNT_MAX)));
  } finally {
    cleanup(dir);
  }
});

test("exactly the maximum number of criteria is accepted", () => {
  const { dir } = setupTempProject();
  try {
    const criteria = Array.from({ length: CRITERIA_COUNT_MAX }, (_, i) => `criterion ${i}`);
    const data = assertOk(insertWithCriteria(dir, criteria));
    assert.equal(data.validation.criteria.length, CRITERIA_COUNT_MAX);
  } finally {
    cleanup(dir);
  }
});

test("LIMIT_EXCEEDED: a single criterion over the cap, named by its index", () => {
  const { dir } = setupTempProject();
  try {
    const criteria = ["short one", "c".repeat(CRITERION_MAX + 1)];
    const parsed = assertFail(insertWithCriteria(dir, criteria), "LIMIT_EXCEEDED");
    assert.match(parsed.error, /criteria\[1\]/, "the message must name which criterion is too long");
    assert.match(parsed.error, new RegExp(String(CRITERION_MAX)));
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: an empty array, or an entry that is not a non-empty string", () => {
  const { dir } = setupTempProject();
  try {
    assertFail(insertWithCriteria(dir, []), "INVALID_INPUT");
    assertFail(insertWithCriteria(dir, ["fine", "   "]), "INVALID_INPUT");
    assertFail(insertWithCriteria(dir, ["fine", 42]), "INVALID_INPUT");
    assertFail(insertWithCriteria(dir, { one: "fine" }), "INVALID_INPUT");
  } finally {
    cleanup(dir);
  }
});

test("at closure the criteria field carries evidence: string or array, uncapped", () => {
  // Evidence is the output of the commands that were run. Capping it would push a verifier towards
  // "verified, all good", which is exactly what evidence is not.
  const { dir } = setupTempProject();
  try {
    const longEvidence = "npm test output\n".repeat(500);
    assert.ok(longEvidence.length > 1200, "the fixture must exceed every other cap");

    // Evidence this size is exactly why the CLI takes a payload file: inline it would blow past the
    // command-line length limit long before the script ever saw it.
    const payloadPath = path.join(dir, "payload.json");
    const updateWith = (validation) => {
      writeFileSync(payloadPath, JSON.stringify({ validation }), "utf8");
      return assertOk(run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data-file", payloadPath]));
    };

    for (const state of ["pass", "fail"]) {
      const asString = updateWith({ criteria: longEvidence, state });
      assert.equal(asString.validation.criteria, longEvidence);

      const asArray = updateWith({
        criteria: Array.from({ length: 20 }, () => longEvidence),
        state,
      });
      assert.equal(asArray.validation.criteria.length, 20);
    }
  } finally {
    cleanup(dir);
  }
});

test("an issue stored with string criteria stays readable and updatable", () => {
  // ID_TWO in the seed carries the pre-array shape: the records written before this rule are never
  // rewritten, so reads and unrelated updates must keep working on them.
  const { dir } = setupTempProject();
  try {
    const read = assertOk(run(dir, ["--get", "--issue-id", ID_TWO]));
    assert.equal(read.validation.criteria, "criteria two");

    const updated = assertOk(
      run(dir, ["--update", "--issue-id", ID_TWO, "--issue-data", '{"status":"in_progress"}'])
    );
    assert.equal(updated.validation.criteria, "criteria two", "the legacy shape must survive");
  } finally {
    cleanup(dir);
  }
});

test("--help documents LIMIT_EXCEEDED and the caps", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /LIMIT_EXCEEDED/);
    assert.match(result.stdout, new RegExp(String(TITLE_MAX)));
    assert.match(result.stdout, new RegExp(String(DESCRIPTION_MAX)));
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
    const payload = JSON.stringify({ validation: { criteria: ["x"], state: "unknown" } });
    const result = runWithRole(
      dir,
      ["--update", "--issue-id", ID_ONE, "--issue-data", payload],
      "worker"
    );
    const data = assertOk(result);
    // tasks materializes to [] like depends_on and covers: the stored validation always carries
    // the key, so no reader has to tell a missing one from an empty list.
    assert.deepEqual(data.validation, { criteria: ["x"], tasks: [], state: "unknown" });
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

// ---------------------------------------------------------------------------
// depends_on
//
// The seeded issues deliberately carry no depends_on key: they stand in for every issue written
// before the field existed, and the merge has to keep working on them without a migration.
// ---------------------------------------------------------------------------

// Rewrites the seed so an issue declares dependencies, including shapes the CLI itself would
// refuse — the point is to prove the script survives a hand-edited issues.json.
function seedWithEdges(edges) {
  const seed = baseSeed();
  for (const issue of seed.issues) {
    if (edges[issue.id]) {
      issue.depends_on = edges[issue.id];
    }
  }
  return seed;
}

function storedIssues(dir) {
  return JSON.parse(readFileSync(path.join(dir, "issues.json"), "utf8")).issues;
}

test("--insert without depends_on stores an empty array, not a missing key", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({ title: "T", description: "D", status: "backlog" });
    const created = assertOk(run(dir, ["--insert", "--issue-data", payload]));
    assert.deepEqual(created.depends_on, []);
    const stored = storedIssues(dir).find((i) => i.id === created.id);
    assert.ok("depends_on" in stored, "the key must be materialised on disk");
  } finally {
    cleanup(dir);
  }
});

test("--insert stores the declared dependencies", () => {
  const { dir } = setupTempProject();
  try {
    const payload = JSON.stringify({
      title: "T",
      description: "D",
      status: "backlog",
      depends_on: [ID_ONE, ID_TWO],
    });
    const created = assertOk(run(dir, ["--insert", "--issue-data", payload]));
    assert.deepEqual(created.depends_on, [ID_ONE, ID_TWO]);
  } finally {
    cleanup(dir);
  }
});

test("--update adds depends_on to an issue written before the field", () => {
  const { dir } = setupTempProject();
  try {
    const updated = assertOk(
      run(dir, ["--update", "--issue-id", ID_THREE, "--issue-data", JSON.stringify({ depends_on: [ID_ONE] })])
    );
    assert.deepEqual(updated.depends_on, [ID_ONE]);
    assert.equal(updated.title, "Issue Three", "the other fields must survive the merge");
    assert.equal(updated.status, "in_progress");
  } finally {
    cleanup(dir);
  }
});

test("--update that omits depends_on leaves it untouched, and materialises [] on legacy issues", () => {
  const { dir } = setupTempProject(seedWithEdges({ [ID_THREE]: [ID_ONE] }));
  try {
    const kept = assertOk(
      run(dir, ["--update", "--issue-id", ID_THREE, "--issue-data", JSON.stringify({ status: "blocked" })])
    );
    assert.deepEqual(kept.depends_on, [ID_ONE], "an omitted field keeps its value");

    const legacy = assertOk(
      run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", JSON.stringify({ status: "blocked" })])
    );
    assert.deepEqual(legacy.depends_on, [], "an issue with no key gets the empty array, not undefined");
  } finally {
    cleanup(dir);
  }
});

test("--update with [] clears the dependencies", () => {
  const { dir } = setupTempProject(seedWithEdges({ [ID_THREE]: [ID_ONE, ID_TWO] }));
  try {
    const cleared = assertOk(
      run(dir, ["--update", "--issue-id", ID_THREE, "--issue-data", JSON.stringify({ depends_on: [] })])
    );
    assert.deepEqual(cleared.depends_on, []);
  } finally {
    cleanup(dir);
  }
});

test("INVALID_DEPENDENCY: depends_on is not an array", () => {
  const { dir } = setupTempProject();
  try {
    for (const value of [null, ID_ONE, 3, {}]) {
      assertFail(
        run(dir, ["--update", "--issue-id", ID_THREE, "--issue-data", JSON.stringify({ depends_on: value })]),
        "INVALID_DEPENDENCY"
      );
    }
  } finally {
    cleanup(dir);
  }
});

test("INVALID_DEPENDENCY: an entry that is not a GUID, or listed twice", () => {
  const { dir } = setupTempProject();
  try {
    assertFail(
      run(dir, ["--update", "--issue-id", ID_THREE, "--issue-data", JSON.stringify({ depends_on: ["nope"] })]),
      "INVALID_DEPENDENCY"
    );
    assertFail(
      run(dir, ["--update", "--issue-id", ID_THREE, "--issue-data", JSON.stringify({ depends_on: [ID_ONE, ID_ONE] })]),
      "INVALID_DEPENDENCY"
    );
  } finally {
    cleanup(dir);
  }
});

test("INVALID_DEPENDENCY: an id that does not exist in this tracker", () => {
  const { dir } = setupTempProject();
  try {
    const failed = assertFail(
      run(dir, ["--update", "--issue-id", ID_THREE, "--issue-data", JSON.stringify({ depends_on: [UNKNOWN_GUID] })]),
      "INVALID_DEPENDENCY"
    );
    assert.match(failed.error, new RegExp(UNKNOWN_GUID), "the message must name the missing id");
  } finally {
    cleanup(dir);
  }
});

test("INVALID_DEPENDENCY: an issue cannot depend on itself", () => {
  const { dir } = setupTempProject();
  try {
    assertFail(
      run(dir, ["--update", "--issue-id", ID_THREE, "--issue-data", JSON.stringify({ depends_on: [ID_THREE] })]),
      "INVALID_DEPENDENCY"
    );
  } finally {
    cleanup(dir);
  }
});

test("INVALID_DEPENDENCY: a direct cycle is refused", () => {
  const { dir } = setupTempProject(seedWithEdges({ [ID_ONE]: [ID_TWO] }));
  try {
    assertFail(
      run(dir, ["--update", "--issue-id", ID_TWO, "--issue-data", JSON.stringify({ depends_on: [ID_ONE] })]),
      "INVALID_DEPENDENCY"
    );
  } finally {
    cleanup(dir);
  }
});

test("INVALID_DEPENDENCY: an indirect cycle is refused and nothing is written", () => {
  const { dir } = setupTempProject(seedWithEdges({ [ID_ONE]: [ID_TWO], [ID_TWO]: [ID_THREE] }));
  try {
    const before = readFileSync(path.join(dir, "issues.json"), "utf8");
    const failed = assertFail(
      run(dir, ["--update", "--issue-id", ID_THREE, "--issue-data", JSON.stringify({ depends_on: [ID_ONE] })]),
      "INVALID_DEPENDENCY"
    );
    assert.match(failed.error, /cycle/i);
    assert.equal(readFileSync(path.join(dir, "issues.json"), "utf8"), before, "a refused update writes nothing");
  } finally {
    cleanup(dir);
  }
});

test("a cycle already present in a hand-edited issues.json does not hang the walk", () => {
  // The CLI cannot produce this state, a text editor can. Without the visited set the traversal
  // would never terminate and this test would time out instead of failing.
  const { dir } = setupTempProject(seedWithEdges({ [ID_ONE]: [ID_TWO], [ID_TWO]: [ID_ONE] }));
  try {
    const updated = assertOk(
      run(dir, ["--update", "--issue-id", ID_THREE, "--issue-data", JSON.stringify({ depends_on: [ID_ONE] })])
    );
    assert.deepEqual(updated.depends_on, [ID_ONE]);
  } finally {
    cleanup(dir);
  }
});

test("INVALID_DEPENDENCY: --delete is refused while other issues depend on the target", () => {
  const { dir } = setupTempProject(seedWithEdges({ [ID_TWO]: [ID_ONE], [ID_THREE]: [ID_ONE] }));
  try {
    const failed = assertFail(run(dir, ["--delete", "--issue-id", ID_ONE]), "INVALID_DEPENDENCY");
    assert.match(failed.error, new RegExp(ID_TWO));
    assert.match(failed.error, new RegExp(ID_THREE));
    assert.equal(storedIssues(dir).length, 3, "the refused delete must leave the tracker alone");
  } finally {
    cleanup(dir);
  }
});

test("--delete succeeds once the dependents stop pointing at the issue", () => {
  const { dir } = setupTempProject(seedWithEdges({ [ID_TWO]: [ID_ONE] }));
  try {
    assertOk(run(dir, ["--update", "--issue-id", ID_TWO, "--issue-data", JSON.stringify({ depends_on: [] })]));
    assertOk(run(dir, ["--delete", "--issue-id", ID_ONE]));
    assert.equal(storedIssues(dir).length, 2);
  } finally {
    cleanup(dir);
  }
});

test("depends_on does not gate the work: an issue with open dependencies can go in_progress", () => {
  const { dir } = setupTempProject(seedWithEdges({ [ID_TWO]: [ID_ONE] }));
  try {
    const updated = assertOk(
      run(dir, ["--update", "--issue-id", ID_TWO, "--issue-data", JSON.stringify({ status: "in_progress" })])
    );
    assert.equal(updated.status, "in_progress");
  } finally {
    cleanup(dir);
  }
});

test("--help documents depends_on and INVALID_DEPENDENCY", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /depends_on/);
    assert.match(result.stdout, /INVALID_DEPENDENCY/);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// schema_version — a root-level key, not part of any issue. The seeded tracker used everywhere
// else in this suite (baseSeed()) deliberately carries no schema_version: it stands in for every
// project that used the tracker before this key existed, and every command must keep working on
// it without a migration. Only --init and --upgrade are meant to write the key at all: every
// other command must leave it exactly as found — present or absent.
// ---------------------------------------------------------------------------

// Reads the whole root object of issues.json, not just its `issues` array, so a test can assert
// on schema_version (or its absence) the same way storedIssues() asserts on individual issues.
function rootData(dir) {
  return JSON.parse(readFileSync(path.join(dir, "issues.json"), "utf8"));
}

function seedWithSchemaVersion(version) {
  const seed = baseSeed();
  seed.schema_version = version;
  return seed;
}

test("--get and --get-all respond ok:true on a tracker without schema_version", () => {
  const { dir } = setupTempProject(); // baseSeed() has no schema_version key
  try {
    assert.ok(!("schema_version" in rootData(dir)), "the fixture must start without the key");

    const getResult = assertOk(run(dir, ["--get", "--issue-id", ID_ONE]));
    assert.equal(getResult.id, ID_ONE);

    const getAllResult = assertOk(run(dir, ["--get-all"]));
    assert.equal(getAllResult.totalCount, 2);
  } finally {
    cleanup(dir);
  }
});

test("--insert on a file without schema_version leaves it without the key", () => {
  const { dir } = setupTempProject();
  try {
    assert.ok(!("schema_version" in rootData(dir)));
    const payload = JSON.stringify({ title: "T", description: "D", status: "backlog" });
    assertOk(run(dir, ["--insert", "--issue-data", payload]));
    assert.ok(
      !("schema_version" in rootData(dir)),
      "an --insert must not stamp schema_version onto a file that never had it"
    );
  } finally {
    cleanup(dir);
  }
});

test("--update on a file without schema_version leaves it without the key", () => {
  const { dir } = setupTempProject();
  try {
    assert.ok(!("schema_version" in rootData(dir)));
    assertOk(
      run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", JSON.stringify({ status: "in_progress" })])
    );
    assert.ok(
      !("schema_version" in rootData(dir)),
      "an --update must not stamp schema_version onto a file that never had it"
    );
  } finally {
    cleanup(dir);
  }
});

test("--insert on a file that has schema_version rewrites it with the same value", () => {
  const { dir } = setupTempProject(seedWithSchemaVersion(1));
  try {
    assert.equal(rootData(dir).schema_version, 1);
    const payload = JSON.stringify({ title: "T", description: "D", status: "backlog" });
    assertOk(run(dir, ["--insert", "--issue-data", payload]));
    assert.equal(rootData(dir).schema_version, 1, "the existing value must survive untouched");
  } finally {
    cleanup(dir);
  }
});

test("--update on a file that has schema_version rewrites it with the same value", () => {
  const { dir } = setupTempProject(seedWithSchemaVersion(1));
  try {
    assert.equal(rootData(dir).schema_version, 1);
    assertOk(
      run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", JSON.stringify({ status: "in_progress" })])
    );
    assert.equal(rootData(dir).schema_version, 1, "the existing value must survive untouched");
  } finally {
    cleanup(dir);
  }
});

// A file with a schema_version other than the script's own SCHEMA_VERSION is out of scope here
// (that comparison belongs to the future --upgrade), but the value stored must still be whatever
// was on disk, not silently normalised to the constant this script implements.
test("--update preserves a schema_version that differs from this script's own SCHEMA_VERSION", () => {
  const { dir } = setupTempProject(seedWithSchemaVersion(0));
  try {
    assertOk(
      run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", JSON.stringify({ status: "in_progress" })])
    );
    assert.equal(rootData(dir).schema_version, 0, "an unrelated value must not be coerced to 1");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// --init — creates issues.json with the minimal seed, and never overwrites an existing one
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 3; // mirrors the constant in scripts/issue-manager.mjs

test("--init in a directory without issues.json creates it and reports created:true", () => {
  const { dir } = setupTempProject(null);
  try {
    const issuesPath = path.join(dir, "issues.json");
    assert.equal(existsSync(issuesPath), false, "the fixture must start without the file");

    const data = assertOk(run(dir, ["--init"]));
    assert.equal(data.created, true);
    assert.equal(data.path, issuesPath);
    assert.equal(existsSync(issuesPath), true, "--init must create the file");
  } finally {
    cleanup(dir);
  }
});

test("--init writes the minimal seed: schema_version at SCHEMA_VERSION, empty issues, last_updated set", () => {
  const { dir } = setupTempProject(null);
  try {
    assertOk(run(dir, ["--init"]));
    const stored = rootData(dir);
    assert.equal(stored.schema_version, SCHEMA_VERSION);
    assert.deepEqual(stored.issues, []);
    assert.equal(typeof stored.last_updated, "string");
    assert.ok(stored.last_updated.length > 0);
  } finally {
    cleanup(dir);
  }
});

test("ALREADY_EXISTS: --init where issues.json already exists writes nothing, byte for byte", () => {
  const { dir } = setupTempProject(); // seeded with baseSeed()
  try {
    const issuesPath = path.join(dir, "issues.json");
    const before = readFileSync(issuesPath); // Buffer, not string: compare raw bytes

    const result = run(dir, ["--init"]);
    assertFail(result, "ALREADY_EXISTS");

    const after = readFileSync(issuesPath);
    assert.ok(before.equals(after), "the pre-existing file must be untouched byte for byte");
  } finally {
    cleanup(dir);
  }
});

test("--init respects --project-dir", () => {
  const target = setupTempProject(null);
  const elsewhere = setupTempProject(null);
  try {
    const targetIssuesPath = path.join(target.dir, "issues.json");
    const result = runFrom(elsewhere.dir, ["--init", "--project-dir", target.dir]);
    const data = assertOk(result);
    assert.equal(data.path, targetIssuesPath);
    assert.equal(existsSync(targetIssuesPath), true);
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

test("--help lists --init among the commands", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--init/);
    assert.match(result.stdout, /ALREADY_EXISTS/);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// --upgrade — migrates issues.json from its own schema_version (absent reads as 0) up to
// SCHEMA_VERSION, applying only the migrations in between.
// ---------------------------------------------------------------------------

// A seed with mixed depends_on presence: ID_TWO already declares one (pointing at ID_ONE, itself
// with no depends_on key at all — a legal edge under a schema-less tracker), ID_ONE and ID_THREE
// have no depends_on key at all. Lets a single fixture cover both halves of migration 0 -> 1: the
// key that must appear where it is missing, and the value that must survive where it is already
// there.
function upgradeSeed() {
  const seed = baseSeed();
  const issueTwo = seed.issues.find((i) => i.id === ID_TWO);
  issueTwo.depends_on = [ID_ONE];
  return seed;
}

test("(a) --upgrade on a tracker without schema_version reports ok:true, from:0, and writes SCHEMA_VERSION", () => {
  const { dir } = setupTempProject(upgradeSeed());
  try {
    assert.ok(!("schema_version" in rootData(dir)), "the fixture must start without the key");

    const data = assertOk(run(dir, ["--upgrade"]));
    assert.deepEqual(data, { from: 0, to: SCHEMA_VERSION, migrated: 3 });

    assert.equal(rootData(dir).schema_version, SCHEMA_VERSION, "the file on disk must carry the new version");
  } finally {
    cleanup(dir);
  }
});

test("(a2) --upgrade writes schema_version as the FIRST root key and leaves the other root keys in their original order", () => {
  const { dir } = setupTempProject(upgradeSeed());
  try {
    const keysBefore = Object.keys(rootData(dir));
    assert.ok(!keysBefore.includes("schema_version"), "the fixture must start without the key");

    assertOk(run(dir, ["--upgrade"]));
    const keysAfter = Object.keys(rootData(dir));

    // Plain assignment would append the key, which is what this repository's own tracker got on its
    // first real migration: references/issues.md promises the top of the root object, so a migrated
    // tracker must have the same shape as one seeded by --init.
    assert.equal(keysAfter[0], "schema_version", "schema_version must lead the root object");
    assert.deepEqual(keysAfter.slice(1), keysBefore, "every other root key keeps its original order");
  } finally {
    cleanup(dir);
  }
});

test("(b) after --upgrade every issue has depends_on; issues that already had it keep their value, and no other field changes or disappears", () => {
  const { dir } = setupTempProject(upgradeSeed());
  const before = upgradeSeed();
  try {
    assertOk(run(dir, ["--upgrade"]));
    const after = rootData(dir).issues;

    assert.equal(after.length, before.issues.length);
    for (const beforeIssue of before.issues) {
      const afterIssue = after.find((i) => i.id === beforeIssue.id);
      assert.ok(afterIssue, `issue ${beforeIssue.id} must survive the upgrade`);

      // depends_on: materialized to [] where it was missing, preserved where it was already set.
      const expectedDependsOn = Array.isArray(beforeIssue.depends_on) ? beforeIssue.depends_on : [];
      assert.deepEqual(afterIssue.depends_on, expectedDependsOn);

      // covers: materialized to [] by migration 1 -> 2, exactly as depends_on was by 0 -> 1.
      assert.deepEqual(afterIssue.covers, []);

      // tasks: materialized to [] by migration 2 -> 3, exactly as covers was by 1 -> 2.
      assert.deepEqual(afterIssue.tasks, []);

      // Every other field is untouched, including updated_at: adding a field is not editing the
      // issue, and the migration must not read as a second --update pass.
      for (const field of ["title", "description", "status", "created_at", "updated_at"]) {
        assert.deepEqual(afterIssue[field], beforeIssue[field], `field '${field}' of ${beforeIssue.id} must be untouched`);
      }
      // validation is the one exception, and only in one direction: an issue that HAS a validation
      // object gains validation.tasks: []. Its criteria and state must come through untouched, and
      // a null validation must not grow an object to hold tasks it does not have.
      if (beforeIssue.validation === null) {
        assert.equal(afterIssue.validation, null, "a null validation must stay null");
      } else {
        assert.deepEqual(afterIssue.validation, { ...beforeIssue.validation, tasks: [] });
      }

      // No key present before is missing after, and no key absent before was invented besides
      // the three the migrations materialize.
      const beforeKeys = new Set([...Object.keys(beforeIssue), "depends_on", "covers", "tasks"]);
      assert.deepEqual(new Set(Object.keys(afterIssue)), beforeKeys);
    }
  } finally {
    cleanup(dir);
  }
});

test("(c) a second --upgrade in a row reports ok:true, migrated:0, and leaves the file byte-for-byte identical", () => {
  const { dir } = setupTempProject(upgradeSeed());
  try {
    assertOk(run(dir, ["--upgrade"])); // first upgrade: 0 -> SCHEMA_VERSION, writes the file

    const issuesPath = path.join(dir, "issues.json");
    const beforeSecondRun = readFileSync(issuesPath); // Buffer, not string: compare raw bytes

    const data = assertOk(run(dir, ["--upgrade"]));
    assert.deepEqual(data, { from: SCHEMA_VERSION, to: SCHEMA_VERSION, migrated: 0 });

    const afterSecondRun = readFileSync(issuesPath);
    assert.ok(
      beforeSecondRun.equals(afterSecondRun),
      "an --upgrade on a tracker already at SCHEMA_VERSION must not rewrite the file at all"
    );
  } finally {
    cleanup(dir);
  }
});

test("SCHEMA_TOO_NEW: --upgrade on a file with schema_version above SCHEMA_VERSION exits 1 and writes nothing", () => {
  const { dir } = setupTempProject(seedWithSchemaVersion(SCHEMA_VERSION + 1));
  try {
    const issuesPath = path.join(dir, "issues.json");
    const before = readFileSync(issuesPath); // Buffer, not string: compare raw bytes

    const result = run(dir, ["--upgrade"]);
    assertFail(result, "SCHEMA_TOO_NEW");

    const after = readFileSync(issuesPath);
    assert.ok(before.equals(after), "a tracker newer than this script must be left untouched byte for byte");
  } finally {
    cleanup(dir);
  }
});

test("--upgrade on a tracker already at SCHEMA_VERSION (from a fresh --init) is a same-run no-op", () => {
  const { dir } = setupTempProject(null);
  try {
    assertOk(run(dir, ["--init"]));
    const issuesPath = path.join(dir, "issues.json");
    const before = readFileSync(issuesPath);

    const data = assertOk(run(dir, ["--upgrade"]));
    assert.deepEqual(data, { from: SCHEMA_VERSION, to: SCHEMA_VERSION, migrated: 0 });

    const after = readFileSync(issuesPath);
    assert.ok(before.equals(after), "a tracker seeded by --init is already current and must not be rewritten");
  } finally {
    cleanup(dir);
  }
});

test("--upgrade respects --project-dir", () => {
  const target = setupTempProject(upgradeSeed());
  const elsewhere = setupTempProject(null);
  try {
    const result = runFrom(elsewhere.dir, ["--upgrade", "--project-dir", target.dir]);
    const data = assertOk(result);
    assert.deepEqual(data, { from: 0, to: SCHEMA_VERSION, migrated: 3 });
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

test("neither --insert nor --update runs a migration: a file without schema_version stays without it", () => {
  const { dir } = setupTempProject(upgradeSeed());
  try {
    assertOk(run(dir, ["--insert", "--issue-data", JSON.stringify({ title: "T", description: "D", status: "backlog" })]));
    assertOk(run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", JSON.stringify({ status: "in_progress" })]));
    assert.ok(
      !("schema_version" in rootData(dir)),
      "--insert/--update must never stamp schema_version onto a file that never had it"
    );
  } finally {
    cleanup(dir);
  }
});

test("--help lists --upgrade and SCHEMA_TOO_NEW", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--upgrade/);
    assert.match(result.stdout, /SCHEMA_TOO_NEW/);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// --compact — archives the closed issues named by the caller into
// .harness/archive/<timestamp>.json and replaces them with one done/pass issue per block.
//
// It is a primitive: it groups nothing on its own, the blocks arrive already decided. Every test
// here runs on a throwaway project directory, never on the tracker of this repository.
// ---------------------------------------------------------------------------

const ARCHIVE_SUBPATH = path.join(".harness", "archive");

// Two closed issues to archive and one live one to leave behind.
//
// ID_ONE is deliberately a LEGACY record — no `tier`, no `depends_on`, plus a `legacy_note` key
// this script has never heard of — so the archive can be checked for storing the originals WHOLE
// rather than whatever shape today's script would rebuild.
function compactSeed() {
  const seed = baseSeed();
  seed.schema_version = SCHEMA_VERSION;

  const one = seed.issues.find((i) => i.id === ID_ONE);
  one.status = "done";
  one.validation = { criteria: "evidence for one", state: "pass" };
  one.legacy_note = "written before half these fields existed";

  const two = seed.issues.find((i) => i.id === ID_TWO);
  two.status = "done";
  two.tier = "economy";
  two.depends_on = [ID_ONE];
  two.validation = { criteria: ["evidence for two"], state: "pass" };

  const three = seed.issues.find((i) => i.id === ID_THREE);
  three.status = "backlog";
  three.depends_on = [];

  return seed;
}

function oneBlock(issueIds, overrides = {}) {
  return JSON.stringify({
    blocks: [
      {
        title: "Board e dipendenze",
        description: "Le issue chiuse su board server e card delle dipendenze.",
        issue_ids: issueIds,
        ...overrides,
      },
    ],
  });
}

function archiveFiles(dir) {
  const archiveDir = path.join(dir, ARCHIVE_SUBPATH);
  return existsSync(archiveDir) ? readdirSync(archiveDir) : [];
}

// The whole point of a refusal: the tracker is untouched byte for byte AND no archive was even
// started. `.harness/` must not exist at all, not merely be empty.
function assertNothingWritten(dir, before) {
  const after = readFileSync(path.join(dir, "issues.json"));
  assert.ok(before.equals(after), "issues.json must be untouched byte for byte on a refusal");
  assert.equal(
    existsSync(path.join(dir, ".harness")),
    false,
    "a refused --compact must not create .harness/ either"
  );
}

test("--compact archives a block of done issues: they leave issues.json, a done/pass block takes their place", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    const data = assertOk(run(dir, ["--compact", "--issue-data", oneBlock([ID_ONE, ID_TWO])]));

    assert.equal(data.removed, 2);
    assert.equal(data.blocks.length, 1);
    assert.match(data.blocks[0].id, GUID_RE);
    assert.equal(data.blocks[0].title, "Board e dipendenze");
    assert.equal(data.blocks[0].archivedCount, 2);
    assert.equal(typeof data.archivePath, "string");
    assert.ok(data.archivePath.endsWith(".json"));

    const stored = storedIssues(dir);
    assert.equal(stored.length, 2, "two archived issues out, one block issue in");
    assert.equal(stored.find((i) => i.id === ID_ONE), undefined);
    assert.equal(stored.find((i) => i.id === ID_TWO), undefined);
    assert.ok(stored.find((i) => i.id === ID_THREE), "the live issue must stay");

    const block = stored.find((i) => i.id === data.blocks[0].id);
    assert.ok(block, "the block issue must be stored");
    assert.equal(block.title, "Board e dipendenze");
    assert.equal(block.description, "Le issue chiuse su board server e card delle dipendenze.");
    assert.equal(block.status, "done");
    assert.equal(block.validation.state, "pass");
    assert.deepEqual(block.depends_on, [], "a block summarises history, it depends on nothing");
    assert.equal(block.tier, null);
    assert.equal(typeof block.created_at, "string");
    assert.equal(typeof block.updated_at, "string");
  } finally {
    cleanup(dir);
  }
});

test("--compact writes the ORIGINAL issue objects, whole, into .harness/archive/<timestamp>.json with the tracker's schema_version", () => {
  const { dir } = setupTempProject(compactSeed());
  const before = compactSeed().issues;
  try {
    const data = assertOk(run(dir, ["--compact", "--issue-data", oneBlock([ID_ONE, ID_TWO])]));

    const files = archiveFiles(dir);
    assert.equal(files.length, 1, "exactly one archive file per --compact run");
    assert.equal(path.basename(data.archivePath), files[0], "data.archivePath must name the file written");
    // A colon cannot appear in a Windows filename, so the timestamp is stamped with dashes.
    assert.match(files[0], /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(-\d+)?\.json$/);

    const archive = JSON.parse(readFileSync(path.join(dir, ARCHIVE_SUBPATH, files[0]), "utf8"));
    assert.equal(archive.schema_version, SCHEMA_VERSION, "the archive self-describes the schema it was written under");
    assert.equal(typeof archive.archived_at, "string");
    assert.equal(archive.issues.length, 2);

    for (const id of [ID_ONE, ID_TWO]) {
      const original = before.find((i) => i.id === id);
      const archived = archive.issues.find((i) => i.id === id);
      assert.deepEqual(archived, original, `issue ${id} must be archived exactly as it was stored`);
      assert.deepEqual(
        new Set(Object.keys(archived)),
        new Set(Object.keys(original)),
        `no key of ${id} may be invented or dropped by the archiver`
      );
    }
    // The legacy record is the proof: a field this script knows nothing about survives untouched.
    assert.equal(
      archive.issues.find((i) => i.id === ID_ONE).legacy_note,
      "written before half these fields existed"
    );
    assert.ok(
      !("depends_on" in archive.issues.find((i) => i.id === ID_ONE)),
      "the archiver must not normalise a legacy issue on its way in"
    );
  } finally {
    cleanup(dir);
  }
});

test("--compact records the archive path and the id + title of every covered issue in the block's criteria", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    const data = assertOk(run(dir, ["--compact", "--issue-data", oneBlock([ID_ONE, ID_TWO])]));
    const block = storedIssues(dir).find((i) => i.id === data.blocks[0].id);
    const criteria = block.validation.criteria;

    assert.ok(Array.isArray(criteria), "the evidence is a bullet list, one line per covered issue plus the path");
    assert.equal(criteria.length, 3);

    const archiveFile = archiveFiles(dir)[0];
    // Project-relative, with forward slashes: issues.json is shared through the repository, and an
    // absolute path from one clone means nothing in another.
    assert.ok(
      criteria.some((c) => c.includes(`.harness/archive/${archiveFile}`)),
      `criteria must carry the archive path, got: ${JSON.stringify(criteria)}`
    );
    assert.ok(criteria.some((c) => c.includes(ID_ONE) && c.includes("Issue One")));
    assert.ok(criteria.some((c) => c.includes(ID_TWO) && c.includes("Issue Two")));
  } finally {
    cleanup(dir);
  }
});

test("--compact accepts several blocks at once and keeps each one's ids apart", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    const payload = JSON.stringify({
      blocks: [
        { title: "Primo blocco", description: "La prima issue.", issue_ids: [ID_ONE] },
        { title: "Secondo blocco", description: "La seconda issue.", issue_ids: [ID_TWO] },
      ],
    });
    const data = assertOk(run(dir, ["--compact", "--issue-data", payload]));

    assert.equal(data.removed, 2);
    assert.deepEqual(
      data.blocks.map((b) => [b.title, b.archivedCount]),
      [["Primo blocco", 1], ["Secondo blocco", 1]]
    );

    const stored = storedIssues(dir);
    assert.equal(stored.length, 3, "one live issue plus two block issues");
    const first = stored.find((i) => i.id === data.blocks[0].id);
    const second = stored.find((i) => i.id === data.blocks[1].id);
    assert.ok(first.validation.criteria.some((c) => c.includes(ID_ONE)));
    assert.ok(!first.validation.criteria.some((c) => c.includes(ID_TWO)));
    assert.ok(second.validation.criteria.some((c) => c.includes(ID_TWO)));
    assert.ok(!second.validation.criteria.some((c) => c.includes(ID_ONE)));

    // Both blocks of one run share one archive file: a compaction is a single event.
    assert.equal(archiveFiles(dir).length, 1);
    assert.equal(JSON.parse(readFileSync(path.join(dir, ARCHIVE_SUBPATH, archiveFiles(dir)[0]), "utf8")).issues.length, 2);
  } finally {
    cleanup(dir);
  }
});

test("the archive is never read back: --get on an archived id is NOT_FOUND and --get-all only sees issues.json", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    const data = assertOk(run(dir, ["--compact", "--issue-data", oneBlock([ID_ONE, ID_TWO])]));

    assertFail(run(dir, ["--get", "--issue-id", ID_ONE]), "NOT_FOUND");
    assertFail(run(dir, ["--get", "--issue-id", ID_TWO]), "NOT_FOUND");

    const done = assertOk(run(dir, ["--get-all", "--status", "done"]));
    assert.equal(done.totalCount, 1, "only the block issue is done now");
    assert.equal(done.issues[0].id, data.blocks[0].id);
  } finally {
    cleanup(dir);
  }
});

test("--compact writes no .gitignore: whether the archive is committed is the project's call", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    // ID_TWO, not ID_ONE: nothing points at ID_TWO, so a single-issue block is enough here.
    assertOk(run(dir, ["--compact", "--issue-data", oneBlock([ID_TWO])]));
    assert.equal(
      existsSync(path.join(dir, ".harness", ".gitignore")),
      false,
      "issues.json is shared and names the archive: hiding it would leave a pointer to nothing"
    );
  } finally {
    cleanup(dir);
  }
});

test("--compact preserves a tracker without schema_version and archives it as version 0", () => {
  const seed = compactSeed();
  delete seed.schema_version;
  const { dir } = setupTempProject(seed);
  try {
    assertOk(run(dir, ["--compact", "--issue-data", oneBlock([ID_TWO])]));
    assert.ok(
      !("schema_version" in rootData(dir)),
      "--compact must not stamp schema_version onto a file that never had it"
    );
    const archive = JSON.parse(readFileSync(path.join(dir, ARCHIVE_SUBPATH, archiveFiles(dir)[0]), "utf8"));
    assert.equal(archive.schema_version, 0, "an absent key reads as version 0, and the archive says so");
  } finally {
    cleanup(dir);
  }
});

test("INVALID_DEPENDENCY: --compact is refused, listing the ids that point, while a live issue depends on one being archived", () => {
  const seed = compactSeed();
  seed.issues.find((i) => i.id === ID_THREE).depends_on = [ID_ONE];
  const { dir } = setupTempProject(seed);
  try {
    const before = readFileSync(path.join(dir, "issues.json")); // Buffer, not string: compare raw bytes
    const failure = assertFail(run(dir, ["--compact", "--issue-data", oneBlock([ID_ONE, ID_TWO])]), "INVALID_DEPENDENCY");

    assert.ok(failure.error.includes(ID_THREE), "the message must name the live issue that points");
    assert.ok(failure.error.includes(ID_ONE), "the message must name the archived id it points at");

    assertNothingWritten(dir, before);
  } finally {
    cleanup(dir);
  }
});

test("a dependency between two issues archived in the same run is not an obstacle: only live pointers are", () => {
  // ID_TWO depends on ID_ONE in compactSeed(); archiving both together leaves nothing dangling.
  const { dir } = setupTempProject(compactSeed());
  try {
    const data = assertOk(run(dir, ["--compact", "--issue-data", oneBlock([ID_ONE, ID_TWO])]));
    assert.equal(data.removed, 2);
  } finally {
    cleanup(dir);
  }
});

test("NOT_FOUND: --compact with an id that is not in the tracker writes nothing", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    const before = readFileSync(path.join(dir, "issues.json"));
    assertFail(run(dir, ["--compact", "--issue-data", oneBlock([ID_ONE, UNKNOWN_GUID])]), "NOT_FOUND");
    assertNothingWritten(dir, before);
  } finally {
    cleanup(dir);
  }
});

test("INVALID_STATUS: --compact with an issue that is not done writes nothing", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    const before = readFileSync(path.join(dir, "issues.json"));
    const failure = assertFail(run(dir, ["--compact", "--issue-data", oneBlock([ID_ONE, ID_THREE])]), "INVALID_STATUS");
    assert.ok(failure.error.includes(ID_THREE));
    assertNothingWritten(dir, before);
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: --compact with the same id in two blocks writes nothing", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    const before = readFileSync(path.join(dir, "issues.json"));
    const payload = JSON.stringify({
      blocks: [
        { title: "Primo blocco", description: "La prima issue.", issue_ids: [ID_ONE, ID_TWO] },
        { title: "Secondo blocco", description: "Di nuovo la prima.", issue_ids: [ID_ONE] },
      ],
    });
    const failure = assertFail(run(dir, ["--compact", "--issue-data", payload]), "INVALID_INPUT");
    assert.ok(failure.error.includes(ID_ONE), "the message must name the id claimed twice");
    assertNothingWritten(dir, before);
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: --compact with an empty block, or no blocks at all, writes nothing", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    const before = readFileSync(path.join(dir, "issues.json"));
    const payloads = [
      // an empty block: it would archive nothing and still write a done record
      JSON.stringify({
        blocks: [
          { title: "Primo blocco", description: "La prima issue.", issue_ids: [ID_ONE] },
          { title: "Blocco vuoto", description: "Non copre niente.", issue_ids: [] },
        ],
      }),
      JSON.stringify({ blocks: [] }),
      JSON.stringify({ blocks: "nope" }),
      JSON.stringify({}),
      JSON.stringify({ blocks: [{ title: "B", description: "d", issue_ids: [ID_ONE] }], extra: 1 }),
      JSON.stringify({ blocks: [{ title: "B", description: "d", issue_ids: [ID_ONE], status: "done" }] }),
      oneBlock([ID_ONE], { title: "   " }),
      oneBlock([ID_ONE], { description: "" }),
    ];
    for (const payload of payloads) {
      assertFail(run(dir, ["--compact", "--issue-data", payload]), "INVALID_INPUT");
    }
    assertNothingWritten(dir, before);
  } finally {
    cleanup(dir);
  }
});

test("INVALID_ID / INVALID_JSON: a malformed id or payload is refused before anything is written", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    const before = readFileSync(path.join(dir, "issues.json"));
    assertFail(run(dir, ["--compact", "--issue-data", oneBlock(["not-a-guid"])]), "INVALID_ID");
    assertFail(run(dir, ["--compact", "--issue-data", "{not json"]), "INVALID_JSON");
    assertNothingWritten(dir, before);
  } finally {
    cleanup(dir);
  }
});

test("LIMIT_EXCEEDED: a block title or description over the usual limits writes nothing", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    const before = readFileSync(path.join(dir, "issues.json"));
    assertFail(run(dir, ["--compact", "--issue-data", oneBlock([ID_ONE], { title: "T".repeat(81) })]), "LIMIT_EXCEEDED");
    assertFail(
      run(dir, ["--compact", "--issue-data", oneBlock([ID_ONE], { description: "D".repeat(1201) })]),
      "LIMIT_EXCEEDED"
    );
    assertNothingWritten(dir, before);
  } finally {
    cleanup(dir);
  }
});

test("MISSING_ARGS: --compact without a payload", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    const before = readFileSync(path.join(dir, "issues.json"));
    assertFail(run(dir, ["--compact"]), "MISSING_ARGS");
    assertNothingWritten(dir, before);
  } finally {
    cleanup(dir);
  }
});

test("FORBIDDEN_ROLE: a worker cannot --compact, and nothing is written", () => {
  const { dir } = setupTempProject(compactSeed());
  try {
    const before = readFileSync(path.join(dir, "issues.json"));
    assertFail(
      runWithRole(dir, ["--compact", "--issue-data", oneBlock([ID_ONE, ID_TWO])], "worker"),
      "FORBIDDEN_ROLE"
    );
    assertNothingWritten(dir, before);
  } finally {
    cleanup(dir);
  }
});

test("--compact respects --project-dir", () => {
  const target = setupTempProject(compactSeed());
  const elsewhere = setupTempProject(null);
  try {
    const data = assertOk(
      runFrom(elsewhere.dir, ["--compact", "--project-dir", target.dir, "--issue-data", oneBlock([ID_TWO])])
    );
    assert.equal(data.removed, 1);
    assert.equal(archiveFiles(target.dir).length, 1);
    assert.equal(
      existsSync(path.join(elsewhere.dir, ".harness")),
      false,
      "the cwd must be left alone when --project-dir is given"
    );
    assert.equal(existsSync(path.join(elsewhere.dir, "issues.json")), false);
  } finally {
    cleanup(target.dir);
    cleanup(elsewhere.dir);
  }
});

test("--help lists --compact and the shape of its payload", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--compact/);
    assert.match(result.stdout, /issue_ids/);
    assert.match(result.stdout, /archivePath/);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// covers — the git revisions an issue declares it covers. General, not docs-specific: the gate
// only asks that SOMEBODY names a revision.
// ---------------------------------------------------------------------------

test("--insert accepts covers and stores it verbatim", () => {
  const { dir } = setupTempProject();
  try {
    const data = assertOk(
      run(dir, [
        "--insert",
        "--issue-data",
        JSON.stringify({
          title: "Docs for the parser",
          description: "Desc",
          status: "backlog",
          covers: ["a1b2c3d", "v1.2.0"],
        }),
      ])
    );
    assert.deepEqual(data.covers, ["a1b2c3d", "v1.2.0"]);
    assert.deepEqual(assertOk(run(dir, ["--get", "--issue-id", data.id])).covers, [
      "a1b2c3d",
      "v1.2.0",
    ]);
  } finally {
    cleanup(dir);
  }
});

test("covers absent at --insert is stored as [], never as a missing key", () => {
  const { dir } = setupTempProject();
  try {
    const data = assertOk(
      run(dir, [
        "--insert",
        "--issue-data",
        JSON.stringify({ title: "T", description: "D", status: "backlog" }),
      ])
    );
    assert.deepEqual(data.covers, [], "an absent covers must materialize as an empty array");
  } finally {
    cleanup(dir);
  }
});

test("covers rejects null, a non-array, an empty entry and a duplicate", () => {
  const { dir } = setupTempProject();
  const base = { title: "T", description: "D", status: "backlog" };
  try {
    // null is refused for depends_on's reason: "nothing" already has one spelling, [], and a
    // second one would make every reader guess which of the two is stored.
    assertFail(
      run(dir, ["--insert", "--issue-data", JSON.stringify({ ...base, covers: null })]),
      "INVALID_INPUT"
    );
    assertFail(
      run(dir, ["--insert", "--issue-data", JSON.stringify({ ...base, covers: "a1b2c3d" })]),
      "INVALID_INPUT"
    );
    assertFail(
      run(dir, ["--insert", "--issue-data", JSON.stringify({ ...base, covers: ["   "] })]),
      "INVALID_INPUT"
    );
    assertFail(
      run(dir, ["--insert", "--issue-data", JSON.stringify({ ...base, covers: ["a1b2c3d", "a1b2c3d"] })]),
      "INVALID_INPUT"
    );
  } finally {
    cleanup(dir);
  }
});

test("covers validation stays loose: a tag, a branch and a long sha are all accepted", () => {
  // Harness is not a git library. A reference that means nothing simply fails to resolve, and
  // docs-gate reports it; a strict check here would refuse legitimate tags and symbolic refs to
  // defend against a mistake that shows up anyway.
  const { dir } = setupTempProject();
  try {
    const data = assertOk(
      run(dir, [
        "--insert",
        "--issue-data",
        JSON.stringify({
          title: "T",
          description: "D",
          status: "backlog",
          covers: ["v2.0.0", "origin/main", "0123456789abcdef0123456789abcdef01234567"],
        }),
      ])
    );
    assert.equal(data.covers.length, 3);
  } finally {
    cleanup(dir);
  }
});

test("--update merges covers: omitted keeps it, [] clears it, a new array replaces it", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      run(dir, [
        "--insert",
        "--issue-data",
        JSON.stringify({ title: "T", description: "D", status: "backlog", covers: ["a1b2c3d"] }),
      ])
    );

    const untouched = assertOk(
      run(dir, ["--update", "--issue-id", created.id, "--issue-data", JSON.stringify({ status: "in_progress" })])
    );
    assert.deepEqual(untouched.covers, ["a1b2c3d"], "an update that omits covers must keep it");

    const replaced = assertOk(
      run(dir, ["--update", "--issue-id", created.id, "--issue-data", JSON.stringify({ covers: ["ffffff1"] })])
    );
    assert.deepEqual(replaced.covers, ["ffffff1"]);

    const cleared = assertOk(
      run(dir, ["--update", "--issue-id", created.id, "--issue-data", JSON.stringify({ covers: [] })])
    );
    assert.deepEqual(cleared.covers, []);
  } finally {
    cleanup(dir);
  }
});

test("an issue written before covers existed stays readable, and the first --update materializes it", () => {
  // Same promise tier and depends_on already made: a new field never invalidates data written
  // before it existed, and no --upgrade is required to keep working.
  const { dir } = setupTempProject();
  try {
    assert.ok(!("covers" in storedIssues(dir).find((i) => i.id === ID_ONE)));
    const updated = assertOk(
      run(dir, ["--update", "--issue-id", ID_ONE, "--issue-data", JSON.stringify({ status: "in_progress" })])
    );
    assert.deepEqual(updated.covers, []);
  } finally {
    cleanup(dir);
  }
});

test("--compact writes covers: [] on the block and preserves it on the archived originals", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      run(dir, [
        "--insert",
        "--issue-data",
        JSON.stringify({
          title: "Closed work",
          description: "D",
          status: "done",
          covers: ["a1b2c3d"],
        }),
      ])
    );

    const data = assertOk(
      run(dir, [
        "--compact",
        "--issue-data",
        JSON.stringify({
          blocks: [{ title: "Block", description: "Summary", issue_ids: [created.id] }],
        }),
      ])
    );

    const block = storedIssues(dir).find((i) => i.id === data.blocks[0].id);
    assert.deepEqual(block.covers, [], "a block covers no revision of its own");

    const archived = JSON.parse(readFileSync(data.archivePath, "utf8")).issues[0];
    assert.deepEqual(
      archived.covers,
      ["a1b2c3d"],
      "the archive stores the originals whole: dropping covers would rewrite history"
    );
  } finally {
    cleanup(dir);
  }
});

test("--help lists covers among the accepted input fields", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /covers/);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// tasks and validation.tasks — the decomposition of the prose at the grain the agent works on.
// description and validation.criteria stay prose; these two arrays are the same thing at the
// other grain, which is what turns freezing the work into a by-product of doing it.
// ---------------------------------------------------------------------------

function task(id, overrides = {}) {
  return {
    id,
    short_title: `Task ${id}`,
    full_description: `Run the command and check the output for task ${id}`,
    checked: false,
    ...overrides,
  };
}

function insertWith(dir, payload) {
  return run(dir, [
    "--insert",
    "--issue-data",
    JSON.stringify({ title: "T", description: "D", status: "backlog", ...payload }),
  ]);
}

test("--insert stores tasks verbatim and reads them back", () => {
  const { dir } = setupTempProject();
  try {
    const data = assertOk(insertWith(dir, { tasks: [task(1), task(2, { checked: true })] }));
    assert.equal(data.tasks.length, 2);
    assert.deepEqual(data.tasks[0], task(1));
    assert.equal(data.tasks[1].checked, true);
    assert.deepEqual(assertOk(run(dir, ["--get", "--issue-id", data.id])).tasks, data.tasks);
  } finally {
    cleanup(dir);
  }
});

test("tasks absent at --insert is stored as [], never as a missing key", () => {
  const { dir } = setupTempProject();
  try {
    const data = assertOk(insertWith(dir, {}));
    assert.deepEqual(data.tasks, []);
    assert.ok("tasks" in data, "an absent tasks must materialize as an empty array");
  } finally {
    cleanup(dir);
  }
});

test("validation.tasks lives inside validation and materializes to []", () => {
  const { dir } = setupTempProject();
  try {
    const plain = assertOk(
      insertWith(dir, { validation: { criteria: ["the command exits 0"], state: "unknown" } })
    );
    assert.deepEqual(plain.validation.tasks, []);

    const withTasks = assertOk(
      insertWith(dir, {
        validation: { criteria: ["the command exits 0"], tasks: [task(1)], state: "unknown" },
      })
    );
    assert.deepEqual(withTasks.validation.tasks, [task(1)]);
  } finally {
    cleanup(dir);
  }
});

test("a null validation stays null: no tasks are invented for it", () => {
  const { dir } = setupTempProject();
  try {
    assert.equal(assertOk(insertWith(dir, { validation: null })).validation, null);
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: a task id must be a unique positive integer", () => {
  const { dir } = setupTempProject();
  try {
    assertFail(insertWith(dir, { tasks: [task("1")] }), "INVALID_INPUT");
    assertFail(insertWith(dir, { tasks: [task(1.5)] }), "INVALID_INPUT");
    assertFail(insertWith(dir, { tasks: [task(0)] }), "INVALID_INPUT");
    assertFail(insertWith(dir, { tasks: [task(1), task(1)] }), "INVALID_INPUT");
  } finally {
    cleanup(dir);
  }
});

test("INVALID_INPUT: every task field is required, checked is a boolean, no extra fields", () => {
  const { dir } = setupTempProject();
  try {
    const { checked, ...noChecked } = task(1);
    assertFail(insertWith(dir, { tasks: [noChecked] }), "INVALID_INPUT");
    assertFail(insertWith(dir, { tasks: [task(1, { checked: "yes" })] }), "INVALID_INPUT");
    assertFail(insertWith(dir, { tasks: [task(1, { short_title: "  " })] }), "INVALID_INPUT");
    assertFail(insertWith(dir, { tasks: [task(1, { full_description: "" })] }), "INVALID_INPUT");
    assertFail(insertWith(dir, { tasks: [{ ...task(1), owner: "me" }] }), "INVALID_INPUT");
    assertFail(insertWith(dir, { tasks: "one, two" }), "INVALID_INPUT");
    assertFail(insertWith(dir, { tasks: null }), "INVALID_INPUT");
    assertFail(
      insertWith(dir, {
        validation: { criteria: ["c"], tasks: [task(1, { checked: 1 })], state: "unknown" },
      }),
      "INVALID_INPUT"
    );
  } finally {
    cleanup(dir);
  }
});

test("the message for an unknown validation field names every field that is allowed", () => {
  const { dir } = setupTempProject();
  try {
    const parsed = assertFail(
      insertWith(dir, { validation: { criteria: ["c"], state: "unknown", owner: "me" } }),
      "INVALID_INPUT"
    );
    // A hardcoded list goes stale the moment a field is added, and an error message that lies
    // about what is accepted costs the caller the one thing the message exists to give.
    assert.match(parsed.error, /Allowed fields: criteria, state, tasks/);
  } finally {
    cleanup(dir);
  }
});

test("LIMIT_EXCEEDED: short_title over 60 characters, full_description over 1200", () => {
  const { dir } = setupTempProject();
  try {
    assertFail(insertWith(dir, { tasks: [task(1, { short_title: "x".repeat(61) })] }), "LIMIT_EXCEEDED");
    assertFail(
      insertWith(dir, { tasks: [task(1, { full_description: "x".repeat(1201) })] }),
      "LIMIT_EXCEEDED"
    );
    // The number of tasks is deliberately uncapped: a limit would push a caller to merge real
    // steps to make the payload fit, exactly as it would with depends_on.
    const many = Array.from({ length: 40 }, (_, i) => task(i + 1));
    assert.equal(assertOk(insertWith(dir, { tasks: many })).tasks.length, 40);
  } finally {
    cleanup(dir);
  }
});

test("--update carries validation.tasks over when the payload does not name them", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      insertWith(dir, {
        status: "in_review",
        tasks: [task(1, { checked: true })],
        validation: { criteria: ["the command exits 0"], tasks: [task(1)], state: "unknown" },
      })
    );
    const closed = assertOk(
      run(dir, [
        "--update",
        "--issue-id",
        created.id,
        "--issue-data",
        JSON.stringify({
          status: "done",
          validation: { criteria: "npm test: 88 passing", state: "pass" },
        }),
      ])
    );
    assert.deepEqual(
      closed.validation.tasks,
      [task(1)],
      "closing an issue must not delete the checklist it was judged against"
    );
    assert.equal(closed.validation.state, "pass");
    assert.deepEqual(closed.tasks, [task(1, { checked: true })]);
  } finally {
    cleanup(dir);
  }
});

test("an explicit empty array clears the validation tasks", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      insertWith(dir, {
        validation: { criteria: ["the command exits 0"], tasks: [task(1)], state: "unknown" },
      })
    );
    const updated = assertOk(
      run(dir, [
        "--update",
        "--issue-id",
        created.id,
        "--issue-data",
        JSON.stringify({
          validation: { criteria: ["the command exits 0"], tasks: [], state: "unknown" },
        }),
      ])
    );
    assert.deepEqual(updated.validation.tasks, []);
  } finally {
    cleanup(dir);
  }
});

test("an issue stored before the fields gets them on the first --update, not a missing key", () => {
  const { dir } = setupTempProject();
  try {
    // ID_TWO in the base seed predates both arrays and carries a string criteria.
    const updated = assertOk(
      run(dir, ["--update", "--issue-id", ID_TWO, "--issue-data", JSON.stringify({ status: "blocked" })])
    );
    assert.deepEqual(updated.tasks, []);
    assert.deepEqual(updated.validation.tasks, []);
    assert.equal(updated.validation.criteria, "criteria two", "the prose must survive untouched");
  } finally {
    cleanup(dir);
  }
});

test("(d) 2 -> 3 materializes tasks and validation.tasks, and creates no validation where there was none", () => {
  const seed = {
    schema_version: 2,
    last_updated: "1970-01-01T00:00:00Z",
    issues: [
      {
        id: ID_ONE,
        title: "No validation",
        description: "D",
        status: "backlog",
        tier: null,
        depends_on: [],
        covers: [],
        validation: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: ID_TWO,
        title: "With validation",
        description: "D",
        status: "in_review",
        tier: null,
        depends_on: [],
        covers: [],
        validation: { criteria: ["the command exits 0"], state: "unknown" },
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
    ],
  };
  const { dir } = setupTempProject(seed);
  try {
    const data = assertOk(run(dir, ["--upgrade"]));
    assert.deepEqual(data, { from: 2, to: 3, migrated: 2 });

    const [first, second] = storedIssues(dir);
    assert.deepEqual(first.tasks, []);
    assert.equal(first.validation, null, "a null validation must not grow a tasks array");
    assert.deepEqual(second.tasks, []);
    assert.deepEqual(second.validation.tasks, []);
    assert.deepEqual(second.validation.criteria, ["the command exits 0"]);
    assert.equal(second.validation.state, "unknown");

    // Idempotent down to the bytes, like every migration before it.
    const bytes = readFileSync(path.join(dir, "issues.json"), "utf8");
    assert.equal(assertOk(run(dir, ["--upgrade"])).migrated, 0);
    assert.equal(readFileSync(path.join(dir, "issues.json"), "utf8"), bytes);
  } finally {
    cleanup(dir);
  }
});

test("--compact archives the originals with their tasks and writes empty ones on the block", () => {
  const { dir } = setupTempProject();
  try {
    const created = assertOk(
      insertWith(dir, {
        status: "done",
        tasks: [task(1, { checked: true })],
        validation: { criteria: ["the command exits 0"], tasks: [task(1, { checked: true })], state: "pass" },
      })
    );

    const data = assertOk(
      run(dir, [
        "--compact",
        "--issue-data",
        JSON.stringify({
          blocks: [{ title: "Block", description: "One closed issue", issue_ids: [created.id] }],
        }),
      ])
    );

    const archived = JSON.parse(readFileSync(data.archivePath, "utf8")).issues[0];
    assert.deepEqual(archived.tasks, [task(1, { checked: true })]);
    assert.deepEqual(archived.validation.tasks, [task(1, { checked: true })]);

    const block = storedIssues(dir).find((i) => i.id === data.blocks[0].id);
    assert.deepEqual(block.tasks, [], "a block has nothing left to execute");
    assert.deepEqual(block.validation.tasks, [], "and nothing left to judge");
  } finally {
    cleanup(dir);
  }
});

test("--help documents tasks and the 2 -> 3 migration", () => {
  const { dir } = setupTempProject();
  try {
    const result = run(dir, ["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /tasks/);
    assert.match(result.stdout, /2->3/);
  } finally {
    cleanup(dir);
  }
});
