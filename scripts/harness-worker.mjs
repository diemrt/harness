#!/usr/bin/env node
// External worker runner, shipped inside the harness plugin.
//
// Delegates a single issue to an external CLI (a separate OS process — Copilot CLI, Codex,
// Ollama, another Claude Code session, ...) instead of an internal subagent. The command that
// invokes that CLI is entirely configured by the project, in `externalWorker` inside
// `.harness/config.json` (see `scripts/harness-config.mjs` for the exact shape and validation of
// that block; this script only reads the file, it never writes it).
//
// Two things make delegation to an external process safe rather than merely polite:
//   - the prompt is always passed on a file, never inlined into a shell command, which removes
//     every quoting hazard;
//   - the child process is launched with HARNESS_ROLE=worker in its environment. That variable is
//     read by scripts/issue-manager.mjs, which refuses (FORBIDDEN_ROLE) any --insert/--update that
//     would set status=done or validation.state=pass while it is set to "worker". A worker CLI
//     that tries to close its own issue is rejected at the data layer, not just asked nicely not
//     to in a prompt.
//
// Usage:
//   node harness-worker.mjs --check [--project-dir <path>]
//   node harness-worker.mjs --run --issue-id <id> --prompt-file <path> [--project-dir <path>]
//   node harness-worker.mjs --help
//
// --check   CLI-agnostic preflight: writes a smoke-test prompt to a temp file, resolves
//           `externalWorker.command` against it, runs the command and checks the result
//           (exit code 0, or the literal "READY" somewhere in stdout/stderr — whichever the
//           configured CLI actually gives). No per-CLI adapter code: any command that can take a
//           prompt file and answer it satisfies the check.
// --run     Launches the external worker for one issue: resolves the command, spawns it with
//           HARNESS_ROLE=worker, logs the run under .harness/runs/, and reports the outcome.
//
// Machine-readable contract, identical to the other plugin scripts (stdout is always a single
// line of JSON):
//   success -> {"ok":true,"data":<payload>}                      exit code 0
//   failure -> {"ok":false,"error":"<message>","code":"<CODE>"}  exit code 1
// Nothing is ever written to stderr. --help prints plain text.
//
// Deliberate exception to "exit code 0 on ok:true": on --run, once the child process has actually
// been spawned, this script's own exit code becomes the CHILD's exit code (propagated, as the
// worker's job requires), not a fixed 0. The JSON envelope on stdout is still emitted and is still
// {"ok":true,...} in that case — data.exitCode carries the same number for callers that only read
// stdout. ok:false is reserved for cases where the run could not even be attempted (bad config,
// missing args, missing prompt file, or the spawn call itself throwing).
//
// Error codes: CONFIG_NOT_FOUND, INVALID_JSON, WORKER_DISABLED, INVALID_COMMAND, MISSING_ARGS,
//              FILE_NOT_FOUND, SPAWN_ERROR, CHECK_FAILED, UNKNOWN_COMMAND.

import { parseArgs } from "node:util";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const HARNESS_DIR = ".harness";
const CONFIG_FILE = "config.json";
const RUNS_DIR = "runs";
const PROMPT_FILE_PLACEHOLDER = "{promptFile}";
const SMOKE_PROMPT = "Reply exactly READY. Use no tools.";
// Combined stdout+stderr capture for the child process. Generous on purpose: a worker CLI's
// transcript can be long, and truncating it would make both the log and the JSON envelope less
// useful for exactly the runs that most need diagnosing.
const MAX_CHILD_OUTPUT_BYTES = 20 * 1024 * 1024;

class WorkerError extends Error {
  constructor(message, code = "ERROR") {
    super(message);
    this.code = code;
  }
}

function fail(message, code = "ERROR") {
  throw new WorkerError(message, code);
}

function printEnvelope(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function writeOk(data) {
  printEnvelope({ ok: true, data });
  process.exit(0);
}

function writeFail(message, code = "ERROR") {
  printEnvelope({ ok: false, error: message, code });
  process.exit(1);
}

// --------------------------------------------------------------------------
// project dir / config
// --------------------------------------------------------------------------

// Resolved the same way as the other plugin scripts: the process cwd by default, --project-dir
// for callers that cannot control their cwd (e.g. a runner invoked from elsewhere).
function resolveProjectDir(projectDir) {
  const dir = path.resolve(projectDir ?? process.cwd());
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`Project directory '${dir}' does not exist.`, "FILE_NOT_FOUND");
  }
  return dir;
}

// Reads externalWorker.command out of .harness/config.json. This script only reads that file — it
// never writes it, and it does not import scripts/harness-config.mjs (that module runs its own
// CLI as a side effect of being loaded, so shelling out or re-parsing the file directly are the
// only safe options; re-parsing keeps this script a single process per invocation).
function readExternalWorkerCommand(projectDir) {
  const configPath = path.join(projectDir, HARNESS_DIR, CONFIG_FILE);
  if (!existsSync(configPath)) {
    fail(
      `No harness configuration in '${projectDir}'. Run harness-config.mjs --init first.`,
      "CONFIG_NOT_FOUND"
    );
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    if (err instanceof SyntaxError) {
      fail(`File '${configPath}' is not valid JSON.`, "INVALID_JSON");
    }
    throw err;
  }

  const externalWorker = config && config.externalWorker;
  if (!externalWorker || typeof externalWorker !== "object" || externalWorker.enabled !== true) {
    fail(
      `External worker is disabled in '${configPath}' (externalWorker.enabled must be true).`,
      "WORKER_DISABLED"
    );
  }

  const commandTemplate = externalWorker.command;
  if (
    typeof commandTemplate !== "string" ||
    commandTemplate.trim() === "" ||
    !commandTemplate.includes(PROMPT_FILE_PLACEHOLDER)
  ) {
    fail(
      `'externalWorker.command' in '${configPath}' is missing or lacks the required placeholder ` +
        `'${PROMPT_FILE_PLACEHOLDER}'. Example: "some-cli -p ${PROMPT_FILE_PLACEHOLDER}".`,
      "INVALID_COMMAND"
    );
  }

  return commandTemplate;
}

function resolveCommand(commandTemplate, promptFilePath) {
  return commandTemplate.split(PROMPT_FILE_PLACEHOLDER).join(promptFilePath);
}

// Some CLIs do not resolve Windows 8.3 short paths (e.g. `C:\Users\DIEGO_~1\...`), which is what
// os.tmpdir() (and any relative path a caller passes) can hand back on machines where the profile
// directory has one. realpathSync.native() expands both the short-name form and any symlinks,
// giving back the one form every CLI is expected to understand. Requires the path to already
// exist, which every caller here has just verified.
function toLongAbsolutePath(filePath) {
  return realpathSync.native(path.resolve(filePath));
}

// --------------------------------------------------------------------------
// --check : CLI-agnostic preflight
// --------------------------------------------------------------------------

function runCheck(projectDir) {
  const commandTemplate = readExternalWorkerCommand(projectDir);

  const promptFilePath = path.join(tmpdir(), `harness-worker-check-${process.pid}-${Date.now()}.txt`);
  writeFileSync(promptFilePath, SMOKE_PROMPT, "utf8");

  try {
    const longPromptPath = toLongAbsolutePath(promptFilePath);
    const resolvedCommand = resolveCommand(commandTemplate, longPromptPath);

    const result = spawnSync(resolvedCommand, {
      shell: true,
      encoding: "utf8",
      maxBuffer: MAX_CHILD_OUTPUT_BYTES,
    });

    if (result.error) {
      fail(
        `The external worker command raised an exception: ${result.error.message}`,
        "SPAWN_ERROR"
      );
    }

    const output = `${result.stdout || ""}${result.stderr || ""}`;
    const statusOk = result.status === 0;
    const containsReady = output.includes("READY");

    if (!statusOk && !containsReady) {
      fail(
        `The external worker did not answer as expected (exit code ${result.status}, no 'READY' ` +
          `in the output). Possible causes: the CLI is not installed/not on PATH, wrong ` +
          `command/arguments, or the model is unavailable. Output: ${output || "(empty)"}`,
        "CHECK_FAILED"
      );
    }

    return { command: resolvedCommand, exitCode: result.status, output };
  } finally {
    try {
      unlinkSync(promptFilePath);
    } catch {
      // Best-effort cleanup: a temp file that is already gone (or not removable) is not a reason
      // to fail a preflight that otherwise succeeded or already failed for a different reason.
    }
  }
}

// --------------------------------------------------------------------------
// --run : launch the worker for one issue
// --------------------------------------------------------------------------

function runWorker(projectDir, issueId, promptFile) {
  const commandTemplate = readExternalWorkerCommand(projectDir);

  if (!existsSync(promptFile)) {
    fail(`Prompt file '${promptFile}' does not exist.`, "FILE_NOT_FOUND");
  }
  const longPromptPath = toLongAbsolutePath(promptFile);
  const resolvedCommand = resolveCommand(commandTemplate, longPromptPath);

  const runsDir = path.join(projectDir, HARNESS_DIR, RUNS_DIR);
  mkdirSync(runsDir, { recursive: true });
  const logPath = path.join(runsDir, `${issueId}-${Date.now()}.log`);

  // The resolved command line goes to the head of the log before the child even runs, so a run
  // that never produces output (or that fails to spawn at all) still leaves behind what was
  // attempted.
  writeFileSync(logPath, `Command: ${resolvedCommand}\n\n`, "utf8");

  const result = spawnSync(resolvedCommand, {
    shell: true,
    encoding: "utf8",
    maxBuffer: MAX_CHILD_OUTPUT_BYTES,
    env: { ...process.env, HARNESS_ROLE: "worker" },
  });

  if (result.error) {
    writeFileSync(logPath, `Spawn error: ${result.error.message}\n`, { flag: "a" });
    fail(`The external worker command raised an exception: ${result.error.message}`, "SPAWN_ERROR");
  }

  const output = `${result.stdout || ""}${result.stderr || ""}`;
  // A child killed by a signal reports status === null; there is no real exit code to propagate,
  // so this falls back to 1 (failure) rather than 0 (which would read as success).
  const exitCode = result.status === null ? 1 : result.status;
  writeFileSync(logPath, `${output}\nExit code: ${exitCode}\n`, { flag: "a" });

  // Deliberate departure from the standard "ok:true -> exit 0" contract: the runner's job is to
  // run the child and propagate ITS exit code, not to report its own success/failure as 0/1. The
  // envelope still says ok:true (the run was attempted and completed), and data.exitCode carries
  // the same number for stdout-only callers.
  printEnvelope({
    ok: true,
    data: { issueId, projectDir, command: resolvedCommand, logPath, exitCode, output },
  });
  process.exit(exitCode);
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function showHelp() {
  const lines = [
    "Usage:",
    "node harness-worker.mjs --check [--project-dir <path>]",
    "node harness-worker.mjs --run --issue-id <id> --prompt-file <path> [--project-dir <path>]",
    "",
    "Reads externalWorker.command from <project>/.harness/config.json, resolves the required",
    "{promptFile} placeholder, and spawns the result with HARNESS_ROLE=worker in the child's",
    "environment (the guard scripts/issue-manager.mjs checks to refuse status=done/",
    "validation.state=pass from a worker process).",
    "",
    "--check  CLI-agnostic preflight. Writes a smoke-test prompt to a temp file, runs the",
    "         configured command against it, and passes if the command exits 0 or the literal",
    "         'READY' appears in its combined stdout/stderr.",
    "--run    Launches the worker for one issue. Logs the run to",
    "         .harness/runs/<issue-id>-<timestamp>.log with the resolved command line at the",
    "         head, then propagates the child's exit code as this process's own exit code.",
    "         --issue-id and --prompt-file are required; the prompt file must already exist",
    "         (the caller writes it — this script never inlines a prompt into the command).",
    "",
    "Output contract (stdout is always one line of JSON, except for this help text):",
    '  success : {"ok":true,"data":<payload>}                       exit code 0',
    '  failure : {"ok":false,"error":"<msg>","code":"<CODE>"}  exit code 1',
    "  Exception: on --run, once the child has actually been spawned, the exit code is the",
    "  child's own exit code instead of the fixed 0 above (data.exitCode carries the same value).",
    "",
    "Error codes: CONFIG_NOT_FOUND, INVALID_JSON, WORKER_DISABLED, INVALID_COMMAND, MISSING_ARGS,",
    "             FILE_NOT_FOUND, SPAWN_ERROR, CHECK_FAILED, UNKNOWN_COMMAND",
  ];
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: false,
    options: {
      help: { type: "boolean" },
      check: { type: "boolean" },
      run: { type: "boolean" },
      "project-dir": { type: "string" },
      "issue-id": { type: "string" },
      "prompt-file": { type: "string" },
    },
  });

  if (values.help) {
    showHelp();
    return;
  }

  const dir = resolveProjectDir(values["project-dir"]);

  if (values.check) {
    writeOk(runCheck(dir));
  } else if (values.run) {
    const issueId = values["issue-id"];
    const promptFile = values["prompt-file"];
    if (!issueId || !promptFile) {
      fail("--run requires --issue-id and --prompt-file.", "MISSING_ARGS");
    }
    runWorker(dir, issueId, promptFile);
    // runWorker never returns: it always calls process.exit with the child's exit code.
  } else {
    fail("Invalid command. Use '--help' for usage information.", "UNKNOWN_COMMAND");
  }
}

try {
  main();
} catch (err) {
  if (err instanceof WorkerError) {
    writeFail(err.message, err.code);
  } else {
    writeFail(`Unexpected error: ${err && err.message ? err.message : String(err)}`, "ERROR");
  }
}
