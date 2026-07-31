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
    assert.deepEqual(data.validation, { criteria: ["x"], state: "unknown" });
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
