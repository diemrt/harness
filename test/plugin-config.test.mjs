// The whole point of .harness/ is that it leaves no trace in the shared repository, so the
// tests that matter here run against a real git repository and assert on what git sees.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(rootDir, "scripts", "harness-config.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: "utf8", cwd });
}

function git(cwd, args) {
  return spawnSync("git", args, { encoding: "utf8", cwd });
}

function assertEnvelope(result) {
  assert.equal(result.stderr, "", "stderr must be empty");
  const lines = result.stdout.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1, `stdout must be exactly one line, got: ${JSON.stringify(result.stdout)}`);
  return JSON.parse(lines[0]);
}

function assertOk(result) {
  const parsed = assertEnvelope(result);
  assert.equal(result.status, 0, "exit code must be 0 on success");
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

function tempProject(files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-cfg-"));
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
  }
  return dir;
}

// A committed repository, so `git status --porcelain` is empty until something new appears.
function tempGitProject(files = {}) {
  const dir = tempProject({ "README.md": "# project\n", ...files });
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

const MINIMAL = JSON.stringify({ setup: "npm ci", verify: "npm test" });

// ---------------------------------------------------------------------------
// the invariant: git must not see the harness
// ---------------------------------------------------------------------------

test("creating the configuration leaves git status clean", () => {
  const dir = tempGitProject();
  try {
    assert.equal(git(dir, ["status", "--porcelain"]).stdout, "", "precondition: repo starts clean");

    assertOk(run(dir, ["--init", "--config-data", MINIMAL]));

    assert.equal(
      git(dir, ["status", "--porcelain"]).stdout,
      "",
      "the harness directory must be invisible to git"
    );
    assert.equal(
      git(dir, ["status", "--porcelain", "--untracked-files=all"]).stdout,
      "",
      "not even as an untracked file"
    );
  } finally {
    cleanup(dir);
  }
});

test("the project's own .gitignore is never touched", () => {
  const original = "node_modules/\ndist/\n";
  const dir = tempGitProject({ ".gitignore": original });
  try {
    assertOk(run(dir, ["--init", "--config-data", MINIMAL]));

    assert.equal(readFileSync(path.join(dir, ".gitignore"), "utf8"), original);
    assert.equal(git(dir, ["diff", "--", ".gitignore"]).stdout, "", "no diff on the shared .gitignore");
    assert.equal(git(dir, ["status", "--porcelain"]).stdout, "");
  } finally {
    cleanup(dir);
  }
});

test("a project with no .gitignore does not get one", () => {
  const dir = tempGitProject();
  try {
    assertOk(run(dir, ["--init", "--config-data", MINIMAL]));
    assert.equal(
      existsSync(path.join(dir, ".gitignore")),
      false,
      "the harness must not create a .gitignore in the project root"
    );
  } finally {
    cleanup(dir);
  }
});

test("the harness directory carries its own self-ignoring .gitignore", () => {
  const dir = tempProject();
  try {
    assertOk(run(dir, ["--init", "--config-data", MINIMAL]));
    const ignore = readFileSync(path.join(dir, ".harness", ".gitignore"), "utf8");
    assert.match(ignore, /^\*$/m, "the directory must ignore everything inside itself");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// read back
// ---------------------------------------------------------------------------

test("the configuration is read back as written", () => {
  const dir = tempProject();
  try {
    const written = assertOk(run(dir, ["--init", "--config-data", MINIMAL]));
    const read = assertOk(run(dir, ["--get"]));

    assert.equal(read.config.setup, "npm ci");
    assert.equal(read.config.verify, "npm test");
    assert.equal(read.configPath, written.configPath);
    assert.equal(read.config.externalWorker.enabled, false);
    assert.ok(Array.isArray(read.config.docsGate.include), "docs gate defaults must be filled in");
  } finally {
    cleanup(dir);
  }
});

test("--get on a project without configuration says so instead of inventing one", () => {
  const dir = tempProject();
  try {
    assertFail(run(dir, ["--get"]), "CONFIG_NOT_FOUND");
    assert.equal(existsSync(path.join(dir, ".harness")), false, "a read must create nothing");
  } finally {
    cleanup(dir);
  }
});

test("an existing configuration is not overwritten without --force", () => {
  const dir = tempProject();
  try {
    assertOk(run(dir, ["--init", "--config-data", MINIMAL]));
    assertFail(run(dir, ["--init", "--config-data", JSON.stringify({ verify: "other" })]), "CONFIG_EXISTS");
    assert.equal(assertOk(run(dir, ["--get"])).config.verify, "npm test", "the original must survive");

    assertOk(run(dir, ["--init", "--config-data", JSON.stringify({ verify: "other" }), "--force"]));
    assert.equal(assertOk(run(dir, ["--get"])).config.verify, "other");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

test("a configuration without a verification command is rejected", () => {
  const dir = tempProject();
  try {
    assertFail(run(dir, ["--init", "--config-data", JSON.stringify({ setup: "npm ci" })]), "INVALID_INPUT");
    assertFail(run(dir, ["--init", "--config-data", JSON.stringify({ verify: "  " })]), "INVALID_INPUT");
    assert.equal(existsSync(path.join(dir, ".harness")), false, "a rejected config must write nothing");
  } finally {
    cleanup(dir);
  }
});

test("a partial docsGate is filled in field-by-field, never left half-defaulted", () => {
  const dir = tempProject();
  try {
    const partial = JSON.stringify({ verify: "npm test", docsGate: { enabled: true } });
    const written = assertOk(run(dir, ["--init", "--config-data", partial]));

    assert.equal(written.config.docsGate.enabled, true, "the explicit override must survive");
    assert.ok(
      Array.isArray(written.config.docsGate.include) && written.config.docsGate.include.length > 0,
      "include must be filled in with the default, not left undefined"
    );
    assert.ok(
      Array.isArray(written.config.docsGate.exclude) && written.config.docsGate.exclude.length > 0,
      "exclude must be filled in with the default, not left undefined"
    );

    const onDisk = JSON.parse(readFileSync(path.join(dir, ".harness", "config.json"), "utf8"));
    assert.equal(onDisk.docsGate.enabled, true);
    assert.ok(Array.isArray(onDisk.docsGate.include) && onDisk.docsGate.include.length > 0);
    assert.ok(Array.isArray(onDisk.docsGate.exclude) && onDisk.docsGate.exclude.length > 0);
  } finally {
    cleanup(dir);
  }
});

test("a partial docsGate overriding one field keeps the defaults for the rest", () => {
  const dir = tempProject();
  try {
    const partial = JSON.stringify({
      verify: "npm test",
      docsGate: { exclude: ["vendor/**"] },
    });
    const written = assertOk(run(dir, ["--init", "--config-data", partial]));

    assert.deepEqual(written.config.docsGate.exclude, ["vendor/**"], "explicit override wins");
    assert.equal(written.config.docsGate.enabled, true, "enabled keeps its default");
    assert.ok(
      written.config.docsGate.include.includes("**/*.mjs"),
      "include keeps the default when omitted"
    );
  } finally {
    cleanup(dir);
  }
});

test("a partial externalWorker is filled in field-by-field too", () => {
  const dir = tempProject();
  try {
    const partial = JSON.stringify({
      verify: "npm test",
      externalWorker: { command: "copilot -p {promptFile}" },
    });
    const written = assertOk(run(dir, ["--init", "--config-data", partial]));

    assert.equal(written.config.externalWorker.command, "copilot -p {promptFile}");
    assert.equal(
      written.config.externalWorker.enabled,
      false,
      "enabled must default to false, not be left missing (which would also read as falsy, but the field must exist)"
    );

    const onDisk = JSON.parse(readFileSync(path.join(dir, ".harness", "config.json"), "utf8"));
    assert.ok(
      Object.prototype.hasOwnProperty.call(onDisk.externalWorker, "enabled"),
      "the 'enabled' key must be present on disk, not just absent-and-falsy"
    );
  } finally {
    cleanup(dir);
  }
});

test("docsGate with the wrong field shapes is rejected, not silently merged", () => {
  const dir = tempProject();
  try {
    assertFail(
      run(dir, ["--init", "--config-data", JSON.stringify({ verify: "npm test", docsGate: "yes" })]),
      "INVALID_INPUT"
    );
    assertFail(
      run(dir, [
        "--init",
        "--config-data",
        JSON.stringify({ verify: "npm test", docsGate: { enabled: "true" } }),
      ]),
      "INVALID_INPUT"
    );
    assertFail(
      run(dir, [
        "--init",
        "--config-data",
        JSON.stringify({ verify: "npm test", docsGate: { include: "**/*.js" } }),
      ]),
      "INVALID_INPUT"
    );
    assertFail(
      run(dir, [
        "--init",
        "--config-data",
        JSON.stringify({ verify: "npm test", docsGate: { exclude: [1, 2] } }),
      ]),
      "INVALID_INPUT"
    );
    assert.equal(existsSync(path.join(dir, ".harness")), false, "a rejected config must write nothing");
  } finally {
    cleanup(dir);
  }
});

// An empty `include` is the same failure as a missing one — a gate that says it is on and can
// never match a file — only written on purpose instead of by omission, so the merge cannot catch
// it. It has to be refused at validation time.
test("an enabled docsGate with an explicitly empty include is rejected", () => {
  const dir = tempProject();
  try {
    const explicit = JSON.stringify({
      verify: "npm test",
      docsGate: { enabled: true, include: [] },
    });
    const rejected = assertFail(run(dir, ["--init", "--config-data", explicit]), "INVALID_INPUT");
    assert.match(
      rejected.error,
      /enabled/,
      "the message must name the way out, not just the problem"
    );
    assert.equal(existsSync(path.join(dir, ".harness")), false, "a rejected config must write nothing");
  } finally {
    cleanup(dir);
  }
});

test("an empty include is rejected even when 'enabled' is omitted, because it defaults to true", () => {
  const dir = tempProject();
  try {
    // Validation runs before the defaults are merged in: reading only what the caller wrote here
    // would see `enabled: undefined` and let the empty gate through.
    const implicit = JSON.stringify({ verify: "npm test", docsGate: { include: [] } });
    assertFail(run(dir, ["--init", "--config-data", implicit]), "INVALID_INPUT");
    assert.equal(existsSync(path.join(dir, ".harness")), false, "a rejected config must write nothing");
  } finally {
    cleanup(dir);
  }
});

test("a disabled docsGate may have an empty include: a gate that is off matches nothing by design", () => {
  const dir = tempProject();
  try {
    const off = JSON.stringify({ verify: "npm test", docsGate: { enabled: false, include: [] } });
    const written = assertOk(run(dir, ["--init", "--config-data", off]));

    assert.equal(written.config.docsGate.enabled, false);
    assert.deepEqual(written.config.docsGate.include, [], "the explicit empty array must survive");
  } finally {
    cleanup(dir);
  }
});

test("an empty exclude stays legitimate: excluding nothing is a choice, not a broken gate", () => {
  const dir = tempProject();
  try {
    const noExclusions = JSON.stringify({
      verify: "npm test",
      docsGate: { enabled: true, exclude: [] },
    });
    const written = assertOk(run(dir, ["--init", "--config-data", noExclusions]));

    assert.deepEqual(written.config.docsGate.exclude, []);
    assert.ok(
      written.config.docsGate.include.includes("**/*.mjs"),
      "include still gets the defaults, so the gate can still match"
    );
  } finally {
    cleanup(dir);
  }
});

// --force is the other way into initConfig, and it validates the payload before it decides
// whether it is allowed to overwrite: an empty gate cannot be forced in over a good one.
test("--force cannot smuggle an empty enabled docsGate past validation", () => {
  const dir = tempProject();
  try {
    assertOk(run(dir, ["--init", "--config-data", MINIMAL]));
    const bad = JSON.stringify({ verify: "npm test", docsGate: { enabled: true, include: [] } });
    assertFail(run(dir, ["--init", "--config-data", bad, "--force"]), "INVALID_INPUT");

    const onDisk = JSON.parse(readFileSync(path.join(dir, ".harness", "config.json"), "utf8"));
    assert.ok(onDisk.docsGate.include.length > 0, "the previous, working gate must survive");
  } finally {
    cleanup(dir);
  }
});

test("an enabled external worker must carry the {promptFile} placeholder", () => {
  const dir = tempProject();
  try {
    const bad = JSON.stringify({
      verify: "npm test",
      externalWorker: { enabled: true, command: "copilot -p prompt.txt" },
    });
    assertFail(run(dir, ["--init", "--config-data", bad]), "INVALID_INPUT");

    const good = JSON.stringify({
      verify: "npm test",
      externalWorker: { enabled: true, command: "copilot -p {promptFile}" },
    });
    assertOk(run(dir, ["--init", "--config-data", good]));
  } finally {
    cleanup(dir);
  }
});

test("unknown configuration fields are rejected", () => {
  const dir = tempProject();
  try {
    assertFail(
      run(dir, ["--init", "--config-data", JSON.stringify({ verify: "npm test", build: "make" })]),
      "INVALID_INPUT"
    );
  } finally {
    cleanup(dir);
  }
});

test("malformed input is reported, not swallowed", () => {
  const dir = tempProject();
  try {
    assertFail(run(dir, ["--init", "--config-data", "{not json"]), "INVALID_JSON");
    assertFail(run(dir, ["--init"]), "MISSING_ARGS");
    assertFail(run(dir, ["--init", "--config-file", path.join(dir, "nope.json")]), "FILE_NOT_FOUND");
    assertFail(run(dir, []), "UNKNOWN_COMMAND");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// detection — proposes, never decides
// ---------------------------------------------------------------------------

test("--detect writes nothing", () => {
  const dir = tempGitProject({ "package.json": JSON.stringify({ scripts: { test: "node --test" } }) });
  try {
    const data = assertOk(run(dir, ["--detect"]));
    assert.equal(data.confirmed, false, "a proposal must never present itself as confirmed");
    assert.equal(existsSync(path.join(dir, ".harness")), false);
    assert.equal(git(dir, ["status", "--porcelain"]).stdout, "");
  } finally {
    cleanup(dir);
  }
});

test("--detect reads the verification command out of package.json", () => {
  const dir = tempProject({
    "package.json": JSON.stringify({ scripts: { test: "node --test", build: "tsc" } }),
    "package-lock.json": "{}",
  });
  try {
    const data = assertOk(run(dir, ["--detect"]));
    assert.equal(data.suggested.verify, "npm run test");
    assert.equal(data.suggested.setup, "npm ci", "a lockfile means npm ci, not npm install");
    assert.match(data.proposals[0].evidence, /package\.json/);
  } finally {
    cleanup(dir);
  }
});

test("--detect falls back to build when there is no test script", () => {
  const dir = tempProject({ "package.json": JSON.stringify({ scripts: { build: "tsc" } }) });
  try {
    const data = assertOk(run(dir, ["--detect"]));
    assert.equal(data.suggested.verify, "npm run build");
    assert.equal(data.suggested.setup, "npm install", "no lockfile means npm install");
  } finally {
    cleanup(dir);
  }
});

test("--detect recognizes stacks other than node", () => {
  const cases = [
    [{ "go.mod": "module example\n" }, "go test ./..."],
    [{ "Cargo.toml": "[package]\n" }, "cargo test"],
    [{ "app.csproj": "<Project />" }, "dotnet build"],
    [{ "requirements.txt": "pytest\n" }, "pytest"],
    [{ "Makefile": "test:\n\techo hi\n" }, "make test"],
  ];
  for (const [files, expected] of cases) {
    const dir = tempProject(files);
    try {
      assert.equal(assertOk(run(dir, ["--detect"])).suggested.verify, expected);
    } finally {
      cleanup(dir);
    }
  }
});

test("--detect reports every match, not just the first", () => {
  const dir = tempProject({
    "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
    "Makefile": "check:\n\techo hi\n",
  });
  try {
    const data = assertOk(run(dir, ["--detect"]));
    const stacks = data.proposals.map((p) => p.stack);
    assert.ok(stacks.includes("node") && stacks.includes("make"), `got ${stacks.join(", ")}`);
  } finally {
    cleanup(dir);
  }
});

test("--detect on an unrecognized project proposes nothing rather than guessing", () => {
  const dir = tempProject({ "notes.txt": "hello" });
  try {
    const data = assertOk(run(dir, ["--detect"]));
    assert.deepEqual(data.proposals, []);
    assert.equal(data.suggested, null);
  } finally {
    cleanup(dir);
  }
});

test("--project-dir configures that project, not the cwd", () => {
  const target = tempProject();
  const elsewhere = tempProject();
  try {
    assertOk(run(elsewhere, ["--init", "--config-data", MINIMAL, "--project-dir", target]));
    assert.equal(existsSync(path.join(target, ".harness", "config.json")), true);
    assert.equal(existsSync(path.join(elsewhere, ".harness")), false);
  } finally {
    cleanup(target);
    cleanup(elsewhere);
  }
});
