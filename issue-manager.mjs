#!/usr/bin/env node
// Used from AI to get, insert, update, and delete issues in the issues.json file. This script can
// include tasks such as retrieving issue details, creating new issues, updating existing issues,
// and deleting issues.

// Example usage:
// node issue-manager.mjs --help
// node issue-manager.mjs --get --issue-id <issueId>
// node issue-manager.mjs --get-all --order desc --page 0 --page-size 10 --status backlog
// node issue-manager.mjs --insert --issue-data-file .\new-issue.json
// node issue-manager.mjs --update --issue-id <issueId> --issue-data '<json>'
// node issue-manager.mjs --delete --issue-id <issueId>

// Machine-readable contract (stdout is always a single line of JSON):
//   success -> {"ok":true,"data":<payload>}                      exit code 0
//   failure -> {"ok":false,"error":"<message>","code":"<CODE>"}  exit code 1
// Nothing is ever written to stderr, so `script | ConvertFrom-Json`/`JSON.parse` works for both
// outcomes.
// Exception: --help prints plain text.
//
// Error codes: INVALID_ID, INVALID_STATUS, INVALID_STATE, INVALID_INPUT, INVALID_JSON,
//              NOT_FOUND, FILE_NOT_FOUND, MISSING_ARGS, UNKNOWN_COMMAND.

// Every issue in the issues.json file should have the following structure:
// {
//     "id": "<guid>",
//     "title": "<string>",
//     "description": "<string>",
//     "status": "<backlog|in_progress|blocked|done>",
//     "validation": { "criteria": "<string>", "state": "<unknown|pass|fail>" }|null,
//     "created_at": "<datetime>",
//     "updated_at": "<datetime>"
// }
//
// validation.criteria: set at creation time to define acceptance criteria (state="unknown");
// updated at closure with the verification evidence (state="pass"|"fail").
// validation can be null if no criteria are defined.
//
// --insert requires the full payload. --update merges: omitted fields keep their current value,
// while an explicit "validation": null clears the validation object.

import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const issuesFilePath = path.join(__dirname, "issues.json");

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

// Helper: validate the provided status value
function validateStatus(status) {
  const validStatuses = ["backlog", "in_progress", "blocked", "done"];
  if (!validStatuses.includes(status)) {
    fail(
      `Invalid status value '${status}'. Valid values are: backlog, in_progress, blocked, done.`,
      "INVALID_STATUS"
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

  const allowedFields = ["title", "description", "status", "validation"];
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
  } else if (!partial) {
    fail("'title' is required and must be a non-empty string.", "INVALID_INPUT");
  }

  // Required non-empty string: description
  if (hasProp(issue, "description")) {
    if (isNullOrWhitespace(issue.description)) {
      fail("'description' must be a non-empty string.", "INVALID_INPUT");
    }
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

  // validation: must be null or a well-formed object { criteria (non-empty), state (valid) }
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
    if (!hasProp(v, "criteria") || isNullOrWhitespace(v.criteria)) {
      fail(
        "'validation.criteria' is required and must be a non-empty string when 'validation' is provided.",
        "INVALID_INPUT"
      );
    }
    if (!hasProp(v, "state") || isNullOrWhitespace(v.state)) {
      fail("'validation.state' is required when 'validation' is provided.", "INVALID_INPUT");
    }
    validateState(v.state);
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

// Helper: load issues.json and return the root data object
function readIssuesFile() {
  if (!existsSync(issuesFilePath)) {
    fail("issues.json file not found. Please ensure it exists.", "FILE_NOT_FOUND");
  }
  const raw = readFileSync(issuesFilePath, "utf8");
  return JSON.parse(raw);
}

// Helper: save the root data object back to issues.json, updating last_updated.
// Written atomically: a temp file in the same directory is written first, then renamed over the
// target, so a crash mid-write never leaves issues.json truncated or corrupt.
function writeIssuesFile(data) {
  data.last_updated = nowTimestamp();
  const serialized = JSON.stringify(data, null, 2);
  const tmpPath = path.join(__dirname, `.issues.json.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmpPath, serialized, "utf8");
  renameSync(tmpPath, issuesFilePath);
}

// 1. Function to display help information
function showHelp() {
  const lines = [
    "Usage:",
    "node issue-manager.mjs --help",
    "node issue-manager.mjs --get --issue-id <id>",
    "node issue-manager.mjs --get-all [--order asc|desc] [--page 0] [--page-size 10] [--status backlog|in_progress|blocked|done]",
    "node issue-manager.mjs --insert (--issue-data '<json>' | --issue-data-file <path>)",
    "node issue-manager.mjs --update --issue-id <id> (--issue-data '<json>' | --issue-data-file <path>)",
    "node issue-manager.mjs --delete --issue-id <id>",
    "",
    "Output contract (stdout is always one line of JSON, except for this help text):",
    '  success : {"ok":true,"data":<payload>}                       exit code 0',
    '  failure : {"ok":false,"error":"<msg>","code":"<CODE>"}  exit code 1',
    "Nothing is written to stderr: pipe stdout to JSON.parse in both cases.",
    "",
    "Error codes: INVALID_ID, INVALID_STATUS, INVALID_STATE, INVALID_INPUT, INVALID_JSON,",
    "             NOT_FOUND, FILE_NOT_FOUND, MISSING_ARGS, UNKNOWN_COMMAND",
    "",
    "data payload per command:",
    "  --get       : the issue object",
    "  --get-all   : { totalCount, page, pageSize, issues: [...] }",
    "  --insert    : the created issue object (read .data.id for the new GUID)",
    "  --update    : the updated issue object",
    "  --delete    : { id, deleted }",
    "",
    "Passing the payload:",
    "  --issue-data-file <path>  reads the JSON from a file — no shell quoting/escaping",
    "  --issue-data '<json>'     inline JSON; mutually exclusive with --issue-data-file",
    "",
    "Allowed input fields for --insert/--update: title, description, status, validation",
    "  title        : non-empty string",
    "  description  : non-empty string",
    "  status       : backlog | in_progress | blocked | done",
    "  validation   : null OR { criteria: <non-empty string>, state: unknown|pass|fail }",
    "                 Set criteria at creation (state=unknown); update with evidence at closure (state=pass|fail).",
    "--insert requires title, description and status.",
    '--update merges: omitted fields keep their current value; an explicit "validation": null clears it.',
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

  const data = readIssuesFile();
  const now = nowTimestamp();

  // Build the stored object with auto-managed fields; never trust caller-supplied id/timestamps
  const storedIssue = {
    id: generateNewId(),
    title: newIssue.title,
    description: newIssue.description,
    status: newIssue.status,
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

  const data = readIssuesFile();
  const issues = Array.isArray(data.issues) ? [...data.issues] : [];

  const issueIndex = issues.findIndex((i) => i.id === issueId);
  if (issueIndex === -1) {
    fail(`Issue with ID '${issueId}' not found.`, "NOT_FOUND");
  }

  const existing = issues[issueIndex];

  // Rebuild the stored object: preserve id + created_at; set new updated_at
  const storedIssue = {
    id: issueId,
    title: hasProp(updatedIssue, "title") ? updatedIssue.title : existing.title,
    description: hasProp(updatedIssue, "description") ? updatedIssue.description : existing.description,
    status: hasProp(updatedIssue, "status") ? updatedIssue.status : existing.status,
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
      "issue-id": { type: "string" },
      "issue-data": { type: "string" },
      "issue-data-file": { type: "string" },
      order: { type: "string", default: "asc" },
      page: { type: "string", default: "0" },
      "page-size": { type: "string", default: "10" },
      status: { type: "string", default: "backlog" },
    },
  });

  if (values.help) {
    showHelp();
    return;
  }

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
