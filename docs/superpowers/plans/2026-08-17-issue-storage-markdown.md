# Markdown Issue Storage 1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the committed `issues.json` monolith with one authoritative Markdown file per issue under `.harness/issues/`, preserving the issue object, JSON CLI contract, validation guards, and independent-verification workflow.

**Architecture:** A new zero-dependency `scripts/issue-store.mjs` owns the restricted YAML-frontmatter codec and atomic per-issue filesystem operations. `issue-manager.mjs` remains the only process allowed to import that module and exposes the complete tracker through `--dump`; `status-cli.mjs` and `docs-gate.mjs` consume that JSON envelope by spawning `issue-manager.mjs`. Schema migrations remain object transformations, while `--upgrade` performs the one-way schema-3 JSON to schema-4 Markdown storage migration.

**Tech Stack:** Node.js ESM, built-in `node:*` modules only, `node:test`, Markdown with a deliberately restricted YAML-compatible frontmatter subset.

**Spec:** `docs/superpowers/specs/2026-08-16-issue-storage-markdown-design.md`

## Global Constraints

- The tracker is `.harness/issues/SHORT_ID.md`, where `SHORT_ID` is the first eight hexadecimal characters of the UUID; `issues.json` is removed after a successful upgrade.
- `issue-manager.mjs` is the only importer of `issue-store.mjs` and the only writer of issue Markdown.
- No runtime dependencies and no general-purpose YAML package.
- Frontmatter contains the complete structured record; the body contains one H1 rendering of `title` and `description` only.
- Existing issue fields, validation rules, role guards, exit codes, and success payloads remain unchanged except for the documented `--init` payload.
- Standard output from `issue-manager.mjs` remains exactly one JSON envelope line; stderr remains empty.
- `SCHEMA_VERSION` is exactly `4`; plugin and marketplace versions become exactly `1.0.0` together.
- No dual-read or dual-write: legacy JSON is accepted only by `--upgrade`; other commands return `STORAGE_NOT_MIGRATED` or `STORAGE_CONFLICT`.
- Empty arrays remain arrays and `validation: null` remains explicit null.
- Existing historical files under `docs/superpowers/` and `.harness/archive/` are not rewritten.
- All tracker mutations for this repository go through `node scripts/issue-manager.mjs`; never edit tracker data manually.

---

### Task 0: Open and Materialize the Harness Implementation Issue

**Files:**
- Create through CLI: one tracker record in the currently active storage

**Interfaces:**
- Consumes: the approved spec and this implementation plan.
- Produces: one reasoning-tier issue ID used by every later tracker update, with execution and validation tasks materialized before `in_progress`.

- [ ] **Step 1: Create the implementation issue through the current CLI**

Prepare a temporary JSON payload containing this exact contract:

```json
{
  "title": "Move harness issue storage to markdown for 1.0",
  "description": "Implement the approved Markdown issue-storage spec and its plan. The issue covers the storage codec, issue-manager integration and migration, config ownership, consumer migration, this repository's live tracker migration, authoritative documentation, and 1.0 metadata.",
  "status": "backlog",
  "tier": "reasoning",
  "depends_on": [],
  "covers": [],
  "validation": {
    "criteria": [
      "The complete npm run test suite passes on schema-4 Markdown storage.",
      "issue-manager is the only importer of issue-store and all existing JSON command contracts remain intact except the documented init payload.",
      "A schema-3 legacy tracker upgrades once to per-issue Markdown, recovers from an interrupted upgrade, and is byte-idempotent afterward.",
      "status-cli and docs-gate consume issue-manager --dump and preserve their documented failure contracts.",
      "This repository contains no live issues.json, reports schema_version 4, and both plugin manifests report 1.0.0.",
      "Authoritative documentation describes the new storage, compatibility break, and upgrade command without rewriting historical records."
    ],
    "tasks": [
      { "id": 1, "short_title": "Verify storage and CLI contracts", "full_description": "Run focused storage and issue-manager suites; inspect error envelopes and per-file writes.", "checked": false },
      { "id": 2, "short_title": "Verify migration and consumers", "full_description": "Exercise legacy upgrade, interrupted recovery, dump, full status, oneline failure, and docs gate behavior.", "checked": false },
      { "id": 3, "short_title": "Verify live tracker and documentation", "full_description": "Compare migrated issue objects, inspect version metadata and authoritative documentation, and run the structural stale-language search.", "checked": false },
      { "id": 4, "short_title": "Run configured verification", "full_description": "Run npm run test from the repository root and record the exact result.", "checked": false }
    ],
    "state": "unknown"
  }
}
```

Run: `HARNESS_ROLE=worker node scripts/issue-manager.mjs --insert --issue-data-file ISSUE_PAYLOAD_PATH`

Expected: success envelope containing the new UUID. Record that returned UUID as `IMPLEMENTATION_ISSUE_ID` in the execution session; do not invent or derive it from a filename.

- [ ] **Step 2: Materialize execution tasks and enter progress**

Update the returned issue with these execution tasks and `status: "in_progress"` under `HARNESS_ROLE=worker`:

```json
{
  "status": "in_progress",
  "tasks": [
    { "id": 1, "short_title": "Build the Markdown issue store", "full_description": "Implement and test the restricted frontmatter codec plus atomic per-issue storage.", "checked": false },
    { "id": 2, "short_title": "Move issue-manager onto the store", "full_description": "Adapt read and CRUD commands, init, dump, schema-4 upgrade, and compaction while preserving guards and payloads.", "checked": false },
    { "id": 3, "short_title": "Move config and consumers", "full_description": "Put schema_version in config and make status-cli and docs-gate consume issue-manager --dump.", "checked": false },
    { "id": 4, "short_title": "Migrate the live tracker", "full_description": "Upgrade this repository's tracker through the CLI and prove semantic equality and idempotence.", "checked": false },
    { "id": 5, "short_title": "Update 1.0 documentation and metadata", "full_description": "Update authoritative documentation, structural tests, and both manifest versions and descriptions.", "checked": false },
    { "id": 6, "short_title": "Complete verification and review handoff", "full_description": "Run the full suite and live probes, align tasks, and move the issue to in_review for an independent verifier.", "checked": false }
  ]
}
```

Expected: success envelope with `status: "in_progress"` and six unchecked execution tasks.

---

### Task 1: Restricted Frontmatter Codec and Per-Issue Store

**Files:**
- Create: `scripts/issue-store.mjs`
- Create: `test/plugin-issue-store.test.mjs`
- Modify: `test/smoke.test.mjs`

**Interfaces:**
- Consumes: plain issue objects whose fields already satisfy `issue-manager.mjs` schema validation.
- Produces: `serializeIssue(issue): string`, `parseIssue(markdown, sourcePath): object`, `classifyStorage(projectDir): { kind, jsonPath, issuesDir }`, `readAllIssues(projectDir): object[]`, `readIssue(projectDir, id): object|null`, `writeIssue(projectDir, issue): string`, `deleteIssueFile(projectDir, id): void`, `issuePath(projectDir, id): string`, and exported `StorageError` carrying `code`.

- [ ] **Step 1: Add failing codec round-trip tests**

Create a representative issue with non-empty `depends_on`, `covers`, execution tasks, validation tasks, escaped quotes, a colon, and a newline. Assert deep equality rather than comparing presentation:

```js
test("serializeIssue/parseIssue round-trip the complete issue object", () => {
  const issue = completeIssue({
    description: "First paragraph.\n\nSecond paragraph.",
    tasks: [{ id: 1, short_title: "Parse: record", full_description: "line one\nline two", checked: false }],
  });
  assert.deepEqual(parseIssue(serializeIssue(issue), "11111111.md"), issue);
});

test("validation null and empty arrays remain explicit", () => {
  const issue = completeIssue({ validation: null, depends_on: [], covers: [], tasks: [] });
  assert.deepEqual(parseIssue(serializeIssue(issue), "11111111.md"), issue);
});
```

- [ ] **Step 2: Run the new test file and verify the missing-module failure**

Run: `node --test test/plugin-issue-store.test.mjs`

Expected: FAIL because `scripts/issue-store.mjs` does not exist.

- [ ] **Step 3: Implement the restricted scalar, mapping, and sequence codec**

Implement explicit recursive block parsing at two-space indentation. Use JSON escaping for quoted strings and reject unsupported YAML syntax before parsing:

```js
export class StorageError extends Error {
  constructor(message, code = "INVALID_INPUT") {
    super(message);
    this.code = code;
  }
}

const FORBIDDEN_YAML = /(^|\s)(?:!!|[&*]|%YAML|<<:)/m;

function encodeString(value) {
  const ambiguous = /[:#\n]|^\s|\s$|^(?:true|false|null|-?\d+)$/;
  return ambiguous.test(value) ? JSON.stringify(value) : value;
}

export function serializeIssue(issue) {
  const { description, ...frontmatter } = issue;
  return `---\n${encodeMapping(frontmatter, 0)}\n---\n\n# ${issue.title}\n\n${description}\n`;
}
```

Permit block mappings and sequences plus scalar sequences in flow form for `[]`, `depends_on`, and `covers`; reject tags, anchors, aliases, directives, merge keys, tabs used for indentation, odd indentation, and unsupported nested flow structures with `StorageError(..., "INVALID_INPUT")`.

- [ ] **Step 4: Add malformed-input and H1 precedence tests**

```js
for (const [label, fragment] of [
  ["tag", "title: !!str bad"],
  ["anchor", "title: &name bad"],
  ["alias", "title: *name"],
  ["merge", "<<: *defaults"],
]) {
  test(`parseIssue rejects YAML ${label}`, () => {
    assert.throws(() => parseIssue(`---\nid: ${ID_ONE}\n${fragment}\n---\n`, "11111111.md"),
      (error) => error.code === "INVALID_INPUT");
  });
}

test("frontmatter title wins over a divergent rendered H1", () => {
  const parsed = parseIssue(serializeIssue(completeIssue()).replace("# Issue One", "# Edited by hand"), "11111111.md");
  assert.equal(parsed.title, "Issue One");
});
```

- [ ] **Step 5: Add failing filesystem-store tests**

Cover stable names, atomic replacement, invalid filenames, filename/id disagreement, lookup isolation, and collisions:

```js
test("writeIssue stores one atomic file named by short id", () => {
  const dir = tempProject();
  const stored = writeIssue(dir, completeIssue());
  assert.equal(stored, path.join(dir, ".harness", "issues", "11111111.md"));
  assert.deepEqual(readIssue(dir, ID_ONE), completeIssue());
  assert.deepEqual(readdirSync(path.dirname(stored)), ["11111111.md"]);
});

test("readAllIssues rejects colliding prefixes", () => {
  writeRawIssue(dir, "11111111.md", completeIssue({ id: ID_ONE }));
  writeRawIssue(dir, "collision.md", completeIssue({ id: "11111111-2222-2222-2222-222222222222" }));
  assert.throws(() => readAllIssues(dir), (error) => error.code === "ID_COLLISION");
});
```

- [ ] **Step 6: Implement storage classification and atomic file operations**

`classifyStorage()` must distinguish `empty`, `markdown`, `legacy`, and `conflict`. A present empty `.harness/issues/` is Markdown storage; when JSON also exists, it is `legacy` until at least one `.md` exists. `writeIssue()` writes a sibling temp file and renames it; ensure the temp file is removed on a caught write/rename error. `readIssue()` reads only the target short-id file and must not scan or validate unrelated issue files.

- [ ] **Step 7: Run focused and structural tests**

Run: `node --test test/plugin-issue-store.test.mjs test/smoke.test.mjs`

Expected: PASS, including a smoke assertion that `scripts/issue-store.mjs` ships in the plugin.

- [ ] **Step 8: Commit the codec and store**

```bash
git add scripts/issue-store.mjs test/plugin-issue-store.test.mjs test/smoke.test.mjs
git commit -m "feat: add markdown issue store"
```

### Task 2: Issue Manager Reads, CRUD, Init, and Dump

**Files:**
- Modify: `scripts/issue-manager.mjs`
- Modify: `test/plugin-issue-manager.test.mjs`

**Interfaces:**
- Consumes: all Task 1 exports; existing JSON request payloads and role environment.
- Produces: `--dump` success data `{ schema_version: 4, issues: Issue[] }`; all existing commands operate on Markdown storage; legacy/conflict failures use the new codes.

- [ ] **Step 1: Convert the standard test fixture to Markdown storage**

Import `serializeIssue` in the test and replace the default helper with:

```js
function setupTempProject(seed = baseSeed()) {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-"));
  if (seed !== null) {
    mkdirSync(path.join(dir, ".harness", "issues"), { recursive: true });
    writeFileSync(path.join(dir, ".harness", "config.json"), JSON.stringify({ schema_version: 4 }) + "\n");
    for (const issue of seed.issues) {
      const normalized = migrateSeedIssueToSchema3(issue);
      writeFileSync(path.join(dir, ".harness", "issues", `${normalized.id.slice(0, 8)}.md`), serializeIssue(normalized));
    }
  }
  return { dir };
}
```

Keep a separate `setupLegacyProject(seed)` helper for migration and storage-classification tests. Do not weaken existing assertions on command payloads.

- [ ] **Step 2: Add failing storage-gate and `--dump` tests**

Test all four classifications, including empty directory plus JSON as `STORAGE_NOT_MIGRATED`, and verify no files change on refusal. Test `--dump` across all statuses, stable ascending ID order, empty tracker, and one malformed Markdown file producing `INVALID_INPUT`/exit 1.

```js
test("--dump returns every issue without pagination or status filtering", () => {
  const data = assertOk(run(dir, ["--dump"]));
  assert.equal(data.schema_version, 4);
  assert.deepEqual(data.issues.map(({ id }) => id), [ID_ONE, ID_TWO, ID_THREE]);
});
```

- [ ] **Step 3: Run the dump and classification tests to verify failure**

Run: `node --test --test-name-pattern='dump|STORAGE_' test/plugin-issue-manager.test.mjs`

Expected: FAIL because `--dump` and storage gating do not exist.

- [ ] **Step 4: Replace global JSON-file state with project/store state**

Import Task 1 functions only in `issue-manager.mjs`. Resolve a project directory once, classify once after help handling, and convert `StorageError` into the existing failure envelope:

```js
let projectDir;

function requireMarkdownStorage(command) {
  const storage = classifyStorage(projectDir);
  if (storage.kind === "legacy") fail("Run --upgrade before using this tracker.", "STORAGE_NOT_MIGRATED");
  if (storage.kind === "conflict") fail("Legacy JSON and Markdown issues are both populated.", "STORAGE_CONFLICT");
  return storage;
}

function dumpIssues() {
  const issues = readAllIssues(projectDir).sort((a, b) => a.id.localeCompare(b.id));
  writeOk({ schema_version: readSchemaVersion(projectDir), issues });
}
```

Add `dump` to `parseArgs`, help, dispatch, and the error-code list. `--help` must bypass storage classification.

- [ ] **Step 5: Adapt get/get-all/insert/update/delete one operation at a time**

Preserve validation and graph semantics by loading all issues only when a graph or list operation needs them. `--get` calls `readIssue(projectDir, issueId)` so an unrelated corrupt file cannot break it. `--update` writes only the merged target; `--delete` reads all to enforce dependents and then deletes only the target.

- [ ] **Step 6: Adapt `--init` and first insert**

`--init` creates `.harness/issues/`, stamps `schema_version: 4` only into an existing config, and returns `{ path: ABSOLUTE_ISSUES_DIRECTORY, created: true }`. It returns `ALREADY_EXISTS` when either the directory or legacy JSON exists. A first insert into a project with neither storage creates the issues directory lazily but does not create config.

- [ ] **Step 7: Run the entire issue-manager suite**

Run: `node --test test/plugin-issue-store.test.mjs test/plugin-issue-manager.test.mjs`

Expected: PASS; existing JSON envelope, validation, dependency, role, and task tests remain intact.

- [ ] **Step 8: Commit CRUD and dump**

```bash
git add scripts/issue-manager.mjs test/plugin-issue-manager.test.mjs
git commit -m "feat: serve markdown issues through issue manager"
```

### Task 3: Schema-4 Upgrade and Markdown Compaction

**Files:**
- Modify: `scripts/issue-manager.mjs`
- Modify: `test/plugin-issue-manager.test.mjs`

**Interfaces:**
- Consumes: `classifyStorage`, Markdown writes/deletes from Task 1; schema migrations 0→1, 1→2, 2→3 already in `MIGRATIONS`.
- Produces: idempotent `upgradeTracker()` from legacy JSON to Markdown schema 4; `compactTracker()` archives originals then mutates individual Markdown files.

- [ ] **Step 1: Add failing schema-3 to schema-4 upgrade tests**

Assert that all Markdown files exist, `issues.json` is absent, an existing config gains only `schema_version`, root decoration is discarded, and no config is created when absent. Snapshot all bytes after success and assert a second upgrade is byte-for-byte inert.

- [ ] **Step 2: Add interrupted-upgrade and version-default tests**

Seed JSON plus already-populated Markdown: ordinary reads return `STORAGE_CONFLICT`, while `--upgrade` rewrites Markdown from JSON and removes JSON. Assert Markdown storage without config reads as version 4; assert legacy JSON without `schema_version` starts at 0; preserve `SCHEMA_TOO_NEW` behavior for either relevant source.

- [ ] **Step 3: Run upgrade tests to verify failure**

Run: `node --test --test-name-pattern='upgrade|SCHEMA_TOO_NEW|STORAGE_CONFLICT' test/plugin-issue-manager.test.mjs`

Expected: FAIL because storage migration 3→4 is not implemented.

- [ ] **Step 4: Implement ordered schema then storage migration**

Set `SCHEMA_VERSION = 4`, retain object migrations through version 3, and make storage migration the final phase:

```js
for (const issue of migratedIssues) writeIssue(projectDir, issue);
if (existsSync(configPath)) writeConfigSchemaVersion(configPath, SCHEMA_VERSION);
unlinkSync(jsonPath); // last operation: JSON remains the recovery source until every file exists
writeOk({ from: fromVersion, to: 4, migrated: touched.filter(Boolean).length });
```

On conflict, JSON is authoritative. Rewrite every expected issue file, reject short-id collisions before writing, and remove legacy JSON only after all writes and optional config update succeed. A completed schema-4 Markdown tracker returns without writing.

- [ ] **Step 5: Add failing compact tests for per-file mutation and crash-safe ordering**

Keep all existing refusal-order tests. Assert archive JSON is written first with the stored schema version, originals are deleted afterward, block issues are Markdown, unrelated Markdown files are byte-identical, and a repeated compaction gets the existing suffix behavior.

- [ ] **Step 6: Adapt `compactTracker()` to the store**

Read all live issues once, perform every role/payload/tracker/graph refusal before writing, write the archive, delete only archived files, and write each block issue. Preserve the current archive object and command payload exactly.

- [ ] **Step 7: Run focused and complete tests**

Run: `node --test --test-name-pattern='upgrade|compact|SCHEMA_|STORAGE_' test/plugin-issue-manager.test.mjs`

Expected: PASS.

Run: `node --test test/plugin-issue-store.test.mjs test/plugin-issue-manager.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit migration and compaction**

```bash
git add scripts/issue-manager.mjs test/plugin-issue-manager.test.mjs
git commit -m "feat: migrate issue storage to markdown"
```

### Task 4: Configuration Owns Schema Version and New Gate Defaults

**Files:**
- Modify: `scripts/harness-config.mjs`
- Modify: `test/plugin-config.test.mjs`
- Modify: `.harness/config.json`

**Interfaces:**
- Consumes: existing config JSON and `--init --force` merge behavior.
- Produces: validated non-negative integer `schema_version`; preservation of an existing value when omitted; default value `4`; default docs exclusions for tracker and archive paths.

- [ ] **Step 1: Add failing schema-version validation and preservation tests**

```js
test("--init seeds schema_version 4", () => {
  const stored = assertOk(run(dir, ["--init", "--config-data", MINIMAL])).config;
  assert.equal(stored.schema_version, 4);
});

test("--force preserves an existing schema_version when payload omits it", () => {
  writeConfig(dir, { ...baseConfig(), schema_version: 7 });
  const stored = assertOk(run(dir, ["--init", "--force", "--config-data", MINIMAL])).config;
  assert.equal(stored.schema_version, 7);
});
```

Loop over `-1`, `1.5`, `"4"`, and `null` and require `INVALID_INPUT`.

- [ ] **Step 2: Add failing default-exclusion assertions**

Assert the default excludes contain `issues.json`, `.harness/issues/**`, and `.harness/archive/**` while retaining docs/test/Markdown exclusions.

- [ ] **Step 3: Run config tests to verify failure**

Run: `node --test test/plugin-config.test.mjs`

Expected: FAIL on unknown `schema_version`, preservation, and new defaults.

- [ ] **Step 4: Implement config validation and merge semantics**

Add `schema_version` to the top-level whitelist and validate it when present. Before constructing `stored`, read the existing config when it exists:

```js
const previous = existsSync(configPath) ? readJsonFile(configPath) : {};
const stored = {
  schema_version: config.schema_version ?? previous.schema_version ?? 4,
  setup: config.setup ?? null,
  verify: config.verify,
  externalWorker: { enabled: false, command: null, ...(config.externalWorker ?? {}) },
  docsGate: { ...DEFAULT_DOCS_GATE, ...(config.docsGate ?? {}) },
  execution: { ...DEFAULT_EXECUTION, ...(config.execution ?? {}) },
};
```

Use explicit property checks rather than `??` if validation permits no null: the intent is preservation when omitted, never treating a supplied invalid null as omission.

- [ ] **Step 5: Update this repository's config defaults**

Add `schema_version: 4` and add `.harness/issues/**` and `.harness/archive/**` to `docsGate.exclude`; keep `issues.json` for interrupted upgrades.

- [ ] **Step 6: Run config and issue-manager integration tests**

Run: `node --test test/plugin-config.test.mjs test/plugin-issue-manager.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit config changes**

```bash
git add scripts/harness-config.mjs test/plugin-config.test.mjs .harness/config.json
git commit -m "feat: move tracker schema version into config"
```

### Task 5: Status and Documentation Gate Consume `--dump`

**Files:**
- Modify: `scripts/status-cli.mjs`
- Modify: `scripts/docs-gate.mjs`
- Modify: `test/plugin-status-cli.test.mjs`
- Modify: `test/plugin-docs-gate.test.mjs`

**Interfaces:**
- Consumes: `node scripts/issue-manager.mjs --dump --project-dir PROJECT_DIRECTORY` and its one-line JSON envelope.
- Produces: unchanged snapshot/gate decisions; full status and docs gate exit 1 on dump failure; oneline prints only `\n` and exits 0 on every failure.

- [ ] **Step 1: Add a shared behavioral expectation in each consumer suite**

Seed Markdown through the real `issue-manager --insert` or the codec helper, never by creating a consumer-specific YAML parser. Add cases for successful dump, `STORAGE_NOT_MIGRATED`, `STORAGE_CONFLICT`, malformed issue Markdown, and no tracker.

- [ ] **Step 2: Update status rendering tests for the new header**

Change `renderSnapshot(snapshot, { project })` assertions so the header uses `path.basename(projectDir)` and never contains `aggiornato`. Remove `last_updated` fixtures and age-format tests that no longer express public behavior; keep the live `T @ HH:MM:SS` oneline clock tests.

- [ ] **Step 3: Run consumer tests to verify failure**

Run: `node --test test/plugin-status-cli.test.mjs test/plugin-docs-gate.test.mjs`

Expected: FAIL because both scripts still read `issues.json` directly.

- [ ] **Step 4: Implement one local dump adapter per process**

Do not create a shared module and do not import `issue-store.mjs`:

```js
function dumpIssues(projectDir) {
  const result = spawnSync(process.execPath, [ISSUE_MANAGER, "--dump", "--project-dir", projectDir], {
    encoding: "utf8",
  });
  const envelope = JSON.parse(result.stdout.trim());
  if (result.status !== 0 || envelope.ok !== true) {
    throw new Error(envelope.error ?? "issue-manager --dump failed");
  }
  return envelope.data.issues;
}
```

Resolve `ISSUE_MANAGER` relative to each script with `fileURLToPath(import.meta.url)`. Full-screen status and docs-gate convert errors to their existing text failure/exit-1 path. `onelineFor()` catches everything and returns `""`.

- [ ] **Step 5: Remove direct storage reads and obsolete header data**

Remove `readFileSync` uses that exist only for tracker access. Keep config reading in docs-gate. Change `renderSnapshot` to accept `{ project }`, delete `formatWhen`, and update help/comments to name `.harness/issues/` and `--dump` rather than `issues.json`.

- [ ] **Step 6: Run consumer and graph tests**

Run: `node --test test/plugin-status-cli.test.mjs test/plugin-docs-gate.test.mjs test/plugin-tracker-graph.test.mjs`

Expected: PASS; `scripts/tracker-graph.mjs` is unchanged.

- [ ] **Step 7: Commit consumer changes**

```bash
git add scripts/status-cli.mjs scripts/docs-gate.mjs test/plugin-status-cli.test.mjs test/plugin-docs-gate.test.mjs
git commit -m "refactor: read tracker consumers through issue manager"
```

### Task 6: Migrate This Repository's Live Tracker

**Files:**
- Delete through CLI: `issues.json`
- Create through CLI: `.harness/issues/*.md`
- Modify through CLI: `.harness/config.json`

**Interfaces:**
- Consumes: Task 3 `node scripts/issue-manager.mjs --upgrade`.
- Produces: this repository's exact 20 issue objects in schema-4 Markdown storage, with no legacy JSON.

- [ ] **Step 1: Capture a read-only semantic baseline**

Run: `node scripts/issue-manager.mjs --upgrade --help`

Expected: help text only; no storage classification or write.

Before running the new upgrade, use the current committed legacy file only for a one-off semantic comparison in a temporary file outside the tracker. Record count and sorted IDs with a read-only command; do not edit `issues.json`.

- [ ] **Step 2: Run the repository migration through the CLI**

Run: `node scripts/issue-manager.mjs --upgrade`

Expected: success envelope with `from: 3`, `to: 4`; `.harness/issues/` contains one Markdown file per issue and `issues.json` no longer exists.

- [ ] **Step 3: Verify semantic and idempotent migration**

Run: `node scripts/issue-manager.mjs --dump`

Expected: success envelope with `schema_version: 4`, 20 issues, and the same sorted IDs and issue objects as the legacy baseline apart from discarded root metadata.

Run: `node scripts/issue-manager.mjs --upgrade`

Expected: `{"ok":true,"data":{"from":4,"to":4,"migrated":0}}` and no byte changes under `.harness/issues/` or `.harness/config.json`.

- [ ] **Step 4: Run status and the CI tracker probe**

Run: `node scripts/status-cli.mjs`

Expected: 20 done issues, no work in progress, no `aggiornato` field.

Run: `node scripts/issue-manager.mjs --get-all --page-size 1`

Expected: success envelope reading Markdown storage.

- [ ] **Step 5: Commit the live tracker migration**

Before committing, align any execution task recorded for this harness issue via `HARNESS_ROLE=worker node scripts/issue-manager.mjs --update ...`; do not mark validation tasks.

```bash
git add .harness/config.json .harness/issues issues.json
git commit -m "chore: migrate harness tracker to markdown"
```

### Task 7: Authoritative Documentation and 1.0 Metadata

**Files:**
- Modify: `skills/harness/SKILL.md`
- Modify: `skills/harness/references/issues.md`
- Modify: `skills/harness/references/config.md`
- Modify: `skills/harness/references/status.md`
- Modify: `skills/harness/references/docs-gate.md`
- Modify: `skills/harness/references/git.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `CONTRIBUTING.md`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: relevant structural assertions in `test/plugin-agent.test.mjs`, `test/plugin-commands.test.mjs`, `test/smoke.test.mjs`, and `test/plugin-install-check.test.mjs`

**Interfaces:**
- Consumes: the final command/storage/error behavior from Tasks 1–6.
- Produces: one authoritative description of schema-4 storage, upgrade, compatibility break, and version 1.0.0.

- [ ] **Step 1: Add or update structural tests before prose**

Require both manifests to report `1.0.0`, require their descriptions to omit `live issue board` and `leaving nothing but issues.json`, and require shipped docs/help to mention `.harness/issues/`, `--dump`, and the three new storage error codes where applicable.

- [ ] **Step 2: Run structural tests to verify failure**

Run: `node --test test/smoke.test.mjs test/plugin-agent.test.mjs test/plugin-commands.test.mjs test/plugin-install-check.test.mjs`

Expected: FAIL on stale storage/version promises.

- [ ] **Step 3: Rewrite the authoritative issue and config references**

In `references/issues.md`, document exact file format, `--dump`, classification table, schema defaults, upgrade recovery, compact ordering, payload compatibility, and all error codes. In `references/config.md`, document `schema_version: 4`, the new default exclusions, and that archive JSON is history rather than tracker storage.

- [ ] **Step 4: Update workflow and consumer references**

Change `SKILL.md`, status, docs-gate, and git references from root JSON to `.harness/issues/`, retaining the invariant that only the script writes issue data. Explicitly document old-plugin/new-storage behavior and the one-way `--upgrade` command. Do not change historical specs, plans, approvals, analyses, or archives.

- [ ] **Step 5: Update repository-facing docs and release notes**

Update README, AGENTS, CLAUDE, and CONTRIBUTING. The compatibility notice must open with these facts: a 0.7 plugin sees a 1.x tracker as empty; a 1.x plugin refuses a 0.7 tracker except for `--upgrade`; users must run the installed plugin's `issue-manager.mjs --upgrade`. Keep installation and installed-copy verification instructions intact.

- [ ] **Step 6: Set both manifest versions and descriptions together**

Set `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` to exactly `1.0.0`, with matching descriptions that promise the Markdown tracker and no removed board.

- [ ] **Step 7: Search for stale live-contract language**

Run: `rg -n "issues\\.json|live issue board|live board|last_updated|SCHEMA_VERSION = 3" README.md AGENTS.md CLAUDE.md CONTRIBUTING.md skills agents commands scripts .claude-plugin test`

Expected: matches remain only where explicitly discussing migration compatibility, the retained docs-gate exclusion, legacy test fixtures, or historical facts; inspect every match.

- [ ] **Step 8: Run structural tests and commit**

Run: `node --test test/smoke.test.mjs test/plugin-agent.test.mjs test/plugin-commands.test.mjs test/plugin-install-check.test.mjs`

Expected: PASS.

```bash
git add skills README.md AGENTS.md CLAUDE.md CONTRIBUTING.md .claude-plugin test/plugin-agent.test.mjs test/plugin-commands.test.mjs test/smoke.test.mjs test/plugin-install-check.test.mjs
git commit -m "docs: document markdown tracker in harness 1.0"
```

### Task 8: Full Verification, Independent Review, and Publication Gate

**Files:**
- Modify only if tests expose a defect: files already listed in Tasks 1–7
- Tracker mutation through CLI: the implementation issue file identified by `IMPLEMENTATION_ISSUE_ID` from Task 0

**Interfaces:**
- Consumes: complete implementation and `.harness/config.json` verify command.
- Produces: an `in_review` harness issue ready for a distinct `harness-verifier`; no push or merge before `done/pass`.

- [ ] **Step 1: Run formatting-free static searches**

Run: `rg -n "from [\"']\\./issue-store\\.mjs[\"']" scripts`

Expected: exactly one importer, `scripts/issue-manager.mjs`.

Run: `rg -n "readFileSync\\(.*issues|issues\\.json.*readFileSync" scripts/status-cli.mjs scripts/docs-gate.mjs`

Expected: no matches.

- [ ] **Step 2: Run the configured verification command from scratch**

Run: `npm run test`

Expected: every `node:test` test passes, with no skipped or cancelled failures.

- [ ] **Step 3: Exercise the live CLI workflow in this repository**

Run:

```bash
node scripts/issue-manager.mjs --dump
node scripts/status-cli.mjs
node scripts/docs-gate.mjs --since e098826
node scripts/issue-manager.mjs --get-all --page-size 1
```

Expected: dump/schema 4 succeeds; status shows the live implementation issue state; docs-gate reads through dump; CI probe succeeds.

- [ ] **Step 4: Align tracker tasks and move the implementation issue to review**

Use an issue-data file and the worker role:

```bash
HARNESS_ROLE=worker node scripts/issue-manager.mjs --update --issue-id IMPLEMENTATION_ISSUE_ID --issue-data-file REVIEW_PAYLOAD_PATH
```

The payload checks every completed execution task, sets `status: "in_review"`, and leaves `validation.state: "unknown"` plus all validation tasks unchecked.

- [ ] **Step 5: Dispatch an independent verifier**

Invoke the repository's `harness-verifier` as a distinct agent at a tier no lower than the implementation worker. It must inspect the spec, this plan, real artifacts, commit range, and run `npm run test`; it must only verify, never fix.

Expected on success: verifier updates the issue to `status: "done"`, `validation.state: "pass"`, checks validation tasks, and records concrete evidence in `validation.criteria`. On failure: it writes `blocked/fail`; return to the failing task with new commits and request another independent verification.

- [ ] **Step 6: Run the documentation gate after the final implementation commit**

Run: `node scripts/docs-gate.mjs`

Expected: every code commit is named by a documentation issue's `covers`, or a new docs issue is opened through `issue-manager --insert` before publication.

- [ ] **Step 7: Confirm publication eligibility**

Run: `node scripts/status-cli.mjs`

Expected: implementation issue is `done/pass`; no blocked issue or unverified implementation is being published. Only then may the branch be pushed or merged. Tagging and installed-copy checks remain a separate explicitly requested release action.
