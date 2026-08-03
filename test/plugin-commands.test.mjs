// Structural checks on the plugin's slash commands. A command with a broken frontmatter, a
// dangling script path, or a name that drifted from the README fails silently — it simply never
// shows up, or shows up and runs the wrong thing. These are the parts a test can hold.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const commandsDir = path.join(rootDir, "commands");

// The names are part of the contract: they are what the user types and what the README documents.
const COMMANDS = ["board", "compact", "issue", "verify"];

function commandFiles() {
  return readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
}

function read(name) {
  const file = path.join(commandsDir, `${name}.md`);
  assert.ok(existsSync(file), `commands/${name}.md must exist`);
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

test("the plugin ships exactly the documented commands", () => {
  assert.deepEqual(
    commandFiles().sort(),
    COMMANDS.map((c) => `${c}.md`).sort(),
    "an undocumented command file is a command nobody knows exists"
  );
});

test("every command carries a description and an argument hint", () => {
  for (const name of COMMANDS) {
    const fields = parseFrontmatter(read(name), `commands/${name}.md`);
    assert.ok(
      fields.description && fields.description.length > 40,
      `commands/${name}.md needs a description: it is the only text the user reads in the list`
    );
    assert.ok(
      !("name" in fields),
      `commands/${name}.md must not declare a name: the filename is the command name`
    );
    assert.ok(fields["argument-hint"], `commands/${name}.md must hint at its arguments`);
  }
});

test("every command says what it does without arguments", () => {
  // Each command must be invocable bare, so the prompt has to cover the no-argument case.
  for (const name of COMMANDS) {
    const fields = parseFrontmatter(read(name), `commands/${name}.md`);
    assert.match(
      fields.description,
      /senza argomenti/i,
      `the description of commands/${name}.md must state the no-argument behaviour`
    );
    assert.match(
      body(read(name)),
      /nessun argomento|\$ARGUMENTS. è vuoto|vuoto = /i,
      `commands/${name}.md must handle the bare invocation, not just the happy path`
    );
  }
});

test("commands invoke the plugin's scripts through the plugin root", () => {
  for (const name of COMMANDS) {
    const content = read(name);
    const invocations = [...content.matchAll(/node "?([^"\s]*\.mjs)/g)].map((m) => m[1]);
    for (const invocation of invocations) {
      assert.ok(
        invocation.includes("CLAUDE_PLUGIN_ROOT"),
        `commands/${name}.md runs '${invocation}', which assumes a copy of the script in the project`
      );
    }
  }
});

test("every plugin path a command names resolves to a real file", () => {
  for (const name of COMMANDS) {
    const content = read(name);
    for (const match of content.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      assert.ok(
        existsSync(path.join(rootDir, match[1])),
        `commands/${name}.md points at ${match[1]}, which the plugin does not ship`
      );
    }
  }
});

test("commands point at the skill instead of restating it", () => {
  for (const name of COMMANDS) {
    const content = read(name);
    assert.match(
      content,
      /skills\/harness\/references\/[a-z-]+\.md/,
      `commands/${name}.md must link the reference that owns the contract`
    );
    assert.ok(
      body(content).length < 4000,
      `commands/${name}.md is long enough to be a second copy of the workflow; the skill is the source`
    );
  }
});

test("the issue command cannot close an issue", () => {
  // Closing is the verifier's job; a shortcut that sets done/pass would hand the worker a way
  // around the independent verification.
  const content = read("issue");
  assert.ok(
    !/"status"\s*:\s*"done"/.test(content) && !/"state"\s*:\s*"pass"/.test(content),
    "commands/issue.md must not hand out a done/pass payload"
  );
  assert.match(body(content), /harness:verify/, "it must send the closure to the verify command");
});

test("the verify command delegates to an agent that exists and forbids self-verification", () => {
  const content = read("verify");
  const agentName = "harness-verifier";
  assert.match(content, new RegExp(agentName), "verify must name the verifier agent");
  assert.ok(
    existsSync(path.join(rootDir, "agents", `${agentName}.md`)),
    `commands/verify.md delegates to ${agentName}, which the plugin does not ship`
  );
  assert.match(
    body(content),
    /non eseguire tu/i,
    "verify must forbid running the checks inline, or it becomes self-verification"
  );
  const fields = parseFrontmatter(content, "commands/verify.md");
  assert.match(
    fields["allowed-tools"] ?? "",
    /\bTask\b/,
    "verify needs the Task tool to launch the verifier subagent"
  );
});

test("the compact command waits for confirmation before calling the primitive", () => {
  // A wrong grouping, once written, is an archive to undo by hand: the primitive must never be
  // called on a payload the user has not explicitly confirmed.
  const content = read("compact");
  assert.match(
    body(content),
    /conferma/i,
    "commands/compact.md must require explicit user confirmation before archiving"
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

test("the compact command projects id and title when it reads the done issues", () => {
  // --get-all hands back whole issue objects — 162.5KB for 88 issues on this repository — of
  // which the proposal uses two fields. Reading them unprojected starves the very sessions
  // that most need compacting.
  const content = body(read("compact"));
  const readStep = content
    .split("\n")
    .find((line) => line.includes("--get-all") && line.includes("--status done"));
  assert.ok(readStep, "commands/compact.md must show how to read the done issues");
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

test("the README documents the commands under the names the plugin ships", () => {
  const readme = readFileSync(path.join(rootDir, "README.md"), "utf8");
  const documented = new Set(
    [...readme.matchAll(/\/harness:([a-z-]+)/g)].map((m) => m[1])
  );
  for (const name of COMMANDS) {
    assert.ok(documented.has(name), `the README never mentions /harness:${name}`);
  }
  for (const name of documented) {
    assert.ok(
      COMMANDS.includes(name),
      `the README documents /harness:${name}, which the plugin does not ship`
    );
  }
});
