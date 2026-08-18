import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The five states an issue can be in. It lives HERE, and issue-manager imports it, because this is
// the module that has to spell one into every file name: two lists of the same five strings is the
// shape of a bug that shows up as a file nobody can read.
export const STATUSES = ["backlog", "in_progress", "in_review", "blocked", "done"];

// `<status>-<first eight characters of the id>.md`.
//
// The status is in the name because a directory listing is the cheapest view of a tracker there is,
// and one of bare hex ids answers nothing: not what state the work is in, not how much of it sits
// in each state. Alphabetical order groups by status — it does not put the states in workflow
// order, and a numeric prefix that did would encode a ranking nobody agreed on.
//
// The cost is real and paid below: the path stops being a pure function of the id, so readers and
// deleters have to FIND the file and writers have to remove the name the issue used to have.
const ISSUE_FILE_RE = new RegExp(`^(${STATUSES.join("|")})-([0-9a-f]{8})\\.md$`, "i");

export class StorageError extends Error {
  constructor(message, code = "INVALID_INPUT") {
    super(message);
    this.code = code;
  }
}

function fail(message, code = "INVALID_INPUT") {
  throw new StorageError(message, code);
}

export function shortId(id) {
  if (typeof id !== "string" || !GUID_RE.test(id)) {
    fail(`Invalid issue id '${id}'.`);
  }
  return id.slice(0, 8).toLowerCase();
}

function statusOf(status) {
  if (!STATUSES.includes(status)) {
    fail(`Invalid issue status '${status}'. Valid values are: ${STATUSES.join(", ")}.`);
  }
  return status;
}

function encodeString(value) {
  const ambiguous = /[:#\n\t"\[\]{}]|^[!&*]|^\s|\s$|^(?:true|false|null|-?\d+)$/i;
  return value === "" || ambiguous.test(value) ? JSON.stringify(value) : value;
}

function encodeScalar(value) {
  if (typeof value === "string") return encodeString(value);
  if (typeof value === "boolean" || value === null) return String(value);
  if (Number.isInteger(value)) return String(value);
  fail("Frontmatter supports only strings, integers, booleans, and null scalars.");
}

function encodeSequence(items, indent) {
  const prefix = " ".repeat(indent);
  return items
    .map((item) => {
      if (Array.isArray(item)) {
        fail("Nested sequence values are not supported.");
      }
      if (item !== null && typeof item === "object") {
        return `${prefix}-\n${encodeMapping(item, indent + 2)}`;
      }
      return `${prefix}- ${encodeScalar(item)}`;
    })
    .join("\n");
}

function encodeValue(key, value, indent) {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${prefix}${key}: []`;
    if ((key === "depends_on" || key === "covers") && value.every((item) => item === null || typeof item !== "object")) {
      return `${prefix}${key}: [${value.map(encodeScalar).join(", ")}]`;
    }
    return `${prefix}${key}:\n${encodeSequence(value, indent + 2)}`;
  }
  if (value !== null && typeof value === "object") {
    return `${prefix}${key}:\n${encodeMapping(value, indent + 2)}`;
  }
  return `${prefix}${key}: ${encodeScalar(value)}`;
}

function encodeMapping(value, indent) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("A frontmatter mapping must be an object.");
  }
  return Object.entries(value)
    .map(([key, entry]) => encodeValue(key, entry, indent))
    .join("\n");
}

export function serializeIssue(issue) {
  if (issue === null || typeof issue !== "object" || Array.isArray(issue)) {
    fail("An issue must be an object.");
  }
  const { description, ...frontmatter } = issue;
  if (typeof description !== "string") fail("An issue description must be a string.");
  if (typeof issue.title !== "string") fail("An issue title must be a string.");
  return `---\n${encodeMapping(frontmatter, 0)}\n---\n\n# ${issue.title.replace(/[\r\n]+/g, " ")}\n\n${description}\n`;
}

function withoutQuotedStrings(line) {
  let result = "";
  let quoted = false;
  let escaped = false;
  for (const char of line) {
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        quoted = false;
      }
      result += " ";
    } else if (char === '"') {
      quoted = true;
      result += " ";
    } else {
      result += char;
    }
  }
  return result;
}

function validateLines(lines, sourcePath) {
  for (const line of lines) {
    if (line.length === 0) fail(`Blank frontmatter line in '${sourcePath}'.`);
    const indent = line.match(/^ */)[0].length;
    if (/^ *\t/.test(line)) fail(`Tabs cannot indent frontmatter in '${sourcePath}'.`);
    if (indent % 2 !== 0) fail(`Frontmatter indentation must use two spaces in '${sourcePath}'.`);
    const unquoted = withoutQuotedStrings(line);
    if (/(^|\s)%YAML|^\s*<<:/m.test(unquoted)) {
      fail(`Unsupported YAML construct in '${sourcePath}'.`);
    }
  }
}

function splitFlowScalars(value, sourcePath) {
  const inner = value.slice(1, -1).trim();
  if (inner === "") return [];
  const parts = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      parts.push(inner.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted) fail(`Unterminated quoted string in '${sourcePath}'.`);
  parts.push(inner.slice(start).trim());
  if (parts.some((part) => part === "")) fail(`Invalid flow sequence in '${sourcePath}'.`);
  return parts;
}

function parseScalar(value, sourcePath, allowFlowSequence = false) {
  if (value === "[]") return [];
  if (value.startsWith("[") || value.endsWith("]")) {
    if (!allowFlowSequence || !value.startsWith("[") || !value.endsWith("]")) {
      fail(`Unsupported flow structure in '${sourcePath}'.`);
    }
    return splitFlowScalars(value, sourcePath).map((entry) => {
      if (/[\[\]{}]/.test(entry)) fail(`Unsupported nested flow structure in '${sourcePath}'.`);
      return parseScalar(entry, sourcePath);
    });
  }
  if (value.startsWith('"')) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      fail(`Invalid quoted string in '${sourcePath}'.`);
    }
    if (typeof parsed !== "string") fail(`Quoted scalar must be a string in '${sourcePath}'.`);
    return parsed;
  }
  if (/^(?:[!&*]|%YAML|<<:)/.test(value)) {
    fail(`Unsupported YAML construct in '${sourcePath}'.`);
  }
  if (value.includes('"') || /[:#\[\]{}]/.test(value)) {
    fail(`Unsupported scalar syntax in '${sourcePath}'.`);
  }
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.length === 0 || /^\s|\s$/.test(value)) fail(`Invalid plain scalar in '${sourcePath}'.`);
  return value;
}

function lineAt(lines, index, indent) {
  const line = lines[index];
  return line !== undefined && line.match(/^ */)[0].length === indent;
}

function parseMapping(lines, start, indent, sourcePath) {
  const mapping = {};
  let index = start;
  while (index < lines.length && lineAt(lines, index, indent)) {
    const content = lines[index].slice(indent);
    if (content === "-" || content.startsWith("- ")) break;
    const match = /^([A-Za-z_][A-Za-z0-9_]*):(.*)$/.exec(content);
    if (!match) fail(`Invalid mapping entry in '${sourcePath}'.`);
    const [, key, rawValue] = match;
    if (Object.hasOwn(mapping, key)) fail(`Duplicate key '${key}' in '${sourcePath}'.`);
    if (rawValue === "") {
      const childStart = index + 1;
      if (!lineAt(lines, childStart, indent + 2)) {
        fail(`Missing nested value for '${key}' in '${sourcePath}'.`);
      }
      const childContent = lines[childStart].slice(indent + 2);
      const parsed = childContent === "-" || childContent.startsWith("- ")
        ? parseSequence(lines, childStart, indent + 2, sourcePath)
        : parseMapping(lines, childStart, indent + 2, sourcePath);
      mapping[key] = parsed.value;
      index = parsed.index;
      continue;
    }
    if (!rawValue.startsWith(" ") || rawValue.startsWith("  ")) {
      fail(`A mapping scalar needs one space after ':' in '${sourcePath}'.`);
    }
    mapping[key] = parseScalar(rawValue.slice(1), sourcePath, key === "depends_on" || key === "covers");
    index += 1;
  }
  return { value: mapping, index };
}

function parseSequence(lines, start, indent, sourcePath) {
  const sequence = [];
  let index = start;
  while (index < lines.length && lineAt(lines, index, indent)) {
    const content = lines[index].slice(indent);
    if (content === "-") {
      const childStart = index + 1;
      if (!lineAt(lines, childStart, indent + 2)) fail(`Missing sequence value in '${sourcePath}'.`);
      const childContent = lines[childStart].slice(indent + 2);
      if (childContent === "-" || childContent.startsWith("- ")) {
        fail(`Nested sequence values are not supported in '${sourcePath}'.`);
      }
      const parsed = parseMapping(lines, childStart, indent + 2, sourcePath);
      sequence.push(parsed.value);
      index = parsed.index;
      continue;
    }
    if (!content.startsWith("- ")) break;
    sequence.push(parseScalar(content.slice(2), sourcePath));
    index += 1;
  }
  if (sequence.length === 0) fail(`Empty block sequence in '${sourcePath}'.`);
  return { value: sequence, index };
}

function parseFrontmatter(frontmatter, sourcePath) {
  const lines = frontmatter.split("\n");
  validateLines(lines, sourcePath);
  const parsed = parseMapping(lines, 0, 0, sourcePath);
  if (parsed.index !== lines.length || Object.keys(parsed.value).length === 0) {
    fail(`Invalid frontmatter in '${sourcePath}'.`);
  }
  return parsed.value;
}

function parseDescription(body) {
  let description = body.replace(/^\n+/, "");
  if (description.startsWith("# ")) {
    const newline = description.indexOf("\n");
    description = newline === -1 ? "" : description.slice(newline + 1).replace(/^\n/, "");
  }
  return description.endsWith("\n") ? description.slice(0, -1) : description;
}

export function parseIssue(markdown, sourcePath) {
  if (typeof markdown !== "string") fail(`Issue '${sourcePath}' must contain text.`);
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) fail(`Issue '${sourcePath}' must start with frontmatter.`);
  const closingOffset = normalized.indexOf("\n---\n", 4);
  if (closingOffset === -1) fail(`Issue '${sourcePath}' has no closing frontmatter delimiter.`);
  const frontmatter = normalized.slice(4, closingOffset);
  const issue = parseFrontmatter(frontmatter, sourcePath);
  return { ...issue, description: parseDescription(normalized.slice(closingOffset + 5)) };
}

function issuesDirectory(projectDir) {
  return path.join(projectDir, ".harness", "issues");
}

// Where an issue in THIS state belongs. For finding one whose state you do not know, see
// findIssueFile below: that is the asymmetry the status in the name buys and costs.
export function issuePath(projectDir, id, status) {
  return path.join(issuesDirectory(projectDir), `${statusOf(status)}-${shortId(id)}.md`);
}

// The file that currently holds this issue, or null. A directory scan, not a computed path: the
// caller knows the id and has no reason to know the state.
//
// More than one match is the half-finished rename a crash leaves behind — see writeIssue. It is
// refused here rather than resolved by picking one, because either file could be the newer, and a
// reader that guessed would hand back a stale issue with no sign that it did.
function findIssueFile(projectDir, id) {
  const dir = issuesDirectory(projectDir);
  const short = shortId(id);
  if (!existsSync(dir)) return null;
  // Deliberately looser than the file-name format: a file that carries THIS id must be found even
  // when its name is wrong, so the read can refuse it by name instead of answering NOT_FOUND about
  // an issue that is sitting right there. Bare `<shortid>.md` is matched for the same reason —
  // that is what the naming before this one produced. A file belonging to no id in the query is
  // still untouched: an unrelated broken file never breaks a read of something else.
  const matches = readdirSync(dir).filter((entry) => {
    const lower = entry.toLowerCase();
    return lower === `${short}.md` || lower.endsWith(`-${short}.md`);
  });
  if (matches.length > 1) {
    fail(
      `Issue '${id}' is stored in more than one file (${matches.sort().join(", ")}). That is what an ` +
        "interrupted status change leaves behind: keep the one that is right and remove the other.",
      "ID_COLLISION"
    );
  }
  return matches.length === 1 ? path.join(dir, matches[0]) : null;
}

export function classifyStorage(projectDir) {
  const issuesDir = issuesDirectory(projectDir);
  const jsonPath = path.join(projectDir, "issues.json");
  const hasJson = existsSync(jsonPath);
  const hasIssuesDir = existsSync(issuesDir);
  const hasMarkdown = hasIssuesDir && readdirSync(issuesDir).some((entry) => entry.endsWith(".md"));
  const kind = hasJson && hasMarkdown ? "conflict" : hasJson ? "legacy" : hasIssuesDir ? "markdown" : "empty";
  return { kind, jsonPath, issuesDir };
}

// One name check, shared by the single read and the full one. A guard that only fires when
// somebody happens to list the whole tracker is a guard that lets a single read hand back an issue
// whose file name says something else — and the name is the half people read at a glance and
// believe, so it is the half that can never be allowed to lie.
//
// It refuses rather than repairing. Rewriting the name would be choosing the frontmatter as the
// truth without knowing which of the two the last edit meant to change; these are plain files in a
// directory, and saying which name is expected is enough for a person to fix it.
function validateIssueFileName(entry, issue) {
  const match = ISSUE_FILE_RE.exec(entry);
  if (match === null || match[2].toLowerCase() !== shortId(issue.id)) {
    fail(`Issue file '${entry}' does not match its id: expected '${issue.status}-${shortId(issue.id)}.md'.`);
  }
  if (match[1].toLowerCase() !== issue.status) {
    fail(
      `Issue file '${entry}' says '${match[1]}' but the issue is '${issue.status}': ` +
        `rename it to '${issue.status}-${shortId(issue.id)}.md', or fix the status inside it.`
    );
  }
}

function parsedFile(projectDir, id) {
  const filePath = findIssueFile(projectDir, id);
  if (filePath === null) return null;
  const issue = parseIssue(readFileSync(filePath, "utf8"), filePath);
  const actualShortId = shortId(issue.id);
  if (actualShortId !== shortId(id)) fail(`Issue file '${filePath}' does not match its id.`);
  if (issue.id !== id) fail(`Issue id '${issue.id}' collides with '${id}'.`, "ID_COLLISION");
  validateIssueFileName(path.basename(filePath), issue);
  return issue;
}

export function readIssue(projectDir, id) {
  return parsedFile(projectDir, id);
}

export function readAllIssues(projectDir) {
  const dir = issuesDirectory(projectDir);
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir).filter((entry) => entry.endsWith(".md")).sort();
  const issues = entries.map((entry) => ({
    entry,
    issue: parseIssue(readFileSync(path.join(dir, entry), "utf8"), path.join(dir, entry)),
  }));
  const idsByShortId = new Map();
  for (const { issue } of issues) {
    const key = shortId(issue.id);
    const existing = idsByShortId.get(key);
    if (existing && existing !== issue.id) {
      fail(`Issues '${existing}' and '${issue.id}' share short id '${key}'.`, "ID_COLLISION");
    }
    idsByShortId.set(key, issue.id);
  }
  // The same id in two files: the half-finished rename writeIssue guards against. Caught here and
  // not only in findIssueFile, so a full read refuses too instead of silently reporting the issue
  // twice — and the message names both files, because the fix is choosing between them.
  const fileById = new Map();
  for (const { entry, issue } of issues) {
    const previous = fileById.get(issue.id);
    if (previous !== undefined) {
      fail(
        `Issue '${issue.id}' is stored in more than one file (${[previous, entry].sort().join(", ")}). ` +
          "That is what an interrupted status change leaves behind: keep the one that is right and " +
          "remove the other.",
        "ID_COLLISION"
      );
    }
    fileById.set(issue.id, entry);
  }
  for (const { entry, issue } of issues) {
    validateIssueFileName(entry, issue);
  }
  return issues.map(({ issue }) => issue);
}

export function writeIssue(projectDir, issue) {
  if (issue === null || typeof issue !== "object" || Array.isArray(issue)) fail("An issue must be an object.");
  const filePath = issuePath(projectDir, issue.id, issue.status);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const previousPath = findIssueFile(projectDir, issue.id);
  const existing = parsedFile(projectDir, issue.id);
  if (existing !== null && existing.id !== issue.id) {
    fail(`Issue id '${issue.id}' collides with '${existing.id}'.`, "ID_COLLISION");
  }
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  );
  try {
    writeFileSync(tempPath, serializeIssue(issue), "utf8");
    renameSync(tempPath, filePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
  // The old name goes LAST, and only once the new one is on disk. The other order would open a
  // window where a crash leaves no file at all; this one leaves two, which every reader refuses
  // loudly with ID_COLLISION and a human resolves by deleting the wrong one.
  if (previousPath !== null && previousPath !== filePath) {
    rmSync(previousPath, { force: true });
  }
  return filePath;
}

export function deleteIssueFile(projectDir, id) {
  const filePath = findIssueFile(projectDir, id);
  if (filePath !== null) rmSync(filePath, { force: true });
}
