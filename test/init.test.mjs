import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, copyFileSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const templateInitPath = join(rootDir, "template", "init.mjs");

/**
 * Creates an isolated temp directory with a copy of init.mjs and a
 * purpose-built init.config.json beside it, since init.mjs resolves its
 * config relative to its own location, not the process cwd.
 */
function createHarness(configObject) {
  const dir = mkdtempSync(join(tmpdir(), "harness-init-"));
  const initPath = join(dir, "init.mjs");
  copyFileSync(templateInitPath, initPath);
  if (configObject !== undefined) {
    writeFileSync(join(dir, "init.config.json"), JSON.stringify(configObject, null, 2), "utf8");
  }
  return { dir, initPath };
}

function runInit(initPath, args = []) {
  return spawnSync(process.execPath, [initPath, ...args], { encoding: "utf8" });
}

test("default task is 'setup' when no positional argument is given", () => {
  const { dir, initPath } = createHarness({
    tasks: {
      setup: {
        workingDirectory: ".",
        steps: [{ description: "step-setup", command: 'node -e "process.exit(0)"' }],
      },
      build: {
        workingDirectory: ".",
        steps: [{ description: "step-build", command: 'node -e "process.exit(0)"' }],
      },
    },
  });
  try {
    const result = runInit(initPath, []);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[setup] step-setup/);
    assert.match(result.stdout, /Task 'setup' completato\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("both 'setup' and 'build' tasks run their steps in order", () => {
  const { dir, initPath } = createHarness({
    tasks: {
      setup: {
        workingDirectory: ".",
        steps: [
          { description: "setup-step-1", command: 'node -e "process.exit(0)"' },
          { description: "setup-step-2", command: 'node -e "process.exit(0)"' },
        ],
      },
      build: {
        workingDirectory: ".",
        steps: [
          { description: "build-step-1", command: 'node -e "process.exit(0)"' },
          { description: "build-step-2", command: 'node -e "process.exit(0)"' },
        ],
      },
    },
  });
  try {
    const setupResult = runInit(initPath, ["setup"]);
    assert.equal(setupResult.status, 0);
    const setupOrder = [
      setupResult.stdout.indexOf("[setup] setup-step-1"),
      setupResult.stdout.indexOf("[setup] setup-step-2"),
    ];
    assert.ok(setupOrder[0] >= 0 && setupOrder[1] > setupOrder[0], "setup steps must run in order");
    assert.match(setupResult.stdout, /Task 'setup' completato\./);

    const buildResult = runInit(initPath, ["build"]);
    assert.equal(buildResult.status, 0);
    const buildOrder = [
      buildResult.stdout.indexOf("[build] build-step-1"),
      buildResult.stdout.indexOf("[build] build-step-2"),
    ];
    assert.ok(buildOrder[0] >= 0 && buildOrder[1] > buildOrder[0], "build steps must run in order");
    assert.match(buildResult.stdout, /Task 'build' completato\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing step halts the run and later steps do not execute", () => {
  const { dir, initPath } = createHarness({
    tasks: {
      setup: {
        workingDirectory: ".",
        steps: [
          { description: "ok-step", command: 'node -e "process.exit(0)"' },
          { description: "failing-step", command: 'node -e "process.exit(3)"' },
          { description: "never-runs-step", command: 'node -e "console.log(\'SHOULD_NOT_APPEAR\')" ' },
        ],
      },
    },
  });
  try {
    const result = runInit(initPath, ["setup"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[setup] ok-step/);
    assert.match(result.stdout, /\[setup] failing-step/);
    assert.doesNotMatch(result.stdout, /never-runs-step/);
    assert.doesNotMatch(result.stdout, /SHOULD_NOT_APPEAR/);
    assert.match(result.stderr, /failing-step/);
    assert.match(result.stderr, /exit code 3/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing init.config.json exits with code 1", () => {
  const { dir, initPath } = createHarness(undefined);
  try {
    const result = runInit(initPath, ["setup"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /file di configurazione non trovato/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid JSON config exits with code 1", () => {
  const { dir, initPath } = createHarness(undefined);
  try {
    writeFileSync(join(dir, "init.config.json"), "{ not valid json", "utf8");
    const result = runInit(initPath, ["setup"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /impossibile leggere\/parsare/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown task exits with code 1 and lists available tasks", () => {
  const { dir, initPath } = createHarness({
    tasks: {
      setup: { workingDirectory: ".", steps: [] },
      build: { workingDirectory: ".", steps: [] },
    },
  });
  try {
    const result = runInit(initPath, ["deploy"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Task non valido: 'deploy'/);
    assert.match(result.stderr, /setup/);
    assert.match(result.stderr, /build/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a step with a blank command exits with code 1", () => {
  const { dir, initPath } = createHarness({
    tasks: {
      setup: {
        workingDirectory: ".",
        steps: [{ description: "blank-command-step", command: "   " }],
      },
    },
  });
  try {
    const result = runInit(initPath, ["setup"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /senza 'command'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a task with zero steps prints a warning and exits with code 0", () => {
  const { dir, initPath } = createHarness({
    tasks: {
      setup: { workingDirectory: ".", steps: [] },
    },
  });
  try {
    const result = runInit(initPath, ["setup"]);
    assert.equal(result.status, 0);
    assert.match(result.stderr, /non ha step da eseguire/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Sottocomando 'worker' --------------------------------------------------

function baseConfig(externalWorker) {
  return {
    tasks: {
      setup: { workingDirectory: ".", steps: [] },
      build: { workingDirectory: ".", steps: [] },
    },
    ...(externalWorker !== undefined ? { externalWorker } : {}),
  };
}

function readConfig(dir) {
  return JSON.parse(readFileSync(join(dir, "init.config.json"), "utf8"));
}

test("worker on sets externalWorker.enabled to true, creating the block if missing", () => {
  const { dir, initPath } = createHarness(baseConfig());
  try {
    const result = runInit(initPath, ["worker", "on"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /abilitato/);
    const config = readConfig(dir);
    assert.equal(config.externalWorker.enabled, true);
    assert.match(config.externalWorker.command, /\{promptFile\}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker off sets externalWorker.enabled to false and preserves the existing command", () => {
  const { dir, initPath } = createHarness(
    baseConfig({ enabled: true, command: "my-cli -p {promptFile}" })
  );
  try {
    const result = runInit(initPath, ["worker", "off"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /disabilitato/);
    const config = readConfig(dir);
    assert.equal(config.externalWorker.enabled, false);
    assert.equal(config.externalWorker.command, "my-cli -p {promptFile}");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker check fails clearly when externalWorker.command is missing the {promptFile} placeholder", () => {
  const { dir, initPath } = createHarness(
    baseConfig({ enabled: true, command: "some-cli-without-placeholder" })
  );
  try {
    const result = runInit(initPath, ["worker", "check"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\{promptFile\}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker check fails clearly when externalWorker block is entirely absent", () => {
  const { dir, initPath } = createHarness(baseConfig());
  try {
    const result = runInit(initPath, ["worker", "check"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /externalWorker\.command/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker check passes when the underlying command echoes the smoke prompt (contains READY)", () => {
  const echoPromptCommand =
    "\"" + process.execPath + "\"" +
    ' -e "process.stdout.write(require(\'fs\').readFileSync(process.argv[1],\'utf8\'))" {promptFile}';
  const { dir, initPath } = createHarness(
    baseConfig({ enabled: true, command: echoPromptCommand })
  );
  try {
    const result = runInit(initPath, ["worker", "check"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS/);
    assert.match(result.stdout, /READY/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker check fails clearly when the underlying CLI does not exist", () => {
  const { dir, initPath } = createHarness(
    baseConfig({ enabled: true, command: "this-cli-does-not-exist {promptFile}" })
  );
  try {
    const result = runInit(initPath, ["worker", "check"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown worker subcommand exits with code 1 and prints usage", () => {
  const { dir, initPath } = createHarness(baseConfig());
  try {
    const result = runInit(initPath, ["worker", "bogus"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /worker on\|off\|check/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker with no subcommand exits with code 1 and prints usage", () => {
  const { dir, initPath } = createHarness(baseConfig());
  try {
    const result = runInit(initPath, ["worker"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /worker on\|off\|check/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the 'worker' dispatcher does not interfere with 'setup' and 'build' tasks", () => {
  const { dir, initPath } = createHarness({
    tasks: {
      setup: { workingDirectory: ".", steps: [{ description: "s", command: 'node -e "process.exit(0)"' }] },
      build: { workingDirectory: ".", steps: [{ description: "b", command: 'node -e "process.exit(0)"' }] },
    },
    externalWorker: { enabled: false, command: "some-cli {promptFile}" },
  });
  try {
    assert.equal(runInit(initPath, ["setup"]).status, 0);
    assert.equal(runInit(initPath, ["build"]).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- tests for 'worker run' ---------------------------------------------------

test("worker run creates .harness/runs/ directory and logs resolved command and output", () => {
  const { dir, initPath } = createHarness(
    baseConfig({ enabled: true, command: 'node -e "console.log(\'WORKER_OUTPUT\')" {promptFile}' })
  );
  const promptPath = join(dir, "prompt.txt");
  writeFileSync(promptPath, "hello", "utf8");

  try {
    const result = runInit(initPath, ["worker", "run", "--issue", "test-issue", "--prompt", promptPath]);
    assert.equal(result.status, 0);

    const runsDir = join(dir, ".harness", "runs");
    assert.ok(existsSync(runsDir), ".harness/runs/ should exist");

    const files = readdirSync(runsDir);
    assert.equal(files.length, 1);
    const logFile = join(runsDir, files[0]);
    const logContent = readFileSync(logFile, "utf8");

    assert.ok(logContent.includes(promptPath), "log should contain prompt path");
    assert.ok(logContent.includes("WORKER_OUTPUT"), "log should contain worker output");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker run ensures child process receives HARNESS_ROLE=worker", () => {
  const { dir, initPath } = createHarness(
    baseConfig({ enabled: true, command: 'node -e "console.log(process.env.HARNESS_ROLE)" {promptFile}' })
  );
  const promptPath = join(dir, "prompt.txt");
  writeFileSync(promptPath, "hello", "utf8");

  try {
    runInit(initPath, ["worker", "run", "--issue", "role-test", "--prompt", promptPath]);
    const runsDir = join(dir, ".harness", "runs");
    const files = readdirSync(runsDir);
    const logContent = readFileSync(join(runsDir, files[0]), "utf8");
    assert.match(logContent, /worker/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker run exits with 1 when externalWorker.enabled is false", () => {
  const { dir, initPath } = createHarness(
    baseConfig({ enabled: false, command: 'node -e "process.exit(0)" {promptFile}' })
  );
  const promptPath = join(dir, "prompt.txt");
  writeFileSync(promptPath, "hello", "utf8");

  try {
    const result = runInit(initPath, ["worker", "run", "--issue", "disabled-test", "--prompt", promptPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /disabilitato/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker run exits with 1 when prompt file does not exist", () => {
  const { dir, initPath } = createHarness(
    baseConfig({ enabled: true, command: 'node -e "process.exit(0)" {promptFile}' })
  );

  try {
    const result = runInit(initPath, ["worker", "run", "--issue", "missing-prompt", "--prompt", "non-existent.txt"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /non trovato/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker run propagates the exit code of the child process", () => {
  const { dir, initPath } = createHarness(
    baseConfig({ enabled: true, command: 'node -e "process.exit(42)" {promptFile}' })
  );
  const promptPath = join(dir, "prompt.txt");
  writeFileSync(promptPath, "hello", "utf8");

  try {
    const result = runInit(initPath, ["worker", "run", "--issue", "exit-code-test", "--prompt", promptPath]);
    assert.equal(result.status, 42);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
