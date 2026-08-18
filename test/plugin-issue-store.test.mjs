import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  StorageError,
  classifyStorage,
  deleteIssueFile,
  issuePath,
  parseIssue,
  readAllIssues,
  readIssue,
  serializeIssue,
  writeIssue,
} from "../scripts/issue-store.mjs";

import { fileURLToPath } from "node:url";

const scriptsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");

const ID_ONE = "11111111-1111-1111-1111-111111111111";
const ID_TWO = "22222222-2222-2222-2222-222222222222";
const COLLIDING_ID = "11111111-2222-2222-2222-222222222222";

test("issue-manager is the only shipped script that imports the store", () => {
  // The file layout is one Markdown file per issue, and every reader of that layout is a place
  // that has to change the day it moves. Keeping the importers down to one is what lets the other
  // scripts read the tracker through `issue-manager --dump` and stay out of the storage question
  // entirely. Running issue-manager as a child process is not importing it: no module crosses.
  const importers = readdirSync(scriptsDir)
    .filter((file) => file.endsWith(".mjs"))
    .filter((file) => /from\s+["'][^"']*issue-store\.mjs["']/.test(readFileSync(path.join(scriptsDir, file), "utf8")));

  assert.deepEqual(
    importers,
    ["issue-manager.mjs"],
    "a second importer of issue-store is a second reader of the storage layout"
  );
});

function completeIssue(overrides = {}) {
  return {
    id: ID_ONE,
    title: "Issue One",
    description: "Description",
    status: "backlog",
    tier: "standard",
    depends_on: [ID_TWO],
    covers: ["abc1234"],
    tasks: [
      {
        id: 1,
        short_title: "Run tests",
        full_description: "Run the focused test suite.",
        checked: false,
      },
    ],
    validation: {
      criteria: ["Tests pass", "Output contains: success"],
      tasks: [
        {
          id: 1,
          short_title: "Inspect output",
          full_description: "Confirm the suite exits 0.",
          checked: false,
        },
      ],
      state: "unknown",
    },
    created_at: "2026-08-17T10:00:00.000Z",
    updated_at: "2026-08-17T10:00:00.000Z",
    ...overrides,
  };
}

function tempProject() {
  return mkdtempSync(path.join(tmpdir(), "harness-issue-store-"));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function writeRawIssue(dir, fileName, issue) {
  const issuesDir = path.join(dir, ".harness", "issues");
  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(path.join(issuesDir, fileName), serializeIssue(issue), "utf8");
}

test("serializeIssue/parseIssue round-trip the complete issue object", () => {
  const issue = completeIssue({
    title: 'Issue "One"',
    description: "First paragraph.\n\nSecond paragraph.",
    tasks: [{ id: 1, short_title: "Parse: record", full_description: "line one\nline two", checked: false }],
  });

  assert.deepEqual(parseIssue(serializeIssue(issue), "11111111.md"), issue);
});

test("parseIssue rejects plain scalars that require JSON quoting", () => {
  assert.throws(
    () => parseIssue(`---\nid: ${ID_ONE}\ntitle: needs: quoting\n---\n`, "11111111.md"),
    (error) => error instanceof StorageError && error.code === "INVALID_INPUT"
  );
});

test("serializeIssue/parseIssue preserve descriptions with a multiline title", () => {
  const issue = completeIssue({ title: "Issue line one\nIssue line two", description: "Only the description." });

  assert.deepEqual(parseIssue(serializeIssue(issue), "11111111.md"), issue);
});

test("validation null and empty arrays remain explicit", () => {
  const issue = completeIssue({ validation: null, depends_on: [], covers: [], tasks: [] });

  assert.deepEqual(parseIssue(serializeIssue(issue), "11111111.md"), issue);
});

for (const [label, fragment] of [
  ["tag", "title: !!str bad"],
  ["anchor", "title: &name bad"],
  ["alias", "title: *name"],
  ["merge", "<<: *defaults"],
]) {
  test(`parseIssue rejects YAML ${label}`, () => {
    assert.throws(
      () => parseIssue(`---\nid: ${ID_ONE}\n${fragment}\n---\n`, "11111111.md"),
      (error) => error instanceof StorageError && error.code === "INVALID_INPUT"
    );
  });
}

for (const [label, fragment] of [
  ["local tag", "title: !custom value"],
  ["numeric anchor", "title: &1 value"],
  ["numeric alias", "title: *1"],
]) {
  test(`parseIssue rejects YAML ${label}`, () => {
    assert.throws(
      () => parseIssue(`---\nid: ${ID_ONE}\n${fragment}\n---\n`, "11111111.md"),
      (error) => error instanceof StorageError && error.code === "INVALID_INPUT"
    );
  });
}

for (const [label, fragment] of [
  ["tag", "depends_on: [!!str bad]"],
  ["anchor", "depends_on: [&name]"],
  ["alias", "depends_on: [*name]"],
  ["local tag", "depends_on: [!custom]"],
  ["numeric anchor", "depends_on: [&1]"],
  ["numeric alias", "depends_on: [*1]"],
]) {
  test(`parseIssue rejects YAML ${label} in a flow sequence`, () => {
    assert.throws(
      () => parseIssue(`---\nid: ${ID_ONE}\n${fragment}\n---\n`, "11111111.md"),
      (error) => error instanceof StorageError && error.code === "INVALID_INPUT"
    );
  });
}

test("serializeIssue JSON-quotes indicator-leading strings", () => {
  const serialized = serializeIssue(
    completeIssue({
      title: "!custom value",
      tasks: [{ id: 1, short_title: "&1 value", full_description: "*1", checked: false }],
    })
  );

  assert.match(serialized, /^title: "!custom value"$/m);
  assert.match(serialized, /^    short_title: "&1 value"$/m);
  assert.match(serialized, /^    full_description: "\*1"$/m);
});

test("frontmatter title wins over a divergent rendered H1", () => {
  const parsed = parseIssue(
    serializeIssue(completeIssue()).replace("# Issue One", "# Edited by hand"),
    "11111111.md"
  );

  assert.equal(parsed.title, "Issue One");
});

test("classifyStorage distinguishes empty, markdown, legacy, and conflict", () => {
  const empty = tempProject();
  const markdown = tempProject();
  const legacy = tempProject();
  const conflict = tempProject();
  try {
    mkdirSync(path.join(markdown, ".harness", "issues"), { recursive: true });
    writeFileSync(path.join(legacy, "issues.json"), "{}", "utf8");
    mkdirSync(path.join(legacy, ".harness", "issues"), { recursive: true });
    writeFileSync(path.join(conflict, "issues.json"), "{}", "utf8");
    writeRawIssue(conflict, "backlog-11111111.md", completeIssue());

    assert.equal(classifyStorage(empty).kind, "empty");
    assert.equal(classifyStorage(markdown).kind, "markdown");
    assert.equal(classifyStorage(legacy).kind, "legacy");
    assert.equal(classifyStorage(conflict).kind, "conflict");
  } finally {
    cleanup(empty);
    cleanup(markdown);
    cleanup(legacy);
    cleanup(conflict);
  }
});

test("writeIssue stores one atomic file named by short id", () => {
  const dir = tempProject();
  try {
    const stored = writeIssue(dir, completeIssue());

    assert.equal(stored, path.join(dir, ".harness", "issues", "backlog-11111111.md"));
    assert.deepEqual(readIssue(dir, ID_ONE), completeIssue());
    assert.deepEqual(readdirSync(path.dirname(stored)), ["backlog-11111111.md"]);
  } finally {
    cleanup(dir);
  }
});

test("writeIssue atomically replaces only its target file", () => {
  const dir = tempProject();
  try {
    writeIssue(dir, completeIssue());
    writeIssue(dir, completeIssue({ title: "Updated title", updated_at: "2026-08-17T11:00:00.000Z" }));

    const issuesDir = path.join(dir, ".harness", "issues");
    assert.deepEqual(readdirSync(issuesDir), ["backlog-11111111.md"]);
    assert.equal(readIssue(dir, ID_ONE).title, "Updated title");
  } finally {
    cleanup(dir);
  }
});

test("readAllIssues rejects invalid issue filenames", () => {
  const dir = tempProject();
  try {
    writeRawIssue(dir, "not-an-id.md", completeIssue());

    assert.throws(
      () => readAllIssues(dir),
      (error) => error instanceof StorageError && error.code === "INVALID_INPUT"
    );
  } finally {
    cleanup(dir);
  }
});

test("readAllIssues rejects a filename that disagrees with its issue id", () => {
  const dir = tempProject();
  try {
    writeRawIssue(dir, "backlog-11111111.md", completeIssue({ id: ID_TWO }));

    assert.throws(
      () => readAllIssues(dir),
      (error) => error instanceof StorageError && error.code === "INVALID_INPUT"
    );
  } finally {
    cleanup(dir);
  }
});

test("readIssue ignores unrelated malformed files", () => {
  const dir = tempProject();
  try {
    writeIssue(dir, completeIssue());
    writeFileSync(path.join(dir, ".harness", "issues", "not-an-id.md"), "broken", "utf8");

    assert.deepEqual(readIssue(dir, ID_ONE), completeIssue());
  } finally {
    cleanup(dir);
  }
});

test("readAllIssues rejects colliding prefixes", () => {
  const dir = tempProject();
  try {
    writeRawIssue(dir, "backlog-11111111.md", completeIssue({ id: ID_ONE }));
    writeRawIssue(dir, "collision.md", completeIssue({ id: COLLIDING_ID }));

    assert.throws(
      () => readAllIssues(dir),
      (error) => error instanceof StorageError && error.code === "ID_COLLISION"
    );
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// The status lives in the file name. A directory listing is the cheapest view of a tracker there
// is, and one of hex ids answers nothing at all — not what state the work is in, not how much of
// it is in each state. The cost is that the path is no longer a pure function of the id: whoever
// reads or deletes has to find the file, and whoever writes has to clean up the old name.
// ---------------------------------------------------------------------------

test("the file name carries the status, so a listing groups by it", () => {
  const dir = tempProject();
  try {
    for (const [id, status] of [
      [ID_ONE, "in_progress"],
      [ID_TWO, "done"],
    ]) {
      writeIssue(dir, completeIssue({ id, status }));
    }

    assert.deepEqual(readdirSync(path.join(dir, ".harness", "issues")).sort(), [
      "done-22222222.md",
      "in_progress-11111111.md",
    ]);
  } finally {
    cleanup(dir);
  }
});

test("a status change renames the file and leaves exactly one behind", () => {
  const dir = tempProject();
  try {
    writeIssue(dir, completeIssue());
    const issuesDir = path.join(dir, ".harness", "issues");
    assert.deepEqual(readdirSync(issuesDir), ["backlog-11111111.md"]);

    writeIssue(dir, completeIssue({ status: "in_review" }));

    assert.deepEqual(readdirSync(issuesDir), ["in_review-11111111.md"], "the old name must not survive");
    assert.equal(readIssue(dir, ID_ONE).status, "in_review");
  } finally {
    cleanup(dir);
  }
});

test("two files for one id fail loudly, naming both", () => {
  const dir = tempProject();
  try {
    // What a crash between the write and the cleanup would leave. It is the whole reason the status
    // goes in the name rather than into a generated index: a stale index is wrong in silence, while
    // this is a refusal that says which two files disagree.
    writeRawIssue(dir, "backlog-11111111.md", completeIssue());
    writeRawIssue(dir, "done-11111111.md", completeIssue({ status: "done" }));

    assert.throws(
      () => readAllIssues(dir),
      (error) =>
        error instanceof StorageError &&
        error.code === "ID_COLLISION" &&
        error.message.includes("backlog-11111111.md") &&
        error.message.includes("done-11111111.md")
    );
    assert.throws(
      () => readIssue(dir, ID_ONE),
      (error) => error instanceof StorageError && error.code === "ID_COLLISION"
    );
  } finally {
    cleanup(dir);
  }
});

test("a status change that fails to write leaves the issue where it was", () => {
  const dir = tempProject();
  try {
    writeIssue(dir, completeIssue());

    // This is the ORDER of the rename, tested by its consequence rather than by watching the
    // calls. Every other test here checks what survives a SUCCESSFUL status change, and all of
    // them stay green if the two steps are swapped — remove the old name first, then write the new
    // one — at which point a failure in between loses the issue entirely instead of leaving two
    // files a reader refuses loudly. A title that is not a string fails inside the write, which is
    // the only moment where the two orders differ in what they leave behind.
    assert.throws(
      () => writeIssue(dir, completeIssue({ status: "in_review", title: 42 })),
      (error) => error instanceof StorageError
    );

    assert.deepEqual(readIssue(dir, ID_ONE), completeIssue(), "the stored issue must be untouched");
    assert.deepEqual(
      readdirSync(path.join(dir, ".harness", "issues")),
      ["backlog-11111111.md"],
      "no half-written file, and no lost one"
    );
  } finally {
    cleanup(dir);
  }
});

test("readAllIssues rejects a name whose status prefix contradicts the frontmatter", () => {
  const dir = tempProject();
  try {
    writeRawIssue(dir, "done-11111111.md", completeIssue({ status: "backlog" }));

    assert.throws(
      () => readAllIssues(dir),
      (error) => error instanceof StorageError && error.code === "INVALID_INPUT"
    );
  } finally {
    cleanup(dir);
  }
});

for (const [label, fileName] of [
  ["a prefix outside the five statuses", "wip-11111111.md"],
  ["a prefix that contradicts the frontmatter", "done-11111111.md"],
  ["no prefix at all", "11111111.md"],
]) {
  test(`readIssue rejects ${label}`, () => {
    const dir = tempProject();
    try {
      // The single read has to refuse exactly what the full read refuses. A guard that only fires
      // when someone happens to list the whole tracker is a guard that lets --get hand back an
      // issue whose file name says something else — and the file name is the half people read at a
      // glance and believe.
      writeRawIssue(dir, fileName, completeIssue({ status: "backlog" }));

      assert.throws(
        () => readIssue(dir, ID_ONE),
        (error) => error instanceof StorageError && error.code === "INVALID_INPUT"
      );
    } finally {
      cleanup(dir);
    }
  });
}

test("readIssue and deleteIssueFile find the file from the id alone, whatever the status", () => {
  const dir = tempProject();
  try {
    writeIssue(dir, completeIssue({ status: "blocked" }));

    assert.equal(readIssue(dir, ID_ONE).status, "blocked", "the caller never has to know the status");
    deleteIssueFile(dir, ID_ONE);
    assert.deepEqual(readdirSync(path.join(dir, ".harness", "issues")), []);
  } finally {
    cleanup(dir);
  }
});

test("issuePath rejects a status that is not one of the five", () => {
  const dir = tempProject();
  try {
    assert.throws(
      () => issuePath(dir, ID_ONE, "almost_done"),
      (error) => error instanceof StorageError && error.code === "INVALID_INPUT"
    );
  } finally {
    cleanup(dir);
  }
});

test("issuePath and readIssue reject invalid ids without touching storage", () => {
  const dir = tempProject();
  try {
    assert.throws(
      () => issuePath(dir, "not-a-guid", "backlog"),
      (error) => error instanceof StorageError && error.code === "INVALID_INPUT"
    );
    assert.throws(
      () => readIssue(dir, "not-a-guid"),
      (error) => error instanceof StorageError && error.code === "INVALID_INPUT"
    );
  } finally {
    cleanup(dir);
  }
});

test("readIssue returns null for a missing target and deleteIssueFile removes only that issue", () => {
  const dir = tempProject();
  try {
    writeIssue(dir, completeIssue());
    writeIssue(dir, completeIssue({ id: ID_TWO, title: "Issue Two" }));

    assert.equal(readIssue(dir, "33333333-3333-3333-3333-333333333333"), null);
    deleteIssueFile(dir, ID_ONE);
    assert.equal(readIssue(dir, ID_ONE), null);
    assert.deepEqual(readIssue(dir, ID_TWO), completeIssue({ id: ID_TWO, title: "Issue Two" }));
    assert.ok(existsSync(path.join(dir, ".harness", "issues", "backlog-22222222.md")));
  } finally {
    cleanup(dir);
  }
});
