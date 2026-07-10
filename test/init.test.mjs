import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
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
          { description: "never-runs-step", command: 'node -e "console.log(\'SHOULD_NOT_APPEAR\')"' },
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
