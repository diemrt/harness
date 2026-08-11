#!/usr/bin/env node
// Issue tracker CLI shipped inside the harness plugin. Used by agents to get, insert, update and
// delete the issues of the project they are working on.
//
// The script lives in the plugin, the data lives in the project: issues.json is resolved against
// the project directory (the process cwd by default, or --project-dir), never against the location
// of this file. That is what lets a single installed copy serve every project without being
// copied into any of them.
//
// Example usage:
// node issue-manager.mjs --help
// node issue-manager.mjs --get --issue-id <issueId>
// node issue-manager.mjs --get-all --order desc --page 0 --page-size 10 --status backlog
// node issue-manager.mjs --insert --issue-data-file ./new-issue.json
// node issue-manager.mjs --update --issue-id <issueId> --issue-data '<json>'
// node issue-manager.mjs --delete --issue-id <issueId>
// node issue-manager.mjs --get-all --project-dir /path/to/project
// node issue-manager.mjs --init
// node issue-manager.mjs --compact --issue-data-file ./blocks.json

// Machine-readable contract (stdout is always a single line of JSON):
//   success -> {"ok":true,"data":<payload>}                      exit code 0
//   failure -> {"ok":false,"error":"<message>","code":"<CODE>"}  exit code 1
// Nothing is ever written to stderr, so `script | ConvertFrom-Json`/`JSON.parse` works for both
// outcomes.
// Exception: --help prints plain text.
//
// Error codes: INVALID_ID, INVALID_STATUS, INVALID_STATE, INVALID_TIER, INVALID_DEPENDENCY,
//              INVALID_INPUT, INVALID_JSON, LIMIT_EXCEEDED, NOT_FOUND, FILE_NOT_FOUND,
//              MISSING_ARGS, UNKNOWN_COMMAND, FORBIDDEN_ROLE, ALREADY_EXISTS, SCHEMA_TOO_NEW.
//
// Length limits: title and description are capped (see LIMITS) so an issue stays readable by a
// human instead of turning into an untitled document. Over the cap the payload is rejected with
// LIMIT_EXCEEDED, kept distinct from INVALID_INPUT on purpose: a shape violation is fixed by
// correcting the payload, a limit violation by splitting the text or pointing at a document.
//
// Role guard: when the HARNESS_ROLE environment variable is set to "worker", a worker process
// cannot self-validate its own work. Any --insert/--update payload that sets
// validation.state === "pass" or status === "done" is rejected with FORBIDDEN_ROLE. A worker may
// still move status up to "in_review" and validation.state up to "unknown". --compact is refused
// outright under that role, because every block it writes is a done/pass record. Any other/unset
// HARNESS_ROLE leaves behavior unchanged.

// Every issue in the issues.json file should have the following structure:
// {
//     "id": "<guid>",
//     "title": "<string>",
//     "description": "<string>",
//     "status": "<backlog|in_progress|in_review|blocked|done>",
//     "tier": "<economy|standard|reasoning>"|null,
//     "depends_on": ["<guid>"],
//     "covers": ["<git-ref>"],
//     "validation": { "criteria": ["<string>"], "state": "<unknown|pass|fail>" }|null,
//     "created_at": "<datetime>",
//     "updated_at": "<datetime>"
// }
//
// validation.criteria: set at creation time to define acceptance criteria (state="unknown"), as an
// array of short strings — a bullet list, one item per criterion; updated at closure with the
// verification evidence (state="pass"|"fail"), where a plain string is accepted too and no length
// cap applies, because evidence is the output of the commands that were run.
// validation can be null if no criteria are defined.
//
// depends_on: the issues that must close before this one — the edge runs from the dependency to the
// issue that declares it. Always stored as an array ([] when absent), so the tracker is a directed
// graph that readers can walk without special-casing a missing key. Ids must exist, an issue cannot
// depend on itself, and a payload that would close a cycle is rejected: the graph stays acyclic
// here, which is what lets every reader assume it. Deleting an issue others depend on is refused
// for the same reason. Declaring a dependency does NOT block the work: nothing stops an issue with
// open dependencies from going in_progress, because that is a workflow rule and it lives in the
// skill, not in this script.
//
// covers: the git revisions this issue declares it covers. Always stored as an array ([] when
// absent). General, not documentation-specific: any issue may declare a revision, and the docs
// gate only asks that SOMEBODY names it. Validation is deliberately loose — non-empty strings, no
// duplicates — because a reference that means nothing fails to resolve and is reported as such by
// scripts/docs-gate.mjs, which is a mistake you can see rather than one that passes.
//
// --insert requires the full payload. --update merges: omitted fields keep their current value,
// while an explicit "validation": null clears the validation object.

import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";

// Resolved in main() from --project-dir (or the cwd) before any command runs.
let issuesFilePath = null;

// Length caps on the free text of an issue. Deliberately not configurable: a limit a project can
// raise is a limit nobody hits. Measured in JavaScript characters on the trimmed string, so
// padding whitespace never decides whether a payload is accepted.
const LIMITS = {
  title: 80,
  description: 1200,
  criterion: 200,
  criteriaCount: 7,
};

// What the work of an issue is expected to cost, so whoever dispatches it does not have to work it
// out again from the description every time. Deliberately a tier and not a model name: harness pins
// no model, it declares a class that the orchestrator maps onto whatever is available. An absent
// tier reads as "standard".
const TIERS = ["economy", "standard", "reasoning"];

// The schema this script currently implements, i.e. the shape documented in references/issues.md.
// A tracker declares which version it was written against via the root-level `schema_version` key,
// sitting next to `last_updated`. Only --init and --upgrade ever WRITE that key; every other
// command here only reads issues.json and rewrites it unchanged on the fields it does not own —
// see writeIssuesFile(). An absent key reads as version 0, and that is not an error: it is the
// same choice already made for `tier` and `depends_on`, a new field never invalidates data
// written before it existed.
const SCHEMA_VERSION = 2;

// Ordered migrations for --upgrade. Each entry names the schema version it PRODUCES (`to`) and a
// function that migrates one issue object, returning either the same reference (untouched) or a
// new object (touched) — never mutating its argument. Entries are appended, never inserted or
// renumbered: the meaning of `to: 1` can never shift under a tracker that upgrades from an old
// version later than one that upgraded right away. --upgrade applies only the entries whose `to`
// falls strictly after the file's current version and at most SCHEMA_VERSION — see
// upgradeTracker() below.
// Where --compact parks the issues it takes out of issues.json. `.harness/` is the project-local
// directory the harness already uses for its own state (see scripts/harness-config.mjs), and an
// archive is frozen history for whoever wants to read it back, not a second tracker. Nothing in
// this script ever reads it — --get, --get-all and the board keep seeing issues.json and nothing
// else.
//
// Whether the archive is committed is the project's decision: harness writes no .gitignore, here
// or anywhere. It is worth deciding rather than inheriting, because issues.json is shared and
// every block it holds names the archive that has the originals — leave that file out of the
// repository and whoever clones finds a pointer to nothing.
const HARNESS_DIR = ".harness";
const ARCHIVE_DIR = "archive";

const MIGRATIONS = [
  {
    to: 1,
    // 0 -> 1: materialize depends_on: [] where the key is missing. An issue written before the
    // field existed already READS as "no dependencies" everywhere else in this script (see
    // validateDependencyGraph, deleteIssue); this migration only makes that reading explicit on
    // disk, it does not change what any command returns for that issue.
    migrateIssue(issue) {
      if (hasProp(issue, "depends_on")) {
        return issue;
      }
      return { ...issue, depends_on: [] };
    },
  },
  {
    to: 2,
    // 1 -> 2: materialize covers: [] where the key is missing. Same shape as 0 -> 1 above: an
    // issue written before the field existed already READS as "covers nothing" everywhere else
    // (see docs-gate.mjs, which treats a missing key as []); this only makes that reading
    // explicit on disk.
    migrateIssue(issue) {
      if (hasProp(issue, "covers")) {
        return issue;
      }
      return { ...issue, covers: [] };
    },
  },
];

// Helper: exception carrying the failure envelope fields, thrown by any validator/reader and
// caught once at the top level so exactly one JSON line is ever emitted.
class IssueManagerError extends Error {
  constructor(message, code = "ERROR") {
    super(message);
    this.code = code;
  }
}

function fail(message, code = "ERROR") {
  throw new IssueManagerError(message, code);
}

// Helper: emit the success envelope on stdout and terminate
function writeOk(data) {
  process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
  process.exit(0);
}

// Helper: emit the failure envelope on stdout and terminate with a non-zero exit code.
// Failures go to stdout, not stderr: the caller parses one stream for both outcomes and
// tells them apart via `ok` or the exit code.
function writeFail(message, code = "ERROR") {
  process.stdout.write(JSON.stringify({ ok: false, error: message, code }) + "\n");
  process.exit(1);
}

// Helper: id generator for new issues
function generateNewId() {
  return randomUUID();
}

// Helper: true when the object carries the named property, even if its value is null
function hasProp(obj, name) {
  return obj !== null && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, name);
}

function isNullOrWhitespace(value) {
  return value === null || value === undefined || typeof value !== "string" || value.trim() === "";
}

// Helper: current timestamp in the same format the .ps1 used (no milliseconds)
function nowTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Helper: resolve the project directory whose issues.json this invocation operates on.
// Defaults to the process cwd, which is the project an agent is working in; --project-dir
// overrides it for callers that cannot control their cwd.
function resolveIssuesFilePath(projectDir) {
  const dir = path.resolve(projectDir ?? process.cwd());
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`Project directory '${dir}' does not exist.`, "FILE_NOT_FOUND");
  }
  return path.join(dir, "issues.json");
}

// Helper: enforce a length cap on a free-text field. Reports the measured length next to the
// maximum, so the caller knows how much to cut instead of guessing.
function validateLength(fieldName, value, max) {
  const length = value.trim().length;
  if (length > max) {
    fail(`'${fieldName}' is ${length} characters long, the maximum is ${max}.`, "LIMIT_EXCEEDED");
  }
}

// Helper: validate validation.criteria against the phase the issue is in.
//
// The field carries two different things at two different moments, and that is why the rules are
// not the same for both. At creation (state "unknown") it holds the acceptance criteria: a bullet
// list, one item per criterion, each short enough to be checked at a glance — so it must be an
// array, capped in length and in count. At closure (state "pass"/"fail") the same field holds the
// EVIDENCE of the verification: the commands that were run and what they printed. Capping that
// would push a verifier towards "verified, all good", which is exactly what evidence is not, so no
// cap applies and a plain string stays acceptable.
//
// A string is also how every issue written before this rule stored its criteria: those records
// keep reading and updating fine, and nothing rewrites them.
function validateCriteria(criteria, state) {
  const isBulletList = state === "unknown";

  if (typeof criteria === "string") {
    if (isBulletList) {
      fail(
        `'validation.criteria' must be an array of strings when 'validation.state' is 'unknown': ` +
          `one item per criterion, at most ${LIMITS.criteriaCount} items of ${LIMITS.criterion} characters. ` +
          "A single string is only accepted at closure, where the field carries the verification evidence.",
        "INVALID_INPUT"
      );
    }
    if (isNullOrWhitespace(criteria)) {
      fail("'validation.criteria' must be a non-empty string.", "INVALID_INPUT");
    }
    return;
  }

  if (!Array.isArray(criteria)) {
    fail(
      "'validation.criteria' must be an array of non-empty strings, or a non-empty string at closure.",
      "INVALID_INPUT"
    );
  }

  if (criteria.length === 0) {
    fail("'validation.criteria' cannot be an empty array.", "INVALID_INPUT");
  }

  criteria.forEach((entry, index) => {
    if (isNullOrWhitespace(entry)) {
      fail(
        `'validation.criteria[${index}]' must be a non-empty string.`,
        "INVALID_INPUT"
      );
    }
  });

  // Length and count are the criteria's business only: at closure the array holds evidence too.
  if (!isBulletList) {
    return;
  }

  if (criteria.length > LIMITS.criteriaCount) {
    fail(
      `'validation.criteria' has ${criteria.length} items, the maximum is ${LIMITS.criteriaCount}.`,
      "LIMIT_EXCEEDED"
    );
  }
  criteria.forEach((entry, index) => {
    validateLength(`validation.criteria[${index}]`, entry, LIMITS.criterion);
  });
}

// Helper: validate the shape of depends_on — everything that can be judged from the payload alone.
// An array and nothing else: null is rejected on purpose, because "no dependencies" already has a
// spelling ([]) and a second one would only make callers guess which is stored.
// No cap on the number of entries: a dependency is a fact about the graph, not free text, and a
// limit would push a caller to drop a real edge to make the payload fit.
function validateDependsOnShape(dependsOn) {
  if (!Array.isArray(dependsOn)) {
    fail("'depends_on' must be an array of issue ids. Pass [] to clear it.", "INVALID_DEPENDENCY");
  }
  const seen = new Set();
  dependsOn.forEach((entry, index) => {
    if (typeof entry !== "string" || !GUID_RE.test(entry)) {
      fail(`'depends_on[${index}]' is not a valid issue id (GUID).`, "INVALID_DEPENDENCY");
    }
    if (seen.has(entry)) {
      fail(`'depends_on' lists '${entry}' more than once.`, "INVALID_DEPENDENCY");
    }
    seen.add(entry);
  });
}

// Helper: validate the shape of covers — the git revisions an issue declares it covers.
//
// Deliberately loose: non-empty strings, no duplicates, and nothing else. Harness is not a git
// library and does not try to recognise a valid sha — a wrong reference simply fails to resolve,
// and docs-gate.mjs reports it as unresolved instead of dropping it. A strict check here would
// refuse legitimate tags and symbolic references to defend against a mistake that shows up
// anyway.
//
// Like depends_on: an array and nothing else, because "covers nothing" already has a spelling
// ([]) and a second one would only make callers guess which is stored. No cap on the number of
// entries either, for the same reason: a cap pushes a caller to drop a real revision to make the
// payload fit.
function validateCoversShape(covers) {
  if (!Array.isArray(covers)) {
    fail("'covers' must be an array of git references. Pass [] to clear it.", "INVALID_INPUT");
  }
  const seen = new Set();
  covers.forEach((entry, index) => {
    if (isNullOrWhitespace(entry)) {
      fail(`'covers[${index}]' must be a non-empty string.`, "INVALID_INPUT");
    }
    if (seen.has(entry)) {
      fail(`'covers' lists '${entry}' more than once.`, "INVALID_INPUT");
    }
    seen.add(entry);
  });
}

// Helper: the part of depends_on that the payload cannot answer for — every id must exist, an issue
// cannot depend on itself, and the tracker must stay a DAG.
//
// Runs against the stored issues with the edges of `selfId` replaced by the proposed ones. The
// stored graph is acyclic by construction, so a new cycle can only pass through the node being
// written: walking forward from the proposed dependencies and looking for selfId is enough, and
// there is no need to rebuild the whole graph.
function validateDependencyGraph(dependsOn, issues, selfId) {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));

  for (const id of dependsOn) {
    if (id === selfId) {
      fail("'depends_on' cannot contain the issue's own id: an issue cannot depend on itself.", "INVALID_DEPENDENCY");
    }
    if (!byId.has(id)) {
      fail(`'depends_on' references issue '${id}', which does not exist in this tracker.`, "INVALID_DEPENDENCY");
    }
  }

  // A brand new issue has an id nobody can already be pointing at, so no edge of its can close a
  // cycle. The existence check above is the whole job.
  if (selfId === null) {
    return;
  }

  // The visited set is not an optimisation: issues.json is a file, and a cycle hand-edited into it
  // before this call would otherwise keep the walk going forever.
  const visited = new Set();
  const stack = [...dependsOn];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === selfId) {
      fail(
        `'depends_on' closes a dependency cycle through issue '${selfId}'.`,
        "INVALID_DEPENDENCY"
      );
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const issue = byId.get(current);
    if (issue && Array.isArray(issue.depends_on)) {
      stack.push(...issue.depends_on);
    }
  }
}

// Helper: validate the provided status value
function validateStatus(status) {
  const validStatuses = ["backlog", "in_progress", "in_review", "blocked", "done"];
  if (!validStatuses.includes(status)) {
    fail(
      `Invalid status value '${status}'. Valid values are: backlog, in_progress, in_review, blocked, done.`,
      "INVALID_STATUS"
    );
  }
}

// Helper: validate the provided tier value. Its own code, like status and state: one code per field
// tells the caller where to look without parsing the message.
function validateTier(tier) {
  if (!TIERS.includes(tier)) {
    fail(
      `Invalid tier value '${tier}'. Valid values are: ${TIERS.join(", ")}.`,
      "INVALID_TIER"
    );
  }
}

// Helper: validate the provided validation.state value
function validateState(state) {
  const validStates = ["unknown", "pass", "fail"];
  if (!validStates.includes(state)) {
    fail(
      `Invalid validation.state value '${state}'. Valid values are: unknown, pass, fail.`,
      "INVALID_STATE"
    );
  }
}

// Helper: validate the full input payload for insert/update operations
// Enforces the canonical schema: title, description, status, validation (object or null).
// Rejects any extra/unknown top-level fields (including id, created_at, updated_at — these are
// auto-managed).
// With partial=true (used by --update), absent fields are allowed; fields that ARE present are
// still validated.
function validateIssueInput(issue, partial = false) {
  if (issue === null || typeof issue !== "object" || Array.isArray(issue)) {
    fail("Issue data must be a JSON object.", "INVALID_INPUT");
  }

  const allowedFields = ["title", "description", "status", "validation", "tier", "depends_on", "covers"];
  const providedFields = Object.keys(issue);
  const unknownFields = providedFields.filter((f) => !allowedFields.includes(f));
  if (unknownFields.length > 0) {
    fail(
      `Unknown field(s) not allowed in issue input: ${unknownFields.join(", ")}. Allowed input fields: ${allowedFields.join(", ")}.`,
      "INVALID_INPUT"
    );
  }

  if (partial && providedFields.length === 0) {
    fail(`No updatable field provided. Allowed input fields: ${allowedFields.join(", ")}.`, "INVALID_INPUT");
  }

  // Required non-empty string: title
  if (hasProp(issue, "title")) {
    if (isNullOrWhitespace(issue.title)) {
      fail("'title' must be a non-empty string.", "INVALID_INPUT");
    }
    validateLength("title", issue.title, LIMITS.title);
  } else if (!partial) {
    fail("'title' is required and must be a non-empty string.", "INVALID_INPUT");
  }

  // Required non-empty string: description
  if (hasProp(issue, "description")) {
    if (isNullOrWhitespace(issue.description)) {
      fail("'description' must be a non-empty string.", "INVALID_INPUT");
    }
    validateLength("description", issue.description, LIMITS.description);
  } else if (!partial) {
    fail("'description' is required and must be a non-empty string.", "INVALID_INPUT");
  }

  // Required valid status
  if (hasProp(issue, "status")) {
    if (isNullOrWhitespace(issue.status)) {
      fail("'status' is required.", "INVALID_INPUT");
    }
    validateStatus(issue.status);
  } else if (!partial) {
    fail("'status' is required.", "INVALID_INPUT");
  }

  // tier: optional everywhere. Absent at insert means null, and an explicit null clears it — a stale
  // tier after a change of scope is not a defect, so it must stay removable.
  if (hasProp(issue, "tier") && issue.tier !== null) {
    validateTier(issue.tier);
  }

  // depends_on: optional everywhere, absent reads as []. Only the shape is checked here — existence,
  // self-reference and cycles need the stored tracker, so they run in insert/update once the file
  // has been read.
  if (hasProp(issue, "depends_on")) {
    validateDependsOnShape(issue.depends_on);
  }

  // covers: optional everywhere, absent reads as []. Nothing here needs the stored tracker — a
  // reference is checked against git, not against issues.json — so unlike depends_on the whole
  // validation happens right here.
  if (hasProp(issue, "covers")) {
    validateCoversShape(issue.covers);
  }

  // validation: must be null or a well-formed object { criteria, state (valid) }
  if (hasProp(issue, "validation") && issue.validation !== null) {
    const v = issue.validation;
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      fail("'validation' must be null or an object with 'criteria' and 'state'.", "INVALID_INPUT");
    }
    const allowedValidationFields = ["criteria", "state"];
    const providedValidationFields = Object.keys(v);
    const unknownValidationFields = providedValidationFields.filter(
      (f) => !allowedValidationFields.includes(f)
    );
    if (unknownValidationFields.length > 0) {
      fail(
        `Unknown field(s) in 'validation' object: ${unknownValidationFields.join(", ")}. Allowed fields: criteria, state.`,
        "INVALID_INPUT"
      );
    }
    if (!hasProp(v, "criteria")) {
      fail(
        "'validation.criteria' is required when 'validation' is provided.",
        "INVALID_INPUT"
      );
    }
    if (!hasProp(v, "state") || isNullOrWhitespace(v.state)) {
      fail("'validation.state' is required when 'validation' is provided.", "INVALID_INPUT");
    }
    // The state decides which rules apply to criteria, so it is validated first.
    validateState(v.state);
    validateCriteria(v.criteria, v.state);
  }
}

// Helper: technical role guard — a worker process must never be able to mark its own work as
// validated/done. Reads HARNESS_ROLE from the environment; when it is "worker", reject any
// insert/update payload that requests validation.state === "pass" or status === "done". This is
// evaluated against the payload's requested values (for --update, only the fields actually
// present in the incoming payload), not the stored issue. Any other/unset HARNESS_ROLE is a no-op.
function enforceRolePolicy(payload) {
  if (process.env.HARNESS_ROLE !== "worker") {
    return;
  }
  if (hasProp(payload, "status") && payload.status === "done") {
    fail(
      "Role 'worker' cannot set status to 'done' (self-validation is forbidden). A worker may set status up to 'in_review'; closing an issue requires a non-worker role.",
      "FORBIDDEN_ROLE"
    );
  }
  if (
    hasProp(payload, "validation") &&
    payload.validation !== null &&
    typeof payload.validation === "object" &&
    payload.validation.state === "pass"
  ) {
    fail(
      "Role 'worker' cannot set validation.state to 'pass' (self-validation is forbidden). A worker may set validation.state up to 'unknown'; recording a pass requires a non-worker role.",
      "FORBIDDEN_ROLE"
    );
  }
}

// Helper: validate that issue id is a valid GUID (accepts the same shapes .NET's [guid]::TryParse
// does for a plain hyphenated string, which is the only shape this script ever produces or is fed)
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function validateIssueId(issueId) {
  if (typeof issueId !== "string" || !GUID_RE.test(issueId)) {
    fail("Invalid issue ID format. It should be a valid GUID.", "INVALID_ID");
  }
}

// Helper: parse a JSON payload coming from the caller
function parseIssueData(issueData) {
  try {
    return JSON.parse(issueData);
  } catch {
    fail("Provided issueData is not valid JSON.", "INVALID_JSON");
  }
}

// Helper: the shape of a brand new tracker. Deliberately minimal: issues.json is the file every
// clone of the project reads, so it carries data and nothing decorative.
function emptyIssuesData() {
  return { last_updated: nowTimestamp(), issues: [] };
}

// Helper: load issues.json and return the root data object.
// A project that has never used the harness has no issues.json: reads treat that as an empty
// tracker instead of an error, and nothing is written to disk. The file is created lazily, by
// writeIssuesFile, the first time there is an actual issue to store.
function readIssuesFile() {
  if (!existsSync(issuesFilePath)) {
    return emptyIssuesData();
  }
  const raw = readFileSync(issuesFilePath, "utf8");
  return JSON.parse(raw);
}

// Helper: save the root data object back to issues.json, updating last_updated.
// Written atomically: a temp file in the same directory is written first, then renamed over the
// target, so a crash mid-write never leaves issues.json truncated or corrupt.
//
// `data` is the object readIssuesFile() handed back, only ever mutated on the fields a command
// actually owns (issues, last_updated here). Any other root key found on disk — schema_version
// included — rides along untouched: this function never enumerates or filters root keys, so a
// file that has schema_version gets it back byte-for-byte, and a file that does not have it never
// gets one added. Only --init and --upgrade are meant to write that key.
function writeIssuesFile(data) {
  data.last_updated = nowTimestamp();
  const serialized = JSON.stringify(data, null, 2);
  const dir = path.dirname(issuesFilePath);
  const tmpPath = path.join(dir, `.issues.json.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmpPath, serialized, "utf8");
  renameSync(tmpPath, issuesFilePath);
}

// Function to create a brand new issues.json in the project directory, seeded minimally.
// Refuses outright when the file already exists: an --init that overwrote it would be an --init
// that erases a live tracker, and no confirmation flag is worth that risk — starting over is a
// deliberate `rm` by the caller, not a flag on this command. Nothing is written on that path.
function initTracker() {
  if (existsSync(issuesFilePath)) {
    fail(
      `'${issuesFilePath}' already exists. Remove it yourself if you want to start over; --init never overwrites.`,
      "ALREADY_EXISTS"
    );
  }
  const data = { schema_version: SCHEMA_VERSION, last_updated: nowTimestamp(), issues: [] };
  writeIssuesFile(data);
  writeOk({ path: issuesFilePath, created: true });
}

// Function to bring issues.json from its own schema_version up to SCHEMA_VERSION, running only
// the migrations in between. An absent key reads as version 0 (see the SCHEMA_VERSION comment
// above) — the same tracker every other command already accepts without a migration.
//
// Idempotent by construction: a file already at SCHEMA_VERSION returns before touching disk at
// all, so a second --upgrade in a row leaves the file byte-for-byte identical to the first result.
// A file AHEAD of SCHEMA_VERSION — declaring a version this script does not know — is refused with
// SCHEMA_TOO_NEW and nothing is written: that is a script older than its data, and rewriting the
// file would silently degrade whatever the newer schema added.
function upgradeTracker() {
  const data = readIssuesFile();
  const fromVersion = hasProp(data, "schema_version") ? data.schema_version : 0;

  if (typeof fromVersion !== "number" || !Number.isInteger(fromVersion) || fromVersion < 0) {
    fail(
      `'${issuesFilePath}' has a 'schema_version' of ${JSON.stringify(data.schema_version)}, which is not a non-negative integer.`,
      "INVALID_INPUT"
    );
  }

  if (fromVersion > SCHEMA_VERSION) {
    fail(
      `'${issuesFilePath}' declares schema_version ${fromVersion}, newer than the ${SCHEMA_VERSION} this ` +
        "script implements. This is an old copy of the harness plugin in front of newer data; " +
        "upgrade the plugin instead of running --upgrade, which would rewrite the file against a " +
        "schema it does not know and degrade it.",
      "SCHEMA_TOO_NEW"
    );
  }

  if (fromVersion === SCHEMA_VERSION) {
    // Nothing to do, and nothing written: re-running --upgrade on an up-to-date tracker must be a
    // no-op all the way down to the bytes on disk.
    writeOk({ from: fromVersion, to: SCHEMA_VERSION, migrated: 0 });
    return;
  }

  const issues = Array.isArray(data.issues) ? data.issues : [];
  // Tracked per issue, not per migration step: an issue touched by two migrations in the same run
  // must still count once in `migrated`, which reports how many ISSUES changed, not how many
  // field-level edits were made.
  const touched = new Array(issues.length).fill(false);
  let migratedIssues = issues;

  for (const migration of MIGRATIONS) {
    if (migration.to <= fromVersion || migration.to > SCHEMA_VERSION) {
      continue;
    }
    migratedIssues = migratedIssues.map((issue, index) => {
      const next = migration.migrateIssue(issue);
      if (next !== issue) {
        touched[index] = true;
      }
      return next;
    });
  }

  data.issues = migratedIssues;
  data.schema_version = SCHEMA_VERSION;
  writeIssuesFile(data);
  writeOk({ from: fromVersion, to: SCHEMA_VERSION, migrated: touched.filter(Boolean).length });
}

// Helper: validate the --compact payload — everything that can be judged from the payload alone,
// without reading the tracker. The shape is deliberately its own, not the issue shape validated by
// validateIssueInput(): --compact does not describe an issue, it describes how already-closed ones
// get grouped.
//
//   { "blocks": [ { "title": "…", "description": "…", "issue_ids": ["<guid>", …] } ] }
//
// title and description are capped by the SAME limits every other issue obeys (LIMITS.title /
// LIMITS.description): a block becomes an issue like any other, and a summary that is allowed to
// grow past the cap would defeat the point of compacting.
function validateCompactInput(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    fail(
      "Compact data must be a JSON object of the form { blocks: [ { title, description, issue_ids } ] }.",
      "INVALID_INPUT"
    );
  }

  const unknownFields = Object.keys(payload).filter((f) => f !== "blocks");
  if (unknownFields.length > 0) {
    fail(
      `Unknown field(s) not allowed in compact input: ${unknownFields.join(", ")}. The only allowed field is 'blocks'.`,
      "INVALID_INPUT"
    );
  }

  if (!Array.isArray(payload.blocks) || payload.blocks.length === 0) {
    fail(
      "'blocks' must be a non-empty array of { title, description, issue_ids }.",
      "INVALID_INPUT"
    );
  }

  // Which block claimed an id first, so a duplicate can name both ends instead of just saying
  // "duplicate". --compact removes the original and writes a block record in its place: an id in
  // two blocks would put the same closed issue under two summaries, and only one of them could be
  // true.
  const claimedBy = new Map();

  payload.blocks.forEach((block, index) => {
    if (block === null || typeof block !== "object" || Array.isArray(block)) {
      fail(`'blocks[${index}]' must be an object with 'title', 'description' and 'issue_ids'.`, "INVALID_INPUT");
    }

    const allowedBlockFields = ["title", "description", "issue_ids"];
    const unknownBlockFields = Object.keys(block).filter((f) => !allowedBlockFields.includes(f));
    if (unknownBlockFields.length > 0) {
      fail(
        `Unknown field(s) in 'blocks[${index}]': ${unknownBlockFields.join(", ")}. Allowed fields: ${allowedBlockFields.join(", ")}.`,
        "INVALID_INPUT"
      );
    }

    if (isNullOrWhitespace(block.title)) {
      fail(`'blocks[${index}].title' must be a non-empty string.`, "INVALID_INPUT");
    }
    validateLength(`blocks[${index}].title`, block.title, LIMITS.title);

    if (isNullOrWhitespace(block.description)) {
      fail(`'blocks[${index}].description' must be a non-empty string.`, "INVALID_INPUT");
    }
    validateLength(`blocks[${index}].description`, block.description, LIMITS.description);

    // An empty block covers nothing and would still write a done/pass record: a summary of no
    // history at all, which is the one thing an archive summary must never be.
    if (!Array.isArray(block.issue_ids) || block.issue_ids.length === 0) {
      fail(
        `'blocks[${index}].issue_ids' must be a non-empty array of issue ids: an empty block would archive nothing and still write a 'done' record.`,
        "INVALID_INPUT"
      );
    }

    block.issue_ids.forEach((id, idIndex) => {
      if (typeof id !== "string" || !GUID_RE.test(id)) {
        fail(`'blocks[${index}].issue_ids[${idIndex}]' is not a valid issue id (GUID).`, "INVALID_ID");
      }
      if (claimedBy.has(id)) {
        const first = claimedBy.get(id);
        const where =
          first === index
            ? `twice in 'blocks[${index}].issue_ids'`
            : `in both 'blocks[${first}]' and 'blocks[${index}]'`;
        fail(`Issue '${id}' is listed ${where}. An issue can only be archived once.`, "INVALID_INPUT");
      }
      claimedBy.set(id, index);
    });
  });
}

// Helper: pick the file this run's archive goes into. The timestamp is the same one stamped into
// the record, with ':' swapped for '-' because a colon cannot appear in a filename on Windows.
// Two compactions inside the same second get a numeric suffix rather than overwriting each other:
// an archive is the only surviving copy of what it holds, so it never gets clobbered.
function resolveArchivePath(projectDir, timestamp) {
  const dir = path.join(projectDir, HARNESS_DIR, ARCHIVE_DIR);
  const stamp = timestamp.replace(/:/g, "-");
  let candidate = path.join(dir, `${stamp}.json`);
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = path.join(dir, `${stamp}-${suffix}.json`);
    suffix += 1;
  }
  return candidate;
}

// Function to shrink issues.json without losing what was done: the closed issues named by the
// caller are moved, whole, into .harness/archive/<timestamp>.json, and one issue per block takes
// their place.
//
// This is a PRIMITIVE: it decides no grouping. Knowing that two closed issues are "the same
// subject" is judgement, and judgement belongs to whoever calls this — the blocks arrive already
// decided (see validateCompactInput for the payload).
//
// Everything that can refuse runs before the first byte is written, in this order:
//   1. the role guard   — no payload makes a worker's compaction legitimate, so it goes first;
//   2. the payload      — shape, limits, empty blocks, an id claimed by two blocks;
//   3. the tracker      — every id exists and is 'done';
//   4. the graph        — no LIVE issue may still point at an id about to be archived.
// Step 4 is --delete's rule, for --delete's reason: rewriting those depends_on to point at the
// block would mutate issues the caller never named. Whoever compacts unlinks first.
function compactTracker(compactData) {
  // Checked before the payload is even parsed, and deliberately so: every block this command
  // writes is a status 'done' / validation.state 'pass' record, whatever the payload says, so
  // there is no input a worker could pass that would make the call legitimate. Refusing here
  // names the actual reason instead of whichever payload nit happened to be found first.
  if (process.env.HARNESS_ROLE === "worker") {
    fail(
      "Role 'worker' cannot run --compact: every block it writes is a 'done' issue with " +
        "validation.state 'pass' (self-validation is forbidden). Compacting the tracker requires a " +
        "non-worker role.",
      "FORBIDDEN_ROLE"
    );
  }

  const payload = parseIssueData(compactData);
  validateCompactInput(payload);

  const data = readIssuesFile();
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const byId = new Map(issues.map((issue) => [issue.id, issue]));

  const archivedIds = new Set();
  for (const block of payload.blocks) {
    for (const id of block.issue_ids) {
      const issue = byId.get(id);
      if (!issue) {
        fail(`Issue with ID '${id}' not found.`, "NOT_FOUND");
      }
      // Only closed work can be summarised: an issue still moving would have its history frozen
      // under a 'done' block while the work it describes is still going on.
      if (issue.status !== "done") {
        fail(
          `Issue '${id}' has status '${issue.status}': --compact only archives issues that are 'done'.`,
          "INVALID_STATUS"
        );
      }
      archivedIds.add(id);
    }
  }

  // A dependency between two issues that are BOTH being archived leaves with them and is no
  // problem; only an edge from an issue that stays behind would end up dangling.
  const dependents = issues
    .filter((issue) => !archivedIds.has(issue.id) && Array.isArray(issue.depends_on))
    .map((issue) => ({ id: issue.id, pointsAt: issue.depends_on.filter((id) => archivedIds.has(id)) }))
    .filter((entry) => entry.pointsAt.length > 0);
  if (dependents.length > 0) {
    fail(
      `Cannot compact: ${dependents.length} live issue(s) still declare an archived id in 'depends_on' ` +
        `(${dependents.map((d) => `${d.id} -> ${d.pointsAt.join(", ")}`).join("; ")}). ` +
        "Remove those ids from their 'depends_on' first: rewriting them here would mutate issues you did not name.",
      "INVALID_DEPENDENCY"
    );
  }

  // ---- Nothing above this line writes. Everything below does. ----

  const now = nowTimestamp();
  const projectDir = path.dirname(issuesFilePath);
  const archivePath = resolveArchivePath(projectDir, now);
  // Project-relative and with forward slashes: this string is what the block issue carries as
  // evidence, and issues.json is the one file the harness shares through the repository. An
  // absolute path from one clone means nothing in another.
  const archiveRelPath = `${HARNESS_DIR}/${ARCHIVE_DIR}/${path.basename(archivePath)}`;

  // The ORIGINAL objects, as read off disk and not rebuilt: an archive that normalised its records
  // would be an archive of what this version of the script thinks an issue looks like, not of what
  // was actually written.
  const archivedIssues = payload.blocks.flatMap((block) => block.issue_ids.map((id) => byId.get(id)));

  // The archive self-describes: whoever reopens it in six months must not have to guess which
  // schema they are reading. An absent key reads as version 0, exactly as everywhere else.
  const archiveRecord = {
    schema_version: hasProp(data, "schema_version") ? data.schema_version : 0,
    archived_at: now,
    issues: archivedIssues,
  };

  const blockIssues = payload.blocks.map((block) => ({
    id: generateNewId(),
    title: block.title,
    description: block.description,
    status: "done",
    tier: null,
    depends_on: [],
    // A block summarises closed issues; it covers no revision of its own. The revisions the
    // originals declared leave with them, whole, into the archive.
    covers: [],
    validation: {
      // The evidence of a compaction is where the originals went and what they were, so the block
      // stays traceable back to the issues it replaced without reopening the archive to find out.
      criteria: [
        `Archived originals: ${archiveRelPath}`,
        ...block.issue_ids.map((id) => `${id} - ${byId.get(id).title}`),
      ],
      state: "pass",
    },
    created_at: now,
    updated_at: now,
  }));

  data.issues = [...issues.filter((issue) => !archivedIds.has(issue.id)), ...blockIssues];

  // Write order is not arbitrary: the archive first, issues.json second. A failure while writing
  // the archive leaves the tracker exactly as it was and loses nothing; the reverse order would
  // put a window between "the issues are gone" and "the copy exists".
  // Recursive, so it creates .harness/ too when this is the first thing the project writes there.
  mkdirSync(path.dirname(archivePath), { recursive: true });
  writeFileSync(archivePath, JSON.stringify(archiveRecord, null, 2) + "\n", "utf8");
  writeIssuesFile(data);

  writeOk({
    archivePath,
    removed: archivedIds.size,
    blocks: blockIssues.map((issue, index) => ({
      id: issue.id,
      title: issue.title,
      archivedCount: payload.blocks[index].issue_ids.length,
    })),
  });
}

// 1. Function to display help information
function showHelp() {
  const lines = [
    "Usage:",
    "node issue-manager.mjs --help",
    "node issue-manager.mjs --get --issue-id <id>",
    "node issue-manager.mjs --get-all [--order asc|desc] [--page 0] [--page-size 10]",
    "                        [--status backlog|in_progress|in_review|blocked|done, default: backlog]",
    "node issue-manager.mjs --insert (--issue-data '<json>' | --issue-data-file <path>)",
    "node issue-manager.mjs --update --issue-id <id> (--issue-data '<json>' | --issue-data-file <path>)",
    "node issue-manager.mjs --delete --issue-id <id>",
    "node issue-manager.mjs --init",
    "node issue-manager.mjs --upgrade",
    "node issue-manager.mjs --compact (--issue-data '<json>' | --issue-data-file <path>)",
    "",
    "Project resolution:",
    "  --project-dir <path>  directory holding issues.json (default: the current directory).",
    "  issues.json is never resolved next to this script: one installed copy serves every project.",
    "  A project without issues.json reads as an empty tracker; the file is created on first write.",
    "",
    "Output contract (stdout is always one line of JSON, except for this help text):",
    '  success : {"ok":true,"data":<payload>}                       exit code 0',
    '  failure : {"ok":false,"error":"<msg>","code":"<CODE>"}  exit code 1',
    "Nothing is written to stderr: pipe stdout to JSON.parse in both cases.",
    "",
    "Error codes: INVALID_ID, INVALID_STATUS, INVALID_STATE, INVALID_TIER, INVALID_DEPENDENCY,",
    "             INVALID_INPUT, INVALID_JSON, LIMIT_EXCEEDED, NOT_FOUND, FILE_NOT_FOUND,",
    "             MISSING_ARGS, UNKNOWN_COMMAND, FORBIDDEN_ROLE, ALREADY_EXISTS, SCHEMA_TOO_NEW",
    "",
    "Role guard: when env var HARNESS_ROLE=worker, --insert/--update requests that set",
    "status=done or validation.state=pass are rejected with FORBIDDEN_ROLE (no self-validation).",
    "A worker may still set status up to in_review and validation.state up to unknown.",
    "--compact is refused outright under that role: every block it writes is a done/pass record.",
    "",
    "data payload per command:",
    "  --get       : the issue object",
    "  --get-all   : { totalCount, page, pageSize, issues: [...] }",
    "                totalCount/issues are counted AFTER the --status filter, which defaults to",
    "                backlog when --status is omitted: a bare --get-all does not return the whole",
    "                tracker, only its backlog slice. Pass --status explicitly to see another state.",
    "  --insert    : the created issue object (read .data.id for the new GUID)",
    "  --update    : the updated issue object",
    "  --delete    : { id, deleted }",
    "  --init      : { path, created: true } — creates issues.json with the minimal seed",
    "                { schema_version, last_updated, issues: [] }. Fails with ALREADY_EXISTS and",
    "                writes nothing if the file is already there: remove it yourself to start over.",
    "  --upgrade   : { from, to, migrated } — brings issues.json's schema_version (absent reads as",
    "                0) up to SCHEMA_VERSION, running only the migrations in between. Adds new",
    "                fields with their default (0->1 materializes depends_on: [] where missing,",
    "                1->2 does the same with covers: []); never touches or removes an existing",
    "                value. Idempotent: a file already at SCHEMA_VERSION returns migrated: 0 and",
    "                is NOT rewritten. A file declaring a schema_version ABOVE SCHEMA_VERSION fails",
    "                with SCHEMA_TOO_NEW and writes",
    "                nothing: that is an old script in front of newer data. Neither --insert nor",
    "                --update ever runs a migration on your behalf.",
    "  --compact   : { archivePath, removed, blocks: [ { id, title, archivedCount } ] } — shrinks",
    "                issues.json without losing history. Takes the groupings ALREADY DECIDED by the",
    "                caller, as { blocks: [ { title, description, issue_ids } ] }; it groups",
    "                nothing itself. Every id must exist and be 'done', no id in two blocks, no",
    "                empty block, title/description within the usual limits. Refused with",
    "                INVALID_DEPENDENCY, listing the ids that point, when a LIVE issue still",
    "                declares an archived id in depends_on: unlink first, this command never",
    "                rewrites an issue you did not name. On success the original issue objects are",
    "                written WHOLE to <project>/.harness/archive/<timestamp>.json together with the",
    "                schema_version they were stored under, removed from issues.json, and replaced",
    "                by one issue per block (status done, validation.state pass, criteria carrying",
    "                the archive path and the id + title of every issue covered). The archive is",
    "                never read back: --get, --get-all and the board see issues.json only. Any",
    "                refusal writes nothing at all — neither issues.json nor the archive.",
    "",
    "Passing the payload:",
    "  --issue-data-file <path>  reads the JSON from a file — no shell quoting/escaping",
    "  --issue-data '<json>'     inline JSON; mutually exclusive with --issue-data-file",
    "",
    "Allowed input fields for --insert/--update: title, description, status, tier, depends_on, covers, validation",
    `  title        : non-empty string, at most ${LIMITS.title} characters`,
    `  description  : non-empty string, at most ${LIMITS.description} characters`,
    "  status       : backlog | in_progress | in_review | blocked | done",
    `  tier         : ${TIERS.join(" | ")} | null — expected cost of the work; absent reads as standard`,
    "  depends_on   : array of ids of the issues that must close first; absent reads as [], [] clears it",
    "                 ids must exist, no self-reference, no cycles — rejected with INVALID_DEPENDENCY",
    "                 an issue other issues depend on cannot be deleted until they stop pointing at it",
    "                 it does not gate the work: an issue with open dependencies can still go in_progress",
    "  covers       : array of git references this issue covers; absent reads as [], [] clears it",
    "                 non-empty strings, no duplicates — no further check: harness is not a git",
    "                 library, and a reference that does not resolve is reported by docs-gate.mjs",
    "  validation   : null OR { criteria, state: unknown|pass|fail }",
    `                 state=unknown : criteria is an array of at most ${LIMITS.criteriaCount} strings of ${LIMITS.criterion} characters`,
    "                 state=pass|fail : criteria carries the verification evidence — string or array, uncapped",
    "--insert requires title, description and status.",
    '--update merges: omitted fields keep their current value; an explicit "validation": null clears it.',
    "Length limits are checked on --insert and on the fields actually present in --update, and are",
    "measured on the trimmed value. Over the limit the payload is rejected with LIMIT_EXCEEDED:",
    "keep a summary in the field and point at a document in the project instead of compressing it.",
    "Note: id, created_at, updated_at are auto-managed and must NOT be provided.",
  ];
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

// 2. Function to get issue details by ID
function getIssue(issueId) {
  validateIssueId(issueId);
  const data = readIssuesFile();
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) {
    fail(`Issue with ID '${issueId}' not found.`, "NOT_FOUND");
  }
  writeOk(issue);
}

// 3. Function to get all issues with optional filtering, ordering, and pagination
function getAllIssues({ order, page, pageSize, status }) {
  // A pageSize below 1 would make the end index fall behind the start index and return
  // reordered or missing issues instead of an empty page.
  if (pageSize < 1) {
    fail("'pageSize' must be greater than 0.", "INVALID_INPUT");
  }

  const data = readIssuesFile();
  let issues = Array.isArray(data.issues) ? [...data.issues] : [];

  // Filter by status if provided
  if (status) {
    issues = issues.filter((i) => i.status === status);
  }

  // Order the issues
  issues.sort((a, b) => {
    if (a.id < b.id) return order === "asc" ? -1 : 1;
    if (a.id > b.id) return order === "asc" ? 1 : -1;
    return 0;
  });

  // Pagination — an out-of-range page yields an empty array, never a reversed slice
  const totalIssues = issues.length;
  const startIndex = Math.max(0, page) * pageSize;
  let pagedIssues = [];
  if (totalIssues > 0 && startIndex < totalIssues) {
    const endIndex = Math.min(startIndex + pageSize, totalIssues);
    pagedIssues = issues.slice(startIndex, endIndex);
  }

  writeOk({
    totalCount: totalIssues,
    page,
    pageSize,
    issues: pagedIssues,
  });
}

// 4. Function to insert a new issue
function insertIssue(issueData) {
  const newIssue = parseIssueData(issueData);

  validateIssueInput(newIssue, false);
  enforceRolePolicy(newIssue);

  const data = readIssuesFile();
  const existingIssues = Array.isArray(data.issues) ? data.issues : [];
  const dependsOn = hasProp(newIssue, "depends_on") ? newIssue.depends_on : [];
  validateDependencyGraph(dependsOn, existingIssues, null);

  const now = nowTimestamp();

  // Build the stored object with auto-managed fields; never trust caller-supplied id/timestamps
  const storedIssue = {
    id: generateNewId(),
    title: newIssue.title,
    description: newIssue.description,
    status: newIssue.status,
    tier: hasProp(newIssue, "tier") ? newIssue.tier : null,
    // Always an array, never absent: the field is read on every render of the graph, and a missing
    // key would push that check onto every reader instead of settling it here.
    depends_on: dependsOn,
    // Always an array, never absent: docs-gate.mjs reads this field on every issue of the
    // tracker, and a missing key would push that check onto every reader instead of settling it
    // here — the same reason depends_on is materialized above.
    covers: hasProp(newIssue, "covers") ? newIssue.covers : [],
    validation: hasProp(newIssue, "validation") ? newIssue.validation : null,
    created_at: now,
    updated_at: now,
  };

  data.issues = Array.isArray(data.issues) ? [...data.issues, storedIssue] : [storedIssue];
  writeIssuesFile(data);
  writeOk(storedIssue);
}

// 5. Function to update an existing issue by ID
// Merge semantics: a field absent from the payload keeps its current value.
function updateIssue(issueId, issueData) {
  validateIssueId(issueId);
  const updatedIssue = parseIssueData(issueData);

  validateIssueInput(updatedIssue, true);
  enforceRolePolicy(updatedIssue);

  const data = readIssuesFile();
  const issues = Array.isArray(data.issues) ? [...data.issues] : [];

  const issueIndex = issues.findIndex((i) => i.id === issueId);
  if (issueIndex === -1) {
    fail(`Issue with ID '${issueId}' not found.`, "NOT_FOUND");
  }

  const existing = issues[issueIndex];

  // The graph checks need the tracker as stored, and only the edges of THIS issue are being
  // replaced — an update that omits depends_on cannot introduce a cycle, so it is not re-validated.
  const dependsOn = hasProp(updatedIssue, "depends_on")
    ? updatedIssue.depends_on
    : Array.isArray(existing.depends_on) ? existing.depends_on : [];
  if (hasProp(updatedIssue, "depends_on")) {
    validateDependencyGraph(dependsOn, issues, issueId);
  }

  // Rebuild the stored object: preserve id + created_at; set new updated_at
  const storedIssue = {
    id: issueId,
    title: hasProp(updatedIssue, "title") ? updatedIssue.title : existing.title,
    description: hasProp(updatedIssue, "description") ? updatedIssue.description : existing.description,
    status: hasProp(updatedIssue, "status") ? updatedIssue.status : existing.status,
    // ?? null, not the bare value: the issues written before this field have no `tier` key at all,
    // and carrying an undefined through would silently drop the key from the stored object.
    tier: hasProp(updatedIssue, "tier") ? updatedIssue.tier : existing.tier ?? null,
    // Same reason as tier: an issue written before this field has no key at all, and the merge must
    // materialise the empty array rather than carry an undefined into the stored object.
    depends_on: dependsOn,
    // Same merge as depends_on: an issue written before this field has no key at all, so the
    // merge must materialise the empty array rather than carry an undefined into the object.
    covers: hasProp(updatedIssue, "covers")
      ? updatedIssue.covers
      : Array.isArray(existing.covers)
        ? existing.covers
        : [],
    validation: hasProp(updatedIssue, "validation") ? updatedIssue.validation : existing.validation,
    created_at: existing.created_at,
    updated_at: nowTimestamp(),
  };

  issues[issueIndex] = storedIssue;
  data.issues = issues;

  writeIssuesFile(data);
  writeOk(storedIssue);
}

// 6. Function to delete an issue by ID
function deleteIssue(issueId) {
  validateIssueId(issueId);
  const data = readIssuesFile();
  const issues = Array.isArray(data.issues) ? data.issues : [];

  const exists = issues.some((i) => i.id === issueId);
  if (!exists) {
    fail(`Issue with ID '${issueId}' not found.`, "NOT_FOUND");
  }

  // Deleting an issue others depend on would leave dangling ids behind. The alternative — stripping
  // the id from every dependent — would rewrite issues the caller never named, silently. Refusing
  // costs one extra command and keeps the change where the caller can see it.
  const dependents = issues.filter(
    (i) => Array.isArray(i.depends_on) && i.depends_on.includes(issueId)
  );
  if (dependents.length > 0) {
    fail(
      `Issue '${issueId}' cannot be deleted: ${dependents.length} issue(s) depend on it ` +
        `(${dependents.map((i) => i.id).join(", ")}). Remove it from their 'depends_on' first.`,
      "INVALID_DEPENDENCY"
    );
  }

  // Remove the issue from the list
  data.issues = issues.filter((i) => i.id !== issueId);

  writeIssuesFile(data);
  writeOk({ id: issueId, deleted: true });
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: false,
    options: {
      help: { type: "boolean" },
      get: { type: "boolean" },
      "get-all": { type: "boolean" },
      insert: { type: "boolean" },
      update: { type: "boolean" },
      delete: { type: "boolean" },
      init: { type: "boolean" },
      upgrade: { type: "boolean" },
      compact: { type: "boolean" },
      "issue-id": { type: "string" },
      "issue-data": { type: "string" },
      "issue-data-file": { type: "string" },
      "project-dir": { type: "string" },
      order: { type: "string", default: "asc" },
      page: { type: "string", default: "0" },
      "page-size": { type: "string", default: "10" },
      // Deliberate default, not an oversight: every caller shipped in this repo that reads
      // --get-all for actual workflow decisions (SKILL.md, commands/issue.md, commands/verify.md)
      // already passes --status explicitly, so this default never silently changes their result.
      // It exists for the bare `--get-all` case, and showHelp()/references/issues.md both spell it
      // out so that case does not read as "the whole tracker" when it is really "the backlog".
      status: { type: "string", default: "backlog" },
    },
  });

  if (values.help) {
    showHelp();
    return;
  }

  issuesFilePath = resolveIssuesFilePath(values["project-dir"]);

  const issueId = values["issue-id"];
  let issueData = values["issue-data"];
  const issueDataFile = values["issue-data-file"];

  // 7. Resolve the payload source: --issue-data (inline) or --issue-data-file (path), never both
  if (issueDataFile) {
    if (issueData) {
      fail("--issue-data and --issue-data-file are mutually exclusive. Provide only one.", "MISSING_ARGS");
    }
    if (!existsSync(issueDataFile)) {
      fail(`Issue data file '${issueDataFile}' not found.`, "FILE_NOT_FOUND");
    }
    issueData = readFileSync(issueDataFile, "utf8");
  }

  const order = values.order === "desc" ? "desc" : "asc";
  const page = Number.parseInt(values.page, 10);
  const pageSize = Number.parseInt(values["page-size"], 10);
  const status = values.status;

  // 8. Switch case to handle different tasks based on the provided argument
  if (values.get) {
    if (!issueId) {
      fail("Please provide an issue ID to retrieve.", "MISSING_ARGS");
    }
    getIssue(issueId);
  } else if (values["get-all"]) {
    getAllIssues({ order, page, pageSize, status });
  } else if (values.insert) {
    if (!issueData) {
      fail("Please provide issue data in JSON format to insert (--issue-data or --issue-data-file).", "MISSING_ARGS");
    }
    insertIssue(issueData);
  } else if (values.update) {
    if (!issueId || !issueData) {
      fail(
        "Please provide both issue ID and issue data in JSON format to update (--issue-data or --issue-data-file).",
        "MISSING_ARGS"
      );
    }
    updateIssue(issueId, issueData);
  } else if (values.delete) {
    if (!issueId) {
      fail("Please provide an issue ID to delete.", "MISSING_ARGS");
    }
    deleteIssue(issueId);
  } else if (values.init) {
    initTracker();
  } else if (values.upgrade) {
    upgradeTracker();
  } else if (values.compact) {
    if (!issueData) {
      fail(
        "Please provide the blocks to compact in JSON format (--issue-data or --issue-data-file).",
        "MISSING_ARGS"
      );
    }
    compactTracker(issueData);
  } else {
    fail("Invalid task specified. Use '--help' for usage information.", "UNKNOWN_COMMAND");
  }
}

try {
  main();
} catch (err) {
  if (err instanceof IssueManagerError) {
    writeFail(err.message, err.code);
  } else {
    writeFail(`Unexpected error: ${err && err.message ? err.message : String(err)}`, "ERROR");
  }
}
