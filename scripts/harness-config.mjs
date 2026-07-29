#!/usr/bin/env node
// Local harness configuration, shipped inside the plugin.
//
// Harness puts no configuration file in the shared repository. What a session needs — the setup
// command, the verification command that acts as the gate, the external worker, the docs gate
// globs — lives in `.harness/` at the root of the project, a directory that ignores itself:
// alongside config.json the script writes a `.gitignore` containing `*`, so git never sees the
// directory and the project's own .gitignore is never touched.
//
// Consequence, and it is deliberate: the configuration is per clone, not shared. A colleague who
// does not use the harness sees nothing at all.
//
// Usage:
//   node harness-config.mjs --detect [--project-dir <path>]
//   node harness-config.mjs --init --config-file <path> [--project-dir <path>] [--force]
//   node harness-config.mjs --get [--project-dir <path>]
//
// --detect  inspects the project and proposes setup/verify commands WITHOUT writing anything.
//           The proposal is meant to be shown to the user and confirmed, never applied silently:
//           a verification gate nobody agreed to is worse than no gate, because it looks like one.
// --init    writes .harness/.gitignore and .harness/config.json from the given payload.
// --get     reads the current configuration.
//
// Machine-readable contract, identical to issue-manager.mjs (stdout is always a single line of
// JSON):
//   success -> {"ok":true,"data":<payload>}                      exit code 0
//   failure -> {"ok":false,"error":"<message>","code":"<CODE>"}  exit code 1
// Nothing is ever written to stderr. --help prints plain text.
//
// Error codes: CONFIG_NOT_FOUND, CONFIG_EXISTS, INVALID_INPUT, INVALID_JSON, FILE_NOT_FOUND,
//              MISSING_ARGS, UNKNOWN_COMMAND.

import { parseArgs } from "node:util";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const HARNESS_DIR = ".harness";
const CONFIG_FILE = "config.json";

// The docs gate defaults: what counts as "code" when deciding whether a commit deserves a
// documentation issue. Deliberately broad on languages and narrow on exclusions.
const DEFAULT_DOCS_GATE = {
  enabled: true,
  include: [
    "**/*.mjs",
    "**/*.js",
    "**/*.cjs",
    "**/*.ts",
    "**/*.tsx",
    "**/*.jsx",
    "**/*.py",
    "**/*.go",
    "**/*.cs",
    "**/*.java",
    "**/*.rb",
    "**/*.rs",
    "**/*.php",
  ],
  exclude: ["docs/**", "test/**", "tests/**", "**/*.md", "issues.json"],
};

class ConfigError extends Error {
  constructor(message, code = "ERROR") {
    super(message);
    this.code = code;
  }
}

function fail(message, code = "ERROR") {
  throw new ConfigError(message, code);
}

function writeOk(data) {
  process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
  process.exit(0);
}

function writeFail(message, code = "ERROR") {
  process.stdout.write(JSON.stringify({ ok: false, error: message, code }) + "\n");
  process.exit(1);
}

function resolveProjectDir(projectDir) {
  const dir = path.resolve(projectDir ?? process.cwd());
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`Project directory '${dir}' does not exist.`, "FILE_NOT_FOUND");
  }
  return dir;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err instanceof SyntaxError) {
      fail(`File '${filePath}' is not valid JSON.`, "INVALID_JSON");
    }
    throw err;
  }
}

// --------------------------------------------------------------------------
// detection
// --------------------------------------------------------------------------

// Each detector returns { setup, verify, evidence } for the stack it recognizes, or null.
// `evidence` says WHERE the proposal comes from, so the user confirms a fact rather than a guess.
const DETECTORS = [
  function node(dir) {
    const pkgPath = path.join(dir, "package.json");
    if (!existsSync(pkgPath)) {
      return null;
    }
    const pkg = readJsonFile(pkgPath);
    const scripts = pkg.scripts ?? {};
    // Prefer the script that actually proves the project builds and behaves. `test` first: a
    // green suite is a stronger gate than a successful compile.
    const verifyScript = ["test", "build", "check", "ci"].find((s) => scripts[s]);
    return {
      setup: existsSync(path.join(dir, "package-lock.json")) ? "npm ci" : "npm install",
      verify: verifyScript ? `npm run ${verifyScript}` : null,
      evidence: verifyScript
        ? `package.json declares the '${verifyScript}' script`
        : "package.json has no test/build script",
    };
  },

  function python(dir) {
    const marker = ["pyproject.toml", "requirements.txt", "setup.py"].find((f) =>
      existsSync(path.join(dir, f))
    );
    if (!marker) {
      return null;
    }
    return {
      setup:
        marker === "requirements.txt" ? "pip install -r requirements.txt" : "pip install -e .",
      verify: "pytest",
      evidence: `${marker} found`,
    };
  },

  function go(dir) {
    if (!existsSync(path.join(dir, "go.mod"))) {
      return null;
    }
    return { setup: "go mod download", verify: "go test ./...", evidence: "go.mod found" };
  },

  function rust(dir) {
    if (!existsSync(path.join(dir, "Cargo.toml"))) {
      return null;
    }
    return { setup: "cargo fetch", verify: "cargo test", evidence: "Cargo.toml found" };
  },

  function dotnet(dir) {
    const project = readdirSync(dir).find((f) => f.endsWith(".csproj") || f.endsWith(".sln"));
    if (!project) {
      return null;
    }
    return { setup: "dotnet restore", verify: "dotnet build", evidence: `${project} found` };
  },

  function make(dir) {
    if (!existsSync(path.join(dir, "Makefile"))) {
      return null;
    }
    const targets = readFileSync(path.join(dir, "Makefile"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^([a-zA-Z][\w-]*):/))
      .filter(Boolean)
      .map((m) => m[1]);
    const verifyTarget = ["test", "check", "build"].find((t) => targets.includes(t));
    return {
      setup: targets.includes("setup") ? "make setup" : null,
      verify: verifyTarget ? `make ${verifyTarget}` : null,
      evidence: verifyTarget
        ? `Makefile declares the '${verifyTarget}' target`
        : "Makefile found, no test/check/build target",
    };
  },
];

// Runs every detector and returns all the proposals, best first. Several can match at once
// (a Node project with a Makefile): showing all of them is more honest than picking one and
// pretending the choice was obvious.
function detect(dir) {
  const proposals = [];
  for (const detector of DETECTORS) {
    const found = detector(dir);
    if (found) {
      proposals.push({ stack: detector.name, ...found });
    }
  }
  const complete = proposals.find((p) => p.setup && p.verify) ?? proposals[0] ?? null;
  return {
    projectDir: dir,
    proposals,
    suggested: complete ? { setup: complete.setup, verify: complete.verify } : null,
    // The caller must confirm: this is a proposal, not a decision.
    confirmed: false,
  };
}

// --------------------------------------------------------------------------
// read / write
// --------------------------------------------------------------------------

function validateConfigInput(config) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    fail("Configuration must be a JSON object.", "INVALID_INPUT");
  }
  const allowed = ["setup", "verify", "externalWorker", "docsGate"];
  const unknown = Object.keys(config).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    fail(
      `Unknown field(s) in configuration: ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}.`,
      "INVALID_INPUT"
    );
  }
  // `verify` is the gate the independent verifier runs. Without it there is nothing to verify
  // against, and a verification that runs no command is theatre.
  if (typeof config.verify !== "string" || config.verify.trim() === "") {
    fail("'verify' is required and must be a non-empty command string.", "INVALID_INPUT");
  }
  if (config.setup !== undefined && config.setup !== null && typeof config.setup !== "string") {
    fail("'setup' must be a command string or null.", "INVALID_INPUT");
  }
  if (config.externalWorker !== undefined && config.externalWorker !== null) {
    const worker = config.externalWorker;
    if (typeof worker !== "object" || Array.isArray(worker)) {
      fail("'externalWorker' must be an object or null.", "INVALID_INPUT");
    }
    if (worker.enabled && !String(worker.command ?? "").includes("{promptFile}")) {
      fail(
        "'externalWorker.command' must contain the {promptFile} placeholder when enabled.",
        "INVALID_INPUT"
      );
    }
  }
  // A partial docsGate is filled in field-by-field with the defaults (see initConfig), so that
  // `enabled: true` can never end up paired with a missing `include`/`exclude` — the gate must
  // never look active while matching nothing. That merge only works if the fields, when present,
  // are of the right shape: an `include` that isn't an array would be silently useless downstream
  // too, just typed instead of missing.
  if (config.docsGate !== undefined && config.docsGate !== null) {
    const gate = config.docsGate;
    if (typeof gate !== "object" || Array.isArray(gate)) {
      fail("'docsGate' must be an object or null.", "INVALID_INPUT");
    }
    if (gate.enabled !== undefined && typeof gate.enabled !== "boolean") {
      fail("'docsGate.enabled' must be a boolean.", "INVALID_INPUT");
    }
    for (const field of ["include", "exclude"]) {
      const value = gate[field];
      if (value === undefined) {
        continue;
      }
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        fail(`'docsGate.${field}' must be an array of glob strings.`, "INVALID_INPUT");
      }
    }
  }
}

// Writes .harness/, its self-ignoring .gitignore, and config.json — in that order, so the
// directory is never visible to git for even a moment.
function initConfig(dir, config, force) {
  validateConfigInput(config);

  const harnessDir = path.join(dir, HARNESS_DIR);
  const configPath = path.join(harnessDir, CONFIG_FILE);
  if (existsSync(configPath) && !force) {
    fail(
      `Configuration already exists at '${configPath}'. Pass --force to overwrite it.`,
      "CONFIG_EXISTS"
    );
  }

  mkdirSync(harnessDir, { recursive: true });
  // The self-ignore comes first and unconditionally: this is what keeps the project's own
  // .gitignore untouched.
  writeFileSync(
    path.join(harnessDir, ".gitignore"),
    "# Local harness state: never committed, and never a reason to edit the project's .gitignore.\n*\n",
    "utf8"
  );

  // Defaults are merged field-by-field, not swapped in wholesale, precisely so a partial
  // `docsGate` (or `externalWorker`) can never lose the fields that make it work. Passing
  // `{"docsGate":{"enabled":true}}` used to write exactly that — `enabled: true` with no
  // `include`/`exclude` at all, a gate that looks active and matches nothing. Filling in only the
  // fields the caller omitted keeps that impossible while still letting a caller override just
  // one field (say, add a glob to `exclude`) without having to restate everything else.
  const stored = {
    setup: config.setup ?? null,
    verify: config.verify,
    externalWorker: { enabled: false, command: null, ...(config.externalWorker ?? {}) },
    docsGate: { ...DEFAULT_DOCS_GATE, ...(config.docsGate ?? {}) },
  };
  writeFileSync(configPath, JSON.stringify(stored, null, 2) + "\n", "utf8");

  return { projectDir: dir, configPath, config: stored };
}

function getConfig(dir) {
  const configPath = path.join(dir, HARNESS_DIR, CONFIG_FILE);
  if (!existsSync(configPath)) {
    fail(
      `No harness configuration in '${dir}'. Run --detect, confirm the commands with the user, then --init.`,
      "CONFIG_NOT_FOUND"
    );
  }
  return { projectDir: dir, configPath, config: readJsonFile(configPath) };
}

function showHelp() {
  const lines = [
    "Usage:",
    "node harness-config.mjs --detect [--project-dir <path>]",
    "node harness-config.mjs --init (--config-data '<json>' | --config-file <path>) [--project-dir <path>] [--force]",
    "node harness-config.mjs --get [--project-dir <path>]",
    "",
    "The configuration lives in <project>/.harness/config.json, next to a .gitignore containing",
    "'*' so the directory ignores itself. The project's own .gitignore is never modified.",
    "",
    "--detect proposes setup/verify commands by inspecting the project. It writes nothing:",
    "         show the proposal to the user and let them confirm before calling --init.",
    "",
    "Fields: setup (string|null), verify (string, required — the verification gate),",
    "        externalWorker ({enabled, command with {promptFile}}), docsGate ({enabled, include, exclude}).",
    "",
    "Output contract (stdout is always one line of JSON, except for this help text):",
    '  success : {"ok":true,"data":<payload>}                       exit code 0',
    '  failure : {"ok":false,"error":"<msg>","code":"<CODE>"}  exit code 1',
    "",
    "Error codes: CONFIG_NOT_FOUND, CONFIG_EXISTS, INVALID_INPUT, INVALID_JSON, FILE_NOT_FOUND,",
    "             MISSING_ARGS, UNKNOWN_COMMAND",
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
      detect: { type: "boolean" },
      init: { type: "boolean" },
      get: { type: "boolean" },
      force: { type: "boolean" },
      "project-dir": { type: "string" },
      "config-data": { type: "string" },
      "config-file": { type: "string" },
    },
  });

  if (values.help) {
    showHelp();
    return;
  }

  const dir = resolveProjectDir(values["project-dir"]);

  if (values.detect) {
    writeOk(detect(dir));
  } else if (values.init) {
    let raw = values["config-data"];
    const configFile = values["config-file"];
    if (configFile) {
      if (raw) {
        fail("--config-data and --config-file are mutually exclusive. Provide only one.", "MISSING_ARGS");
      }
      if (!existsSync(configFile)) {
        fail(`Config file '${configFile}' not found.`, "FILE_NOT_FOUND");
      }
      raw = readFileSync(configFile, "utf8");
    }
    if (!raw) {
      fail("Please provide the configuration (--config-data or --config-file).", "MISSING_ARGS");
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fail("Provided configuration is not valid JSON.", "INVALID_JSON");
    }
    writeOk(initConfig(dir, parsed, Boolean(values.force)));
  } else if (values.get) {
    writeOk(getConfig(dir));
  } else {
    fail("Invalid task specified. Use '--help' for usage information.", "UNKNOWN_COMMAND");
  }
}

try {
  main();
} catch (err) {
  if (err instanceof ConfigError) {
    writeFail(err.message, err.code);
  } else {
    writeFail(`Unexpected error: ${err && err.message ? err.message : String(err)}`, "ERROR");
  }
}
