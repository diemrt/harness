// The external worker runner has two promises worth testing directly: HARNESS_ROLE=worker really
// reaches the child process (and, through it, blocks self-validation at the issue-manager layer),
// and the {promptFile} placeholder really gets replaced with a real, long-form path rather than a
// Windows 8.3 short name a CLI might not resolve. Everything else (config reading, logging, exit
// code propagation) is exercised through a small node script used as a stand-in CLI, so none of
// this depends on any real external CLI being installed.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(rootDir, "scripts", "harness-worker.mjs");
const ISSUE_MANAGER = path.join(rootDir, "scripts", "issue-manager.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: "utf8", cwd });
}

function assertEnvelope(result) {
  assert.equal(result.stderr, "", "stderr must be empty");
  const lines = result.stdout.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1, `stdout must be exactly one line, got: ${JSON.stringify(result.stdout)}`);
  return JSON.parse(lines[0]);
}

function assertOk(result) {
  const parsed = assertEnvelope(result);
  assert.equal(parsed.ok, true, `expected success, got: ${JSON.stringify(parsed)}`);
  return parsed.data;
}

function assertFail(result, code) {
  const parsed = assertEnvelope(result);
  assert.equal(result.status, 1, "exit code must be 1 on failure");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, code);
  return parsed;
}

function tempProject() {
  return mkdtempSync(path.join(tmpdir(), "harness-worker-"));
}

function writeConfig(dir, externalWorker) {
  mkdirSync(path.join(dir, ".harness"), { recursive: true });
  writeFileSync(
    path.join(dir, ".harness", "config.json"),
    JSON.stringify({ setup: null, verify: "npm test", externalWorker, docsGate: { enabled: false } }, null, 2),
    "utf8"
  );
}

// A quoted `node <script> {promptFile}` template: quoting is the template author's job (this
// script never auto-quotes the substituted path, so the test mirrors real usage instead of
// hiding a hazard real templates would hit).
function nodeCommand(scriptPath, extraArgs = "") {
  return `"${process.execPath}" "${scriptPath}" {promptFile}${extraArgs ? " " + extraArgs : ""}`;
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// --help
// ---------------------------------------------------------------------------

test("--help prints plain text, not the JSON envelope", () => {
  const result = run(rootDir, ["--help"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Usage:/);
  assert.throws(() => JSON.parse(result.stdout), "help text must not be a single JSON envelope line");
});

// ---------------------------------------------------------------------------
// config reading
// ---------------------------------------------------------------------------

test("--check without a harness configuration fails with CONFIG_NOT_FOUND", () => {
  const dir = tempProject();
  try {
    assertFail(run(dir, ["--check"]), "CONFIG_NOT_FOUND");
  } finally {
    cleanup(dir);
  }
});

test("--check with the external worker disabled fails with WORKER_DISABLED", () => {
  const dir = tempProject();
  try {
    writeConfig(dir, { enabled: false, command: "some-cli -p {promptFile}" });
    assertFail(run(dir, ["--check"]), "WORKER_DISABLED");
  } finally {
    cleanup(dir);
  }
});

test("--check with no externalWorker block at all also fails with WORKER_DISABLED", () => {
  const dir = tempProject();
  try {
    writeConfig(dir, undefined);
    assertFail(run(dir, ["--check"]), "WORKER_DISABLED");
  } finally {
    cleanup(dir);
  }
});

test("--check with a command missing the {promptFile} placeholder fails with INVALID_COMMAND", () => {
  const dir = tempProject();
  try {
    writeConfig(dir, { enabled: true, command: "some-cli -p prompt.txt" });
    assertFail(run(dir, ["--check"]), "INVALID_COMMAND");
  } finally {
    cleanup(dir);
  }
});

test("a malformed config.json fails with INVALID_JSON", () => {
  const dir = tempProject();
  try {
    mkdirSync(path.join(dir, ".harness"), { recursive: true });
    writeFileSync(path.join(dir, ".harness", "config.json"), "{ not json", "utf8");
    assertFail(run(dir, ["--check"]), "INVALID_JSON");
  } finally {
    cleanup(dir);
  }
});

test("--project-dir configures that project, not the cwd", () => {
  const target = tempProject();
  const elsewhere = tempProject();
  try {
    writeConfig(target, { enabled: false, command: null });
    // elsewhere has no config at all; running from there but pointing at target must still see it
    assertFail(run(elsewhere, ["--check", "--project-dir", target]), "WORKER_DISABLED");
  } finally {
    cleanup(target);
    cleanup(elsewhere);
  }
});

test("an unrecognized invocation fails with UNKNOWN_COMMAND", () => {
  const dir = tempProject();
  try {
    assertFail(run(dir, []), "UNKNOWN_COMMAND");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// --check : CLI-agnostic preflight, exercised against a stand-in CLI
// ---------------------------------------------------------------------------

test("--check passes against a stand-in CLI that answers READY", () => {
  const dir = tempProject();
  const cliPath = path.join(dir, "mock-cli.mjs");
  writeFileSync(
    cliPath,
    "import { readFileSync } from 'node:fs';\n" +
      "const promptFile = process.argv[2];\n" +
      "console.log(readFileSync(promptFile, 'utf8'));\n" +
      "console.log('READY');\n" +
      "process.exit(0);\n",
    "utf8"
  );
  try {
    writeConfig(dir, { enabled: true, command: nodeCommand(cliPath) });
    const data = assertOk(run(dir, ["--check"]));
    assert.equal(data.exitCode, 0);
    assert.match(data.output, /READY/);
    assert.match(data.output, /Reply exactly READY/, "the smoke prompt content must reach the CLI");
  } finally {
    cleanup(dir);
  }
});

test("--check substitutes {promptFile} with a real, long-form absolute path, never a raw 8.3 short name", () => {
  const dir = tempProject();
  const cliPath = path.join(dir, "mock-cli.mjs");
  writeFileSync(
    cliPath,
    "console.log('PATH=' + process.argv[2]);\nconsole.log('READY');\nprocess.exit(0);\n",
    "utf8"
  );
  try {
    writeConfig(dir, { enabled: true, command: nodeCommand(cliPath) });
    const data = assertOk(run(dir, ["--check"]));
    assert.doesNotMatch(data.command, /{promptFile}/, "the placeholder must be gone from the resolved command");
    const match = data.output.match(/PATH=(.*)/);
    assert.ok(match, "the CLI must have received the prompt file path");
    const receivedPath = match[1].trim();
    assert.ok(path.isAbsolute(receivedPath), "the received path must be absolute");
    assert.doesNotMatch(receivedPath, /~\d/, "the substituted prompt file path must not be an 8.3 short name");
  } finally {
    cleanup(dir);
  }
});

test("--check fails with CHECK_FAILED when the CLI neither exits 0 nor says READY", () => {
  const dir = tempProject();
  const cliPath = path.join(dir, "mock-cli.mjs");
  writeFileSync(cliPath, "console.log('nope');\nprocess.exit(3);\n", "utf8");
  try {
    writeConfig(dir, { enabled: true, command: nodeCommand(cliPath) });
    const failure = assertFail(run(dir, ["--check"]), "CHECK_FAILED");
    assert.match(failure.error, /nope/, "the diagnostic output should be surfaced in the error message");
  } finally {
    cleanup(dir);
  }
});

test("--check cleans up its smoke-test prompt file", () => {
  const dir = tempProject();
  const cliPath = path.join(dir, "mock-cli.mjs");
  writeFileSync(cliPath, "console.log('READY');\nprocess.exit(0);\n", "utf8");
  try {
    writeConfig(dir, { enabled: true, command: nodeCommand(cliPath) });
    const data = assertOk(run(dir, ["--check"]));
    const match = data.command.match(/harness-worker-check-[^"]+\.txt/);
    assert.ok(match, "expected a smoke-test prompt file path in the resolved command");
    assert.equal(existsSync(path.join(tmpdir(), match[0])), false, "the temp prompt file must be removed after the check");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// --run : argument validation
// ---------------------------------------------------------------------------

test("--run without --issue-id or --prompt-file fails with MISSING_ARGS", () => {
  const dir = tempProject();
  try {
    writeConfig(dir, { enabled: true, command: "some-cli -p {promptFile}" });
    assertFail(run(dir, ["--run"]), "MISSING_ARGS");
    assertFail(run(dir, ["--run", "--issue-id", "abc"]), "MISSING_ARGS");
    assertFail(run(dir, ["--run", "--prompt-file", "x.txt"]), "MISSING_ARGS");
  } finally {
    cleanup(dir);
  }
});

test("--run with a prompt file that does not exist fails with FILE_NOT_FOUND", () => {
  const dir = tempProject();
  try {
    writeConfig(dir, { enabled: true, command: "some-cli -p {promptFile}" });
    assertFail(
      run(dir, ["--run", "--issue-id", "abc", "--prompt-file", path.join(dir, "nope.txt")]),
      "FILE_NOT_FOUND"
    );
  } finally {
    cleanup(dir);
  }
});

test("--run with the external worker disabled fails with WORKER_DISABLED before even checking the prompt file", () => {
  const dir = tempProject();
  try {
    writeConfig(dir, { enabled: false, command: "some-cli -p {promptFile}" });
    assertFail(
      run(dir, ["--run", "--issue-id", "abc", "--prompt-file", path.join(dir, "nope.txt")]),
      "WORKER_DISABLED"
    );
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// --run : the real run — spawn, env, log, exit code
// ---------------------------------------------------------------------------

function writeEchoCli(dir) {
  const cliPath = path.join(dir, "echo-cli.mjs");
  writeFileSync(
    cliPath,
    "import { readFileSync } from 'node:fs';\n" +
      "const promptFile = process.argv[2];\n" +
      "console.log('HARNESS_ROLE=' + (process.env.HARNESS_ROLE || ''));\n" +
      "console.log('PROMPT_PATH=' + promptFile);\n" +
      "console.log('PROMPT_CONTENT=' + readFileSync(promptFile, 'utf8'));\n" +
      "process.exit(0);\n",
    "utf8"
  );
  return cliPath;
}

test("--run sets HARNESS_ROLE=worker on the child and substitutes the prompt file", () => {
  const dir = tempProject();
  const cliPath = writeEchoCli(dir);
  const promptFile = path.join(dir, "prompt.txt");
  writeFileSync(promptFile, "do the thing", "utf8");
  try {
    writeConfig(dir, { enabled: true, command: nodeCommand(cliPath) });
    const data = assertOk(run(dir, ["--run", "--issue-id", "issue-1", "--prompt-file", promptFile]));

    assert.equal(data.exitCode, 0);
    assert.match(data.output, /HARNESS_ROLE=worker/, "the child must see HARNESS_ROLE=worker");
    assert.match(data.output, /PROMPT_CONTENT=do the thing/);
    assert.doesNotMatch(data.command, /{promptFile}/);
  } finally {
    cleanup(dir);
  }
});

test("--run propagates the child's exit code as this process's own exit code", () => {
  const dir = tempProject();
  const cliPath = path.join(dir, "failing-cli.mjs");
  writeFileSync(cliPath, "console.log('boom');\nprocess.exit(7);\n", "utf8");
  const promptFile = path.join(dir, "prompt.txt");
  writeFileSync(promptFile, "prompt", "utf8");
  try {
    writeConfig(dir, { enabled: true, command: nodeCommand(cliPath) });
    const result = run(dir, ["--run", "--issue-id", "issue-2", "--prompt-file", promptFile]);
    assert.equal(result.status, 7, "the runner's own exit code must equal the child's exit code");
    const parsed = assertEnvelope(result);
    assert.equal(parsed.ok, true, "ok:true even though the child failed: the run itself was completed");
    assert.equal(parsed.data.exitCode, 7);
  } finally {
    cleanup(dir);
  }
});

test("--run writes a log under .harness/runs/<issueId>-<timestamp>.log with the resolved command at the head", () => {
  const dir = tempProject();
  const cliPath = path.join(dir, "cli.mjs");
  writeFileSync(cliPath, "console.log('hello from worker');\nprocess.exit(0);\n", "utf8");
  const promptFile = path.join(dir, "prompt.txt");
  writeFileSync(promptFile, "prompt", "utf8");
  try {
    writeConfig(dir, { enabled: true, command: nodeCommand(cliPath) });
    const data = assertOk(run(dir, ["--run", "--issue-id", "log-issue", "--prompt-file", promptFile]));

    assert.equal(
      data.logPath,
      path.join(realpathSync(dir), ".harness", "runs", path.basename(data.logPath))
    );
    assert.match(path.basename(data.logPath), /^log-issue-\d+\.log$/);
    assert.equal(existsSync(data.logPath), true);

    const logContent = readFileSync(data.logPath, "utf8");
    const firstLine = logContent.split("\n")[0];
    assert.equal(firstLine, `Command: ${data.command}`, "the resolved command line must lead the log");
    assert.match(logContent, /hello from worker/, "the child's output must be captured");
    assert.match(logContent, /Exit code: 0/, "the exit code must be recorded in the log too");
  } finally {
    cleanup(dir);
  }
});

test("--run still writes the log when the child fails", () => {
  const dir = tempProject();
  const cliPath = path.join(dir, "failing-cli.mjs");
  writeFileSync(cliPath, "console.error('bad'); process.exit(2);\n", "utf8");
  const promptFile = path.join(dir, "prompt.txt");
  writeFileSync(promptFile, "prompt", "utf8");
  try {
    writeConfig(dir, { enabled: true, command: nodeCommand(cliPath) });
    const result = run(dir, ["--run", "--issue-id", "fail-issue", "--prompt-file", promptFile]);
    const parsed = assertEnvelope(result);
    assert.equal(result.status, 2);
    const logContent = readFileSync(parsed.data.logPath, "utf8");
    assert.match(logContent, /bad/);
    assert.match(logContent, /Exit code: 2/);
  } finally {
    cleanup(dir);
  }
});

test("--run substitutes a real long-form absolute path even when the caller passes a relative one", () => {
  const dir = tempProject();
  const cliPath = writeEchoCli(dir);
  writeFileSync(path.join(dir, "prompt.txt"), "relative prompt", "utf8");
  try {
    writeConfig(dir, { enabled: true, command: nodeCommand(cliPath) });
    const data = assertOk(run(dir, ["--run", "--issue-id", "rel-issue", "--prompt-file", "prompt.txt"]));
    const match = data.output.match(/PROMPT_PATH=(.*)/);
    assert.ok(match);
    const receivedPath = match[1].trim();
    assert.ok(path.isAbsolute(receivedPath), "the child must receive an absolute path");
    assert.equal(receivedPath, realpathSync.native(path.join(dir, "prompt.txt")));
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// integration: HARNESS_ROLE=worker actually blocks self-validation at the issue-manager layer
// ---------------------------------------------------------------------------

test("a worker launched by --run cannot close its own issue: issue-manager rejects with FORBIDDEN_ROLE", () => {
  const dir = tempProject();
  const cliPath = path.join(dir, "self-closing-cli.mjs");
  writeFileSync(
    cliPath,
    "import { spawnSync } from 'node:child_process';\n" +
      "const [, , promptFile, issueManagerPath, projectDir, issueId] = process.argv;\n" +
      "const result = spawnSync(process.execPath, [issueManagerPath, '--update', '--issue-id', issueId, '--expected-revision', '1',\n" +
      "  '--issue-data', JSON.stringify({ status: 'done' }), '--project-dir', projectDir], { encoding: 'utf8' });\n" +
      "console.log('SELF_CLOSE_STDOUT=' + result.stdout.trim());\n" +
      "console.log('SELF_CLOSE_STATUS=' + result.status);\n" +
      "process.exit(0);\n",
    "utf8"
  );
  const promptFile = path.join(dir, "prompt.txt");
  writeFileSync(promptFile, "close the issue", "utf8");

  try {
    // Seed a real issue through the real tracker.
    const inserted = spawnSync(
      process.execPath,
      [
        ISSUE_MANAGER,
        "--insert",
        "--project-dir",
        dir,
        "--issue-data",
        // An issue in flight declares its steps, so the seed carries one: the tracker refuses
        // in_progress with an empty tasks, and this fixture is a real issue taken by a real worker.
        JSON.stringify({
          title: "Worker task",
          description: "d",
          status: "in_progress",
          tasks: [{ id: 1, short_title: "close it", full_description: "try to close the issue", checked: false }],
        }),
      ],
      { encoding: "utf8" }
    );
    const issueId = JSON.parse(inserted.stdout.trim().split("\n").pop()).data.id;

    writeConfig(dir, {
      enabled: true,
      command: nodeCommand(cliPath, `"${ISSUE_MANAGER}" "${dir}" ${issueId}`),
    });

    const data = assertOk(run(dir, ["--run", "--issue-id", issueId, "--prompt-file", promptFile]));

    assert.match(data.output, /SELF_CLOSE_STATUS=1/, "issue-manager must refuse the self-close attempt");
    assert.match(data.output, /FORBIDDEN_ROLE/, "the rejection must be FORBIDDEN_ROLE");

    // And the issue itself must really still not be done.
    const after = spawnSync(
      process.execPath,
      [ISSUE_MANAGER, "--get", "--project-dir", dir, "--issue-id", issueId],
      { encoding: "utf8" }
    );
    const afterData = JSON.parse(after.stdout.trim());
    assert.notEqual(afterData.data.status, "done", "the guard must have actually held, not just reported a rejection");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// the worker script writes nothing into the project outside .harness/runs/
// ---------------------------------------------------------------------------

test("--check writes nothing into the project", () => {
  const dir = tempProject();
  const cliPath = path.join(dir, "mock-cli.mjs");
  writeFileSync(cliPath, "console.log('READY');\nprocess.exit(0);\n", "utf8");
  writeConfig(dir, { enabled: true, command: nodeCommand(cliPath) });
  const before = readdirSync(dir).sort();
  try {
    assertOk(run(dir, ["--check"]));
    assert.deepEqual(readdirSync(dir).sort(), before, "a preflight must not leave files behind in the project");
  } finally {
    cleanup(dir);
  }
});
