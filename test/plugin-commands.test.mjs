// Structural checks on the operations the plugin ships. Each one lives in skills/<operation>/ and
// is registered by Claude Code as /harness:<operation> and by Codex as $<operation>. A skill with a
// broken frontmatter, a dangling script path, or a name that drifted from the README fails silently
// — it simply never shows up, or shows up and runs the wrong thing. These are the parts a test can
// hold.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const skillsDir = path.join(rootDir, "skills");

// The names are part of the contract: they are what the user types and what the README documents.
// `harness` is not here — it is the workflow skill, not an operation with its own entry point.
const OPERATIONS = ["compact", "docs-gate", "issue", "status", "sweep", "verify"];

function skillDirs() {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== "harness")
    .sort();
}

function read(name) {
  const file = path.join(skillsDir, name, "SKILL.md");
  assert.ok(existsSync(file), `skills/${name}/SKILL.md must exist`);
  return readFileSync(file, "utf8");
}

function parseFrontmatter(content, label) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, `${label} must open with a --- delimited frontmatter block`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv) {
      fields[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, "$1");
    }
  }
  return fields;
}

function body(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

test("the plugin ships exactly the documented operations", () => {
  assert.deepEqual(
    skillDirs(),
    [...OPERATIONS].sort(),
    "an undocumented skill directory is an operation nobody knows exists"
  );
});

test("no operation is defined twice", () => {
  // This is the guard for the defect that produced it. Claude Code merged custom commands into
  // skills: commands/<x>.md and skills/<x>/SKILL.md both register /harness:<x>, and the default
  // skills/ scan cannot be turned off (in a manifest the `skills` field adds to the defaults while
  // `commands` replaces them). Shipping both spellings of the same operation showed every harness
  // command twice in the / menu — silently, because nothing in the repository disagreed with
  // itself. The directory must stay gone: one operation, one definition.
  const legacyDir = path.join(rootDir, "commands");
  const legacy = existsSync(legacyDir)
    ? readdirSync(legacyDir)
        .filter((file) => file.endsWith(".md"))
        .map((file) => path.basename(file, ".md"))
    : [];
  const collisions = legacy.filter((name) => existsSync(path.join(skillsDir, name, "SKILL.md")));
  assert.deepEqual(
    collisions,
    [],
    `commands/ and skills/ both define ${collisions.join(", ")}: Claude Code registers each of them twice`
  );
  assert.deepEqual(
    legacy,
    [],
    "commands/ is back: it is the legacy Claude-only spelling, and skills/ is the only discovery location Codex and the Agent Plugins spec share"
  );
});

test("nothing an agent reads still points at a deleted command file", () => {
  // The other half of the same defect. Removing commands/ leaves the pointers behind: a reference
  // that says "see commands/issue.md" survives the deletion, resolves to nothing, and only fails
  // when an agent follows it mid-workflow. The collision guard above cannot see this — the file it
  // names is already gone. Bare `commands/` is allowed: install-check deliberately still watches
  // that directory in an installed copy.
  const corpus = [];
  function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (/\.(md|mjs|json)$/.test(entry.name)) corpus.push(full);
    }
  }
  collect(skillsDir);
  collect(path.join(rootDir, "scripts"));
  collect(path.join(rootDir, "agents"));
  for (const file of ["README.md", "CONTRIBUTING.md", "AGENTS.md", "CLAUDE.md"]) {
    const full = path.join(rootDir, file);
    if (existsSync(full)) corpus.push(full);
  }

  for (const file of corpus) {
    const match = readFileSync(file, "utf8").match(/commands\/[A-Za-z0-9_-]+\.md/);
    assert.equal(
      match,
      null,
      `${path.relative(rootDir, file)} points at ${match?.[0]}, which the plugin no longer ships`
    );
  }
});

test("every operation carries a name, a description and an argument hint", () => {
  for (const name of OPERATIONS) {
    const fields = parseFrontmatter(read(name), `skills/${name}/SKILL.md`);
    assert.equal(
      fields.name,
      name,
      `skills/${name}/SKILL.md must declare its own name: without it the invocation name falls back to the install directory`
    );
    assert.ok(
      fields.description && fields.description.length > 40,
      `skills/${name}/SKILL.md needs a description: it is the only text the user reads in the list`
    );
    assert.ok(fields["argument-hint"], `skills/${name}/SKILL.md must hint at its arguments`);
    assert.ok(
      fields["allowed-tools"],
      `skills/${name}/SKILL.md must declare the tools it needs, or every run stops on a permission prompt`
    );
  }
});

test("every operation says what it does without arguments", () => {
  // Each operation must be invocable bare, so the prompt has to cover the no-argument case.
  for (const name of OPERATIONS) {
    const fields = parseFrontmatter(read(name), `skills/${name}/SKILL.md`);
    assert.match(
      fields.description,
      /senza argomenti/i,
      `the description of skills/${name}/SKILL.md must state the no-argument behaviour`
    );
    assert.match(
      body(read(name)),
      /nessun argomento|\$ARGUMENTS. è vuoto|vuoto = /i,
      `skills/${name}/SKILL.md must handle the bare invocation, not just the happy path`
    );
  }
});

test("operations invoke the plugin's scripts through the plugin root", () => {
  for (const name of OPERATIONS) {
    const content = read(name);
    const invocations = [...content.matchAll(/node "?([^"\s]*\.mjs)/g)].map((m) => m[1]);
    for (const invocation of invocations) {
      assert.ok(
        invocation.includes("CLAUDE_PLUGIN_ROOT"),
        `skills/${name}/SKILL.md runs '${invocation}', which assumes a copy of the script in the project`
      );
    }
  }
});

test("every operation says how to resolve the plugin root where nothing substitutes it", () => {
  // ${CLAUDE_PLUGIN_ROOT} is substituted by Claude Code and by nobody else. Codex reads the same
  // file and would take it literally, so each skill has to give the derivation from the base
  // directory it is handed — and refuse to guess when it is not handed one, because a reused
  // absolute path carries a version number and keeps running against a stale copy instead of
  // failing.
  for (const name of OPERATIONS) {
    const content = body(read(name));
    assert.match(
      content,
      /base directory annunciata per questa skill/i,
      `skills/${name}/SKILL.md must derive the plugin root from the base the host announces`
    );
    assert.match(
      content,
      /<base della skill>\/\.\.\/\.\.\/scripts/,
      `skills/${name}/SKILL.md must give the derivation, not just name the variable`
    );
    assert.match(
      content,
      /fermati e chiedila/i,
      `skills/${name}/SKILL.md must fail closed instead of guessing an installed path`
    );
  }
});

test("every operation carries the Codex interface metadata next to it", () => {
  for (const name of OPERATIONS) {
    const file = path.join(skillsDir, name, "agents", "openai.yaml");
    assert.ok(existsSync(file), `skills/${name}/agents/openai.yaml is what names $${name} in Codex`);
    const content = readFileSync(file, "utf8");
    assert.match(content, /display_name:/, `${name} needs a display name in the Codex menu`);
    assert.match(content, /default_prompt:/, `${name} needs a default prompt in the Codex menu`);
  }
});

test("every plugin path an operation names resolves to a real file", () => {
  for (const name of OPERATIONS) {
    const content = read(name);
    for (const match of content.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      assert.ok(
        existsSync(path.join(rootDir, match[1])),
        `skills/${name}/SKILL.md points at ${match[1]}, which the plugin does not ship`
      );
    }
  }
});

test("operations point at the reference instead of restating it", () => {
  for (const name of OPERATIONS) {
    const content = read(name);
    assert.match(
      content,
      /skills\/harness\/references\/[a-z-]+\.md/,
      `skills/${name}/SKILL.md must link the reference that owns the contract`
    );
    assert.match(
      content,
      /skills\/harness\/SKILL\.md/,
      `skills/${name}/SKILL.md must name the workflow skill: on Codex it is the only way in`
    );
    assert.ok(
      body(content).length < 5000,
      `skills/${name}/SKILL.md is long enough to be a second copy of the workflow; the skill is the source`
    );
  }
});

test("the issue operation cannot close an issue", () => {
  // Closing is the verifier's job; a shortcut that sets done/pass would hand the worker a way
  // around the independent verification.
  const content = read("issue");
  assert.ok(
    !/"status"\s*:\s*"done"/.test(content) && !/"state"\s*:\s*"pass"/.test(content),
    "skills/issue/SKILL.md must not hand out a done/pass payload"
  );
  assert.match(
    body(content),
    /operazione\s+`verify`/,
    "it must send the closure to the verify operation"
  );
});

test("the verify operation delegates to an agent that exists and forbids self-verification", () => {
  const content = read("verify");
  const agentName = "harness-verifier";
  assert.match(content, new RegExp(agentName), "verify must name the verifier agent");
  assert.ok(
    existsSync(path.join(rootDir, "agents", `${agentName}.md`)),
    `skills/verify/SKILL.md delegates to ${agentName}, which the plugin does not ship`
  );
  assert.match(
    body(content),
    /non eseguire tu/i,
    "verify must forbid running the checks inline, or it becomes self-verification"
  );
  const fields = parseFrontmatter(content, "skills/verify/SKILL.md");
  assert.match(
    fields["allowed-tools"] ?? "",
    /\bTask\b/,
    "verify needs the Task tool to launch the verifier subagent"
  );
});

test("the compact operation waits for confirmation before calling the primitive", () => {
  // A wrong grouping, once written, is an archive to undo by hand: the primitive must never be
  // called on a payload the user has not explicitly confirmed.
  const content = read("compact");
  assert.match(
    body(content),
    /conferma/i,
    "skills/compact/SKILL.md must require explicit user confirmation before archiving"
  );
  assert.match(
    body(content),
    /--issue-data-file/,
    "compact must pass the confirmed payload by file, not inline, to avoid shell quote escaping"
  );
  assert.match(
    body(content),
    /INVALID_DEPENDENCY/,
    "compact must branch on INVALID_DEPENDENCY instead of retrying blindly"
  );
  assert.match(
    body(content),
    /FORBIDDEN_ROLE/,
    "compact must branch on FORBIDDEN_ROLE instead of retrying blindly"
  );
});

test("the compact operation projects id and title when it reads the done issues", () => {
  // --get-all hands back whole issue objects — 162.5KB for 88 issues on this repository — of
  // which the proposal uses two fields. Reading them unprojected starves the very sessions
  // that most need compacting.
  const content = body(read("compact"));
  const readStep = content
    .split("\n")
    .find((line) => line.includes("--get-all") && line.includes("--status done"));
  assert.ok(readStep, "skills/compact/SKILL.md must show how to read the done issues");
  assert.match(
    readStep,
    /\|\s*node -e/,
    "the read must be piped through a projection, not dumped whole into context"
  );
  assert.match(
    readStep,
    /\.title/,
    "the projection must keep the title: the grouping is judged on it"
  );
  assert.match(
    content,
    /--page\b/,
    "projecting fields must not drop the duty to walk every page"
  );
});

test("the README documents the operations under the names the plugin ships", () => {
  const readme = readFileSync(path.join(rootDir, "README.md"), "utf8");
  const documented = new Set(
    [...readme.matchAll(/\/harness:([a-z-]+)/g)].map((m) => m[1])
  );
  for (const name of OPERATIONS) {
    assert.ok(documented.has(name), `the README never mentions /harness:${name}`);
  }
  for (const name of documented) {
    assert.ok(
      OPERATIONS.includes(name),
      `the README documents /harness:${name}, which the plugin does not ship`
    );
  }
});
