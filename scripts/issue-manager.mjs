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
// validation.state === "pass", status === "done", or checked === true on an entry of
// validation.tasks is rejected with FORBIDDEN_ROLE — checking a criterion that measures your own
// work is self-validation with a different syntax. A worker may still move status up to
// "in_review", validation.state up to "unknown", and check its own "tasks". --compact is refused
// outright under that role, because every block it writes is a done/pass record. Any other/unset
// HARNESS_ROLE leaves behavior unchanged.
//
// A separate refusal, not about roles: an issue cannot move to status "in_progress" while its
// "tasks" are empty. Whoever takes it materializes the steps first, so the tracker keeps them when
// the session that held them ends. The check is on the transition — a payload asking for
// in_progress — and never on an unrelated update to an issue already in flight.

// Every issue in the issues.json file should have the following structure:
// {
//     "id": "<guid>",
//     "title": "<string>",
//     "description": "<string>",
//     "status": "<backlog|in_progress|in_review|blocked|done>",
//     "tier": "<economy|standard|reasoning>"|null,
//     "depends_on": ["<guid>"],
//     "covers": ["<git-ref>"],
//     "tasks": [ { "id": 1, "short_title": "<string>", "full_description": "<string>", "checked": false } ],
//     "validation": { "criteria": ["<string>"], "tasks": [ ... ], "state": "<unknown|pass|fail>" }|null,
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
// tasks / validation.tasks: the decomposition of the prose at the grain the agent works on — one
// entry per step, { id, short_title, full_description, checked }. `tasks` are the execution steps,
// materialized by whoever takes the issue; `validation.tasks` are the judgement steps, born with
// the issue. Both are always stored as an array ([] when absent), for the reason depends_on and
// covers are: a reader must never have to tell a missing key from an empty list. They INDEX, they
// do not replace — full_description carries what it takes to act, not the analysis behind it. The
// ids are integers, unique inside their own array, local and ordinal: the useful reference is
// "task 4", and a GUID would make it unreadable in the one place it is read.
//
// --insert requires the full payload. --update merges: omitted fields keep their current value,
// while an explicit "validation": null clears the validation object. Inside a validation object
// that IS provided, an absent "tasks" inherits the stored ones rather than clearing them: the
// closing payload is {criteria, state}, and without that rule every closure would delete the very
// checklist it just judged.

import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import {
  StorageError,
  classifyStorage,
  deleteIssueFile,
  issuePath,
  readAllIssues,
  readIssue,
  serializeIssue,
  writeIssue,
} from "./issue-store.mjs";

// Resolved in main() from --project-dir (or the cwd) before any command runs.
let issuesFilePath = null;
let projectDir = null;
let storage = null;

// Length caps on the free text of an issue. Deliberately not configurable: a limit a project can
// raise is a limit nobody hits. Measured in JavaScript characters on the trimmed string, so
// padding whitespace never decides whether a payload is accepted.
const LIMITS = {
  title: 80,
  description: 1200,
  criterion: 200,
  criteriaCount: 7,
  // Measured in characters and not in words: the real constraint is fitting one row of the summary,
  // which is what the rendering measures. Counting words is ambiguous
  // across languages, hyphens and acronyms; counting characters is not.
  taskTitle: 60,
  // Generous, not absent. High enough never to bite an index entry — a command, its expected
  // outcome, the pointer to the plan step — low enough to stop a manual. Without any ceiling the
  // "tasks index, they do not replace" rule would be the only defence, and a rule without a check
  // is the rule that gets skipped.
  taskDescription: 1200,
};

// What the work of an issue is expected to cost, so whoever dispatches it does not have to work it
// out again from the description every time. Deliberately a tier and not a model name: harness pins
// no model, it declares a class that the orchestrator maps onto whatever is available. An absent
// tier reads as "standard".
const TIERS = ["economy", "standard", "reasoning"];

// The schema this script currently implements, i.e. the shape documented in references/issues.md.
// A tracker declares which version it was written against via the root-level `schema_version` key,
// written first in the root object — by --init, which seeds it there, and by --upgrade, which
// rebuilds the root so a migrated tracker has the same shape as a freshly created one. It is NOT
// promised adjacent to `last_updated`: that holds only for the --init seed, where last_updated is
// the second key, and never for a tracker carrying `project` or anything else of its own.
// Only --init and --upgrade ever WRITE that key; every other
// command here only reads issues.json and rewrites it unchanged on the fields it does not own —
// see writeIssuesFile(). An absent key reads as version 0, and that is not an error: it is the
// same choice already made for `tier` and `depends_on`, a new field never invalidates data
// written before it existed.
const SCHEMA_VERSION = 4;

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
// this script ever reads it — --get and --get-all keep seeing issues.json and nothing
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
  {
    to: 3,
    // 2 -> 3: materialize tasks: [] on the issue, and validation.tasks: [] on the issues that
    // carry a validation object. Same shape as the two migrations before it: an issue written
    // before the fields already READS as "no tasks" everywhere else, and this only writes that
    // reading down on disk. Nothing acquires a task, and an issue whose validation is null does
    // not grow one to hold them: there would be nowhere to put them, and inventing a validation
    // object would turn a lightweight-verification issue into one with an empty contract.
    migrateIssue(issue) {
      const needsTasks = !hasProp(issue, "tasks");
      const validation = issue.validation;
      const hasValidationObject =
        validation !== null &&
        validation !== undefined &&
        typeof validation === "object" &&
        !Array.isArray(validation);
      const needsValidationTasks = hasValidationObject && !hasProp(validation, "tasks");

      if (!needsTasks && !needsValidationTasks) {
        return issue;
      }
      const next = { ...issue };
      if (needsTasks) {
        next.tasks = [];
      }
      if (needsValidationTasks) {
        next.validation = { ...validation, tasks: [] };
      }
      return next;
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

// Helper: emit the success envelope on stdout and let Node terminate after the stream drains.
// process.exit() can truncate large evidence payloads while stdout is still being flushed.
function writeOk(data) {
  process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
  process.exitCode = 0;
}

// Helper: emit the failure envelope on stdout and terminate with a non-zero exit code.
// Failures go to stdout, not stderr: the caller parses one stream for both outcomes and
// tells them apart via `ok` or the exit code.
function writeFail(message, code = "ERROR") {
  process.stdout.write(JSON.stringify({ ok: false, error: message, code }) + "\n");
  process.exitCode = 1;
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
function resolveProjectDir(projectDirArg) {
  const dir = path.resolve(projectDirArg ?? process.cwd());
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`Project directory '${dir}' does not exist.`, "FILE_NOT_FOUND");
  }
  return dir;
}

function requireMarkdownStorage() {
  if (storage.kind === "legacy") {
    fail("Run --upgrade before using this tracker.", "STORAGE_NOT_MIGRATED");
  }
  if (storage.kind === "conflict") {
    fail(
      "Legacy JSON and Markdown issues are both populated. That is what an interrupted --upgrade " +
        "leaves behind: run --upgrade again to finish it, or reconcile the two by hand if they are " +
        "genuinely two trackers.",
      "STORAGE_CONFLICT"
    );
  }
  return storage;
}

function configPathOf() {
  return path.join(projectDir, HARNESS_DIR, "config.json");
}

// Helper: read the config object, or null when the project has none. Both callers below need the
// same two refusals — unparsable, or not an object — and a config nobody can read is not a config
// whose schema_version can be trusted either.
function readConfigObject() {
  const configPath = configPathOf();
  if (!existsSync(configPath)) return null;
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    fail(`Config file '${configPath}' is not valid JSON.`, "INVALID_INPUT");
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    fail(`Config file '${configPath}' must contain a JSON object.`, "INVALID_INPUT");
  }
  return config;
}

function readSchemaVersion() {
  const config = readConfigObject();
  if (config === null) return SCHEMA_VERSION;
  return typeof config.schema_version === "number" ? config.schema_version : SCHEMA_VERSION;
}

// Helper: write schema_version into .harness/config.json, leading the object and leaving every
// other field exactly where it was. Two rules, and both matter:
//
// It never CREATES the config. Whether a project has one is the project's decision
// (scripts/harness-config.mjs owns that file), and a migration is not the moment to make it.
//
// It rewrites nothing when the value is already right, so a second --init or --upgrade in a row
// touches no byte on disk. Indented and newline-terminated because this is a file people open and
// edit by hand, unlike an issue file, which only ever passes through the codec.
function stampConfigSchemaVersion() {
  const config = readConfigObject();
  if (config === null || config.schema_version === SCHEMA_VERSION) return false;
  const { schema_version, ...rest } = config;
  writeFileSync(
    configPathOf(),
    JSON.stringify({ schema_version: SCHEMA_VERSION, ...rest }, null, 2) + "\n",
    "utf8"
  );
  return true;
}

function dumpIssues() {
  const issues = readAllIssues(projectDir).sort((a, b) => a.id.localeCompare(b.id));
  writeOk({ schema_version: readSchemaVersion(), issues });
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

// Helper: validate an array of tasks — the decomposition of the prose, one entry per step.
//
// One validator for both arrays, because they have the same shape and differ only in who may write
// them: `tasks` is the execution checklist, materialized by whoever takes the issue, and
// `validation.tasks` is the judgement checklist, born with it. What tells them apart is the role
// guard, and that lives in enforceRolePolicy, not here.
//
// `id` is a positive integer, unique inside its own array and stable: it is local and ordinal — the
// useful reference is "task 4" — and a GUID would make it unreadable in the one context where it is
// read. No cap on the number of entries, for the reason depends_on has none: a cap pushes a caller
// to merge real steps to make the payload fit.
function validateTasks(tasks, fieldName) {
  const allowed = ["id", "short_title", "full_description", "checked"];

  if (!Array.isArray(tasks)) {
    fail(
      `'${fieldName}' must be an array of { ${allowed.join(", ")} }. Pass [] to clear it.`,
      "INVALID_INPUT"
    );
  }

  const seen = new Set();

  tasks.forEach((entry, index) => {
    const where = `${fieldName}[${index}]`;

    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`'${where}' must be an object with ${allowed.join(", ")}.`, "INVALID_INPUT");
    }

    const unknown = Object.keys(entry).filter((f) => !allowed.includes(f));
    if (unknown.length > 0) {
      fail(
        `Unknown field(s) in '${where}': ${unknown.join(", ")}. Allowed fields: ${allowed.join(", ")}.`,
        "INVALID_INPUT"
      );
    }
    for (const field of allowed) {
      if (!hasProp(entry, field)) {
        fail(`'${where}.${field}' is required.`, "INVALID_INPUT");
      }
    }

    if (typeof entry.id !== "number" || !Number.isInteger(entry.id) || entry.id < 1) {
      fail(
        `'${where}.id' must be a positive integer: it is a local, ordinal reference, not a GUID.`,
        "INVALID_INPUT"
      );
    }
    if (seen.has(entry.id)) {
      fail(`'${fieldName}' lists id ${entry.id} more than once: an id must name one task.`, "INVALID_INPUT");
    }
    seen.add(entry.id);

    if (isNullOrWhitespace(entry.short_title)) {
      fail(`'${where}.short_title' must be a non-empty string.`, "INVALID_INPUT");
    }
    validateLength(`${where}.short_title`, entry.short_title, LIMITS.taskTitle);

    if (isNullOrWhitespace(entry.full_description)) {
      fail(`'${where}.full_description' must be a non-empty string.`, "INVALID_INPUT");
    }
    validateLength(`${where}.full_description`, entry.full_description, LIMITS.taskDescription);

    if (typeof entry.checked !== "boolean") {
      fail(`'${where}.checked' must be a boolean.`, "INVALID_INPUT");
    }
  });
}

// Helper: build the validation object as it gets STORED.
//
// Two jobs, and both exist so that a reader never has to tell a missing key from an empty list —
// the same reason depends_on and covers are materialized on insert:
//   1. an absent `tasks` becomes [];
//   2. on --update, a payload that does not name `tasks` inherits the ones already stored.
// (2) is not a nicety: the closing payload is {criteria, state}, and without it every closure would
// delete the checklist it has just judged. Clearing them stays possible with an explicit [].
// A null validation stays null: an issue with no criteria has no object to put tasks in.
function normalizeValidation(validation, existingValidation) {
  if (validation === null || validation === undefined) {
    return validation ?? null;
  }
  if (typeof validation !== "object" || Array.isArray(validation)) {
    return validation;
  }
  const inherited =
    existingValidation !== null &&
    existingValidation !== undefined &&
    typeof existingValidation === "object" &&
    !Array.isArray(existingValidation) &&
    Array.isArray(existingValidation.tasks)
      ? existingValidation.tasks
      : [];
  return {
    criteria: validation.criteria,
    tasks: hasProp(validation, "tasks") ? validation.tasks : inherited,
    state: validation.state,
  };
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

  const allowedFields = [
    "title",
    "description",
    "status",
    "validation",
    "tier",
    "depends_on",
    "covers",
    "tasks",
  ];
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

  // tasks: optional everywhere, absent reads as []. The decomposition of `description` at the grain
  // the agent works on; the prose stays where it is, untouched, next to it.
  if (hasProp(issue, "tasks")) {
    validateTasks(issue.tasks, "tasks");
  }

  // validation: must be null or a well-formed object { criteria, tasks, state (valid) }
  if (hasProp(issue, "validation") && issue.validation !== null) {
    const v = issue.validation;
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      fail("'validation' must be null or an object with 'criteria' and 'state'.", "INVALID_INPUT");
    }
    const allowedValidationFields = ["criteria", "state", "tasks"];
    const providedValidationFields = Object.keys(v);
    const unknownValidationFields = providedValidationFields.filter(
      (f) => !allowedValidationFields.includes(f)
    );
    if (unknownValidationFields.length > 0) {
      fail(
        `Unknown field(s) in 'validation' object: ${unknownValidationFields.join(", ")}. ` +
          `Allowed fields: ${allowedValidationFields.join(", ")}.`,
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

    // The validation tasks live INSIDE validation and not beside it: everything that concerns the
    // judgement of an issue lives here, guard included, and splitting the same notion across two
    // places in the schema would only make it easier to update one and forget the other.
    if (hasProp(v, "tasks")) {
      validateTasks(v.tasks, "validation.tasks");
    }
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
  // Checking a criterion that measures your own work is self-validation with a different syntax,
  // so it is refused for the same reason validation.state === "pass" is. A worker checks its own
  // execution tasks; the judgement ones belong to whoever judges.
  if (
    hasProp(payload, "validation") &&
    payload.validation !== null &&
    typeof payload.validation === "object" &&
    Array.isArray(payload.validation.tasks) &&
    payload.validation.tasks.some(
      (entry) => entry !== null && typeof entry === "object" && entry.checked === true
    )
  ) {
    fail(
      "Role 'worker' cannot check an entry of 'validation.tasks' (self-validation is forbidden). A " +
        "worker checks its own 'tasks'; the judgement ones belong to the verifier, exactly as " +
        "validation.state does.",
      "FORBIDDEN_ROLE"
    );
  }
}

// Helper: an issue in flight declares HOW it will be done, or it is not in flight.
//
// This is where "decided upstream" stops being an intention and becomes data. The agent that takes
// the issue is the one who knows the steps, and while they lived only in its session they died
// with it — which is the cost the two arrays exist to remove. A rule nobody enforces is the rule
// that was already being skipped.
function enforceTasksForProgress(status, tasks) {
  if (status !== "in_progress") {
    return;
  }
  if (Array.isArray(tasks) && tasks.length > 0) {
    return;
  }
  fail(
    "An issue cannot go to 'in_progress' with an empty 'tasks': whoever takes it materializes the " +
      "steps first, so the tracker keeps them when the session that held them ends.",
    "INVALID_INPUT"
  );
}

// Helper: the fingerprint of a decomposition — what the tasks SAY, not how far along they are.
//
// `checked` is deliberately out. Ticking a task off is progress, and since the tasks are aligned
// before every commit — the most frequent action of the workflow — a rule that asked for the flag
// on every tick would be answered with the flag on every call, which is how a guard stops meaning
// anything.
function decompositionOf(tasks) {
  return JSON.stringify(
    (Array.isArray(tasks) ? tasks : []).map((entry) => [
      entry?.id ?? null,
      entry?.short_title ?? null,
      entry?.full_description ?? null,
    ])
  );
}

// Helper: prose and its decomposition move together, or neither moves.
//
// They describe the same work at two grains, and letting one drift from the other would be worse
// than having no tasks at all: the verifier would measure one thing and the human would read
// another, and nothing would say so. Same philosophy with which the CLI already defends the DAG
// from cycles — impossible by construction, not discouraged in words.
//
// Two exemptions, and both exist so the flag does not become a reflex:
//   - a decomposition that does not exist yet cannot diverge, so the first materialization is free;
//   - on the validation side the rule holds only while state is "unknown", because at closure
//     `criteria` carries the evidence and not the contract, and a verifier writing evidence would
//     otherwise have to pass the flag every single time.
function enforcePairedUpdate(payload, existing, declaredUnchanged) {
  if (declaredUnchanged) {
    return;
  }

  const currentTasks = Array.isArray(existing.tasks) ? existing.tasks : [];
  if (currentTasks.length > 0) {
    const nextTasks = hasProp(payload, "tasks") ? payload.tasks : currentTasks;
    const proseMoved = hasProp(payload, "description") && payload.description !== existing.description;
    const tasksMoved = decompositionOf(nextTasks) !== decompositionOf(currentTasks);
    if (proseMoved !== tasksMoved) {
      fail(
        (proseMoved
          ? "'description' changed while 'tasks' stayed as they were."
          : "'tasks' changed while 'description' stayed as it was.") +
          " The prose and its decomposition describe the same work at two grains: update both, or " +
          "pass --decomposition-unchanged to declare that the other one still holds.",
        "INVALID_INPUT"
      );
    }
  }

  // Clearing validation takes criteria and tasks away together: paired by construction.
  if (!hasProp(payload, "validation") || payload.validation === null) {
    return;
  }
  const currentValidation =
    existing.validation !== null &&
    existing.validation !== undefined &&
    typeof existing.validation === "object" &&
    !Array.isArray(existing.validation)
      ? existing.validation
      : null;
  if (currentValidation === null || payload.validation.state !== "unknown") {
    return;
  }
  const currentValidationTasks = Array.isArray(currentValidation.tasks) ? currentValidation.tasks : [];
  if (currentValidationTasks.length === 0) {
    return;
  }
  const nextValidationTasks = hasProp(payload.validation, "tasks")
    ? payload.validation.tasks
    : currentValidationTasks;
  const criteriaMoved =
    JSON.stringify(payload.validation.criteria) !== JSON.stringify(currentValidation.criteria);
  const validationTasksMoved =
    decompositionOf(nextValidationTasks) !== decompositionOf(currentValidationTasks);
  if (criteriaMoved !== validationTasksMoved) {
    fail(
      (criteriaMoved
        ? "'validation.criteria' changed while 'validation.tasks' stayed as they were."
        : "'validation.tasks' changed while 'validation.criteria' stayed as they were.") +
        " Update both, or pass --decomposition-unchanged.",
      "INVALID_INPUT"
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
  if (storage.kind === "legacy" || storage.kind === "conflict" || existsSync(storage.issuesDir)) {
    fail(
      `'${storage.issuesDir}' or '${storage.jsonPath}' already exists. Remove it yourself if you want to start over; --init never overwrites.`,
      "ALREADY_EXISTS"
    );
  }
  // Read before the directory is created, so a config nobody can parse refuses while the project
  // is still untouched.
  readConfigObject();
  mkdirSync(storage.issuesDir, { recursive: true });
  stampConfigSchemaVersion();
  writeOk({ path: storage.issuesDir, created: true });
}

// Helper: compare two issue objects by VALUE, blind to key order. The resume check below reads one
// side off disk through the codec and builds the other in memory, and those two never agree on key
// order — an object comparison that cared about it would call every interrupted upgrade a conflict.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sameIssue(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

// Function to move a project from the legacy issues.json tracker to Markdown issue files at
// SCHEMA_VERSION, applying on the way the field migrations between the version the file declares
// (absent reads as version 0, see the SCHEMA_VERSION comment above) and this one.
//
// Schema 4 IS the file layout, which is why a JSON tracker that already declares 4 still moves:
// the version a file claims does not make it Markdown storage. And a project already ON Markdown
// storage is a no-op that writes nothing at all, so a second --upgrade in a row leaves every byte
// where it was.
//
// A file AHEAD of SCHEMA_VERSION — declaring a version this script does not know — is refused with
// SCHEMA_TOO_NEW and nothing is written: that is a script older than its data, and migrating it
// against a schema it does not know would silently degrade whatever the newer schema added.
//
// The write order is archive, issue files, config, then the removal of issues.json. It is the
// order that keeps a crash recoverable at every point: the legacy file is the last thing to go, so
// until it does there is always a complete copy of the tracker on disk. What a crash leaves behind
// is a project holding both — see resumeState() for how the next run tells that apart from two
// real trackers.
function upgradeTracker() {
  if (storage.kind === "markdown" || storage.kind === "empty") {
    const declared = readSchemaVersion();
    if (declared > SCHEMA_VERSION) {
      fail(
        `'${configPathOf()}' declares schema_version ${declared}, newer than the ${SCHEMA_VERSION} this ` +
          "script implements. This is an old copy of the harness plugin in front of newer data; " +
          "upgrade the plugin instead of running --upgrade.",
        "SCHEMA_TOO_NEW"
      );
    }
    // Nothing to migrate: the tracker is already one file per issue. The config is still brought
    // in line if it disagrees — a repair, not a migration — and stampConfigSchemaVersion() writes
    // nothing when it already agrees, which is what makes the second run in a row cost no bytes.
    stampConfigSchemaVersion();
    writeOk({ from: declared, to: SCHEMA_VERSION, migrated: 0 });
    return;
  }

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

  // A dry run of the whole write, in memory. A legacy record the codec cannot represent — a title
  // that is not a string, an id that is not a GUID, two ids sharing the eight characters that name
  // the file — has to stop the migration while the project is still whole. Discovering it halfway
  // through would leave a tracker split across two storages for a reason nobody asked for.
  const claimedFiles = new Map();
  for (const issue of migratedIssues) {
    serializeIssue(issue);
    const filePath = issuePath(projectDir, issue.id);
    const owner = claimedFiles.get(filePath);
    if (owner !== undefined && owner !== issue.id) {
      fail(
        `Issues '${owner}' and '${issue.id}' would both be stored as '${path.basename(filePath)}'.`,
        "ID_COLLISION"
      );
    }
    claimedFiles.set(filePath, issue.id);
  }

  // Both storages populated: either a previous run of this command died before it could remove
  // issues.json, or the project genuinely has two trackers. The first is resumable and the second
  // is not, and what tells them apart is whether every Markdown issue is one this migration would
  // have written, unchanged.
  const alreadyWritten = storage.kind === "conflict" ? readAllIssues(projectDir) : [];
  if (alreadyWritten.length > 0) {
    const expected = new Map(migratedIssues.map((issue) => [issue.id, issue]));
    for (const stored of alreadyWritten) {
      const target = expected.get(stored.id);
      if (target === undefined) {
        fail(
          `Markdown issue '${stored.id}' is not in '${issuesFilePath}': this is not an interrupted ` +
            "upgrade but two populated trackers. Reconcile them by hand; --upgrade will not choose for you.",
          "STORAGE_CONFLICT"
        );
      }
      if (!sameIssue(stored, target)) {
        fail(
          `Markdown issue '${stored.id}' differs from the one '${issuesFilePath}' would produce: this is ` +
            "not an interrupted upgrade but two populated trackers. Reconcile them by hand; --upgrade " +
            "will not choose for you.",
          "STORAGE_CONFLICT"
        );
      }
    }
  }

  // ---- Nothing above this line writes. Everything below does. ----

  const archivePath = resolveArchivePath(projectDir, nowTimestamp(), "upgrade-");
  mkdirSync(path.dirname(archivePath), { recursive: true });
  // Copied verbatim rather than re-serialized: this is the only surviving copy of the legacy file,
  // and the root metadata that has no home under Markdown storage — project, tags, status_legend —
  // lives on in it. A backup that normalised what it backed up would not be one.
  writeFileSync(archivePath, readFileSync(issuesFilePath, "utf8"), "utf8");

  // Created even when the tracker holds no issue at all: without it the project would read as
  // 'empty' rather than as a Markdown tracker that happens to be empty, and the next --upgrade
  // would have nothing to tell the two apart by.
  mkdirSync(storage.issuesDir, { recursive: true });
  for (const issue of migratedIssues) {
    writeIssue(projectDir, issue);
  }
  stampConfigSchemaVersion();
  rmSync(issuesFilePath, { force: true });

  writeOk({
    from: fromVersion,
    to: SCHEMA_VERSION,
    migrated: touched.filter(Boolean).length,
    issues: migratedIssues.length,
    archivePath,
    resumed: alreadyWritten.length > 0,
  });
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
// The prefix names what produced the archive: a compaction (none) or a storage migration
// ('upgrade-'). The two are read back by a human looking for one of them, and a directory where
// both are called the same makes that a guessing game.
function resolveArchivePath(projectDir, timestamp, prefix = "") {
  const dir = path.join(projectDir, HARNESS_DIR, ARCHIVE_DIR);
  const stamp = timestamp.replace(/:/g, "-");
  let candidate = path.join(dir, `${prefix}${stamp}.json`);
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = path.join(dir, `${prefix}${stamp}-${suffix}.json`);
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

  const issues = readAllIssues(projectDir);
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
  const archivePath = resolveArchivePath(projectDir, now);
  // Project-relative and with forward slashes: this string is what the block issue carries as
  // evidence, and issues.json is the one file the harness shares through the repository. An
  // absolute path from one clone means nothing in another.
  const archiveRelPath = `${HARNESS_DIR}/${ARCHIVE_DIR}/${path.basename(archivePath)}`;

  // The ORIGINAL objects, as read off disk and not rebuilt: an archive that normalised its records
  // would be an archive of what this version of the script thinks an issue looks like, not of what
  // was actually written.
  const archivedIssues = payload.blocks.flatMap((block) => block.issue_ids.map((id) => byId.get(id)));

  const archiveRecord = {
    schema_version: readSchemaVersion(),
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
    // A block summarises closed work: there is nothing left to execute and nothing left to judge.
    // The originals keep their own tasks, whole, inside the archive.
    tasks: [],
    validation: {
      tasks: [],
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

  // Write order is not arbitrary: the archive first, issues.json second. A failure while writing
  // the archive leaves the tracker exactly as it was and loses nothing; the reverse order would
  // put a window between "the issues are gone" and "the copy exists".
  // Recursive, so it creates .harness/ too when this is the first thing the project writes there.
  mkdirSync(path.dirname(archivePath), { recursive: true });
  writeFileSync(archivePath, JSON.stringify(archiveRecord, null, 2) + "\n", "utf8");
  for (const id of archivedIds) {
    deleteIssueFile(projectDir, id);
  }
  for (const issue of blockIssues) {
    writeIssue(projectDir, issue);
  }

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
    "node issue-manager.mjs --dump",
    "node issue-manager.mjs --insert (--issue-data '<json>' | --issue-data-file <path>)",
    "node issue-manager.mjs --update --issue-id <id> (--issue-data '<json>' | --issue-data-file <path>)",
    "                        [--decomposition-unchanged]",
    "node issue-manager.mjs --delete --issue-id <id>",
    "node issue-manager.mjs --init",
    "node issue-manager.mjs --upgrade",
    "node issue-manager.mjs --compact (--issue-data '<json>' | --issue-data-file <path>)",
    "",
    "Project resolution:",
    "  --project-dir <path>  project directory (default: the current directory).",
    "  Markdown issues live in .harness/issues; one installed copy serves every project.",
    "  A project with neither Markdown issues nor legacy JSON reads as an empty tracker.",
    "  The first insert creates .harness/issues; --init creates it explicitly.",
    "",
    "Output contract (stdout is always one line of JSON, except for this help text):",
    '  success : {"ok":true,"data":<payload>}                       exit code 0',
    '  failure : {"ok":false,"error":"<msg>","code":"<CODE>"}  exit code 1',
    "Nothing is written to stderr: pipe stdout to JSON.parse in both cases.",
    "",
    "Error codes: INVALID_ID, INVALID_STATUS, INVALID_STATE, INVALID_TIER, INVALID_DEPENDENCY,",
    "             INVALID_INPUT, INVALID_JSON, LIMIT_EXCEEDED, NOT_FOUND, FILE_NOT_FOUND,",
    "             MISSING_ARGS, UNKNOWN_COMMAND, FORBIDDEN_ROLE, ALREADY_EXISTS, SCHEMA_TOO_NEW,",
    "             STORAGE_NOT_MIGRATED, STORAGE_CONFLICT",
    "",
    "Role guard: when env var HARNESS_ROLE=worker, --insert/--update requests that set",
    "status=done, validation.state=pass, or check an entry of validation.tasks are rejected with",
    "FORBIDDEN_ROLE (no self-validation). A worker may still set status up to in_review,",
    "validation.state up to unknown, and check its own 'tasks'.",
    "--compact is refused outright under that role: every block it writes is a done/pass record.",
    "",
    "An issue cannot go to status=in_progress with an empty 'tasks': whoever takes it materializes",
    "the steps first, so the tracker keeps them when the session that held them ends.",
    "",
    "data payload per command:",
    "  --get       : the issue object",
    "  --get-all   : { totalCount, page, pageSize, issues: [...] }",
    "                totalCount/issues are counted AFTER the --status filter, which defaults to",
    "                backlog when --status is omitted: a bare --get-all does not return the whole",
    "                tracker, only its backlog slice. Pass --status explicitly to see another state.",
    "  --dump      : { schema_version: 4, issues: [...] } — every issue, ascending by id",
    "  --insert    : the created issue object (read .data.id for the new GUID)",
    "  --update    : the updated issue object",
    "  --delete    : { id, deleted }",
    "  --init      : { path, created: true } — creates .harness/issues. If .harness/config.json",
    "                already exists, it stamps schema_version: 4 there; it never creates config.",
    "                Fails with ALREADY_EXISTS if Markdown storage or legacy JSON already exists.",
    "  --upgrade   : { from, to, migrated, issues, archivePath, resumed } — moves a",
    "                legacy issues.json tracker to Markdown issue files at SCHEMA_VERSION, applying",
    "                on the way the field migrations between the version the file declares (absent",
    "                reads as 0) and this one. Those add new fields with their default (0->1 materializes",
    "                depends_on: [] where missing, 1->2 does the same with covers: [], 2->3 with",
    "                tasks: [] and, on the issues that carry a validation object,",
    "                validation.tasks: []); they never touch or remove an existing value.",
    "                In order: issues.json is copied verbatim into",
    "                .harness/archive/upgrade-<timestamp>.json, one file per issue is written under",
    "                .harness/issues, schema_version is stamped into .harness/config.json when that",
    "                file exists (it is never created), and issues.json is removed last. Nothing is",
    "                written until every issue has been migrated and serialized in memory: a",
    "                refusal leaves the project exactly as it was.",
    "                Schema 4 IS the file layout, so a JSON tracker already declaring 4 still moves;",
    "                a project already on Markdown storage returns migrated: 0 and is NOT rewritten.",
    "                A project holding BOTH is an upgrade that was interrupted: it is resumed when",
    "                every Markdown issue matches, field for field, the one issues.json would",
    "                produce, and refused with STORAGE_CONFLICT when any of them diverges or is",
    "                unknown to the JSON — that is two trackers, not one interrupted migration.",
    "                A file declaring a schema_version ABOVE SCHEMA_VERSION fails with",
    "                SCHEMA_TOO_NEW and writes nothing: that is an old script in front of newer",
    "                data. Neither --insert nor --update ever runs a migration on your behalf.",
    "  --compact   : { archivePath, removed, blocks: [ { id, title, archivedCount } ] } — shrinks",
    "                Markdown issues without losing history. Takes the groupings ALREADY DECIDED by the",
    "                caller, as { blocks: [ { title, description, issue_ids } ] }; it groups",
    "                nothing itself. Every id must exist and be 'done', no id in two blocks, no",
    "                empty block, title/description within the usual limits. Refused with",
    "                INVALID_DEPENDENCY, listing the ids that point, when a LIVE issue still",
    "                declares an archived id in depends_on: unlink first, this command never",
    "                rewrites an issue you did not name. On success the original issue objects are",
    "                written WHOLE to <project>/.harness/archive/<timestamp>.json together with the",
    "                schema_version they were stored under, removed from Markdown storage, and replaced",
    "                by one issue per block (status done, validation.state pass, criteria carrying",
    "                the archive path and the id + title of every issue covered). The archive is",
    "                never read back: --get and --get-all see Markdown issues only. Any",
    "                refusal writes nothing at all — neither Markdown storage nor the archive.",
    "",
    "Passing the payload:",
    "  --issue-data-file <path>  reads the JSON from a file — no shell quoting/escaping",
    "  --issue-data '<json>'     inline JSON; mutually exclusive with --issue-data-file",
    "",
    "--decomposition-unchanged (on --update only): declares that the prose and its tasks still",
    "  describe the same steps, so one may move without the other. Without it, changing",
    "  'description' without 'tasks' — or 'validation.criteria' without 'validation.tasks' while",
    "  state is 'unknown' — is rejected with INVALID_INPUT. Three cases never need the flag:",
    "  ticking a task off (progress is not a new decomposition), materializing tasks for the first",
    "  time, and closing an issue, where criteria carries the evidence instead of the contract.",
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
    `  tasks        : array of { id, short_title (max ${LIMITS.taskTitle} chars), full_description (max ${LIMITS.taskDescription}), checked }`,
    "                 the execution steps; absent reads as [], [] clears it; ids are unique positive",
    "                 integers, and the number of tasks is not capped",
    "  validation   : null OR { criteria, tasks, state: unknown|pass|fail }",
    `                 state=unknown : criteria is an array of at most ${LIMITS.criteriaCount} strings of ${LIMITS.criterion} characters`,
    "                 state=pass|fail : criteria carries the verification evidence — string or array, uncapped",
    "                 tasks : the judgement steps, same shape as the ones above; an --update that",
    "                         does not name them keeps the stored ones instead of clearing them",
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
  const issue = readIssue(projectDir, issueId);
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

  let issues = readAllIssues(projectDir);

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

  const dependsOn = hasProp(newIssue, "depends_on") ? newIssue.depends_on : [];
  if (dependsOn.length > 0) {
    validateDependencyGraph(dependsOn, readAllIssues(projectDir), null);
  }
  enforceTasksForProgress(newIssue.status, hasProp(newIssue, "tasks") ? newIssue.tasks : []);

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
    // Always an array, never absent: status-cli reads this on every issue it renders,
    // and a missing key would push that check onto every reader instead of settling it here.
    tasks: hasProp(newIssue, "tasks") ? newIssue.tasks : [],
    validation: normalizeValidation(hasProp(newIssue, "validation") ? newIssue.validation : null, null),
    created_at: now,
    updated_at: now,
  };

  writeIssue(projectDir, storedIssue);
  writeOk(storedIssue);
}

// 5. Function to update an existing issue by ID
// Merge semantics: a field absent from the payload keeps its current value.
function updateIssue(issueId, issueData, declaredUnchanged = false) {
  validateIssueId(issueId);
  const updatedIssue = parseIssueData(issueData);

  validateIssueInput(updatedIssue, true);
  enforceRolePolicy(updatedIssue);

  const existing = readIssue(projectDir, issueId);
  if (!existing) {
    fail(`Issue with ID '${issueId}' not found.`, "NOT_FOUND");
  }

  enforcePairedUpdate(updatedIssue, existing, declaredUnchanged);

  const mergedTasks = hasProp(updatedIssue, "tasks")
    ? updatedIssue.tasks
    : Array.isArray(existing.tasks)
      ? existing.tasks
      : [];

  // The guard is on the TRANSITION — a payload that asks for in_progress — not on the resulting
  // state. Reading the merged status instead would refuse every unrelated update to an issue
  // already in flight without tasks, including the ones written before the field existed: the
  // tracker would hold records that can no longer be edited at all, which is not what "declare the
  // steps before you start" means. The tasks are read from the merge, though, so an issue that
  // already carries them starts without resending them.
  if (hasProp(updatedIssue, "status")) {
    enforceTasksForProgress(updatedIssue.status, mergedTasks);
  }

  // The graph checks need the tracker as stored, but an omitted or unchanged dependency array
  // cannot introduce a cycle, so only an actual edge change reads the full issue store.
  const dependsOn = hasProp(updatedIssue, "depends_on")
    ? updatedIssue.depends_on
    : Array.isArray(existing.depends_on) ? existing.depends_on : [];
  const existingDependsOn = Array.isArray(existing.depends_on) ? existing.depends_on : [];
  const dependenciesChanged =
    dependsOn.length !== existingDependsOn.length ||
    dependsOn.some((dependency, index) => dependency !== existingDependsOn[index]);
  if (hasProp(updatedIssue, "depends_on") && dependenciesChanged) {
    validateDependencyGraph(dependsOn, readAllIssues(projectDir), issueId);
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
    // Same merge as covers: an issue written before this field has no key at all, so the merge
    // materialises the empty array rather than carrying an undefined into the stored object.
    tasks: mergedTasks,
    // The existing validation is passed along even when the payload replaces it: that is what lets
    // a closing {criteria, state} keep the tasks it was judged against instead of dropping them.
    validation: normalizeValidation(
      hasProp(updatedIssue, "validation") ? updatedIssue.validation : existing.validation,
      existing.validation ?? null
    ),
    created_at: existing.created_at,
    updated_at: nowTimestamp(),
  };

  writeIssue(projectDir, storedIssue);
  writeOk(storedIssue);
}

// 6. Function to delete an issue by ID
function deleteIssue(issueId) {
  validateIssueId(issueId);
  const issues = readAllIssues(projectDir);

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

  deleteIssueFile(projectDir, issueId);
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
      dump: { type: "boolean" },
      insert: { type: "boolean" },
      update: { type: "boolean" },
      delete: { type: "boolean" },
      init: { type: "boolean" },
      upgrade: { type: "boolean" },
      compact: { type: "boolean" },
      "decomposition-unchanged": { type: "boolean" },
      "issue-id": { type: "string" },
      "issue-data": { type: "string" },
      "issue-data-file": { type: "string" },
      "project-dir": { type: "string" },
      order: { type: "string", default: "asc" },
      page: { type: "string", default: "0" },
      "page-size": { type: "string", default: "10" },
      // Deliberate default, not an oversight: every caller shipped in this repo that reads
      // --get-all for actual workflow decisions (skills/harness/SKILL.md, skills/issue/SKILL.md,
      // skills/verify/SKILL.md)
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

  projectDir = resolveProjectDir(values["project-dir"]);
  issuesFilePath = path.join(projectDir, "issues.json");
  storage = classifyStorage(projectDir);

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

  if (values.get || values["get-all"] || values.dump || values.insert || values.update || values.delete || values.compact) {
    requireMarkdownStorage();
  }

  // 8. Switch case to handle different tasks based on the provided argument
  if (values.get) {
    if (!issueId) {
      fail("Please provide an issue ID to retrieve.", "MISSING_ARGS");
    }
    getIssue(issueId);
  } else if (values["get-all"]) {
    getAllIssues({ order, page, pageSize, status });
  } else if (values.dump) {
    dumpIssues();
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
    updateIssue(issueId, issueData, values["decomposition-unchanged"] === true);
  } else if (values.delete) {
    if (!issueId) {
      fail("Please provide an issue ID to delete.", "MISSING_ARGS");
    }
    deleteIssue(issueId);
  } else if (values.init) {
    initTracker();
  } else if (values.upgrade) {
    // The one command that must NOT go through requireMarkdownStorage(): a tracker that has not
    // been migrated is precisely its input, and a conflict is the state it knows how to resume.
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
  } else if (err instanceof StorageError) {
    writeFail(err.message, err.code);
  } else {
    writeFail(`Unexpected error: ${err && err.message ? err.message : String(err)}`, "ERROR");
  }
}
