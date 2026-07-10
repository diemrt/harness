#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init, update } from "./actions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON_PATH = join(__dirname, "..", "package.json");

const USAGE = `Usage: harness <command> [targetDir] [options]

Commands:
  init [targetDir]      Copy the harness template into targetDir
  update [targetDir]    Sync targetDir with the current template

targetDir defaults to "." when omitted.

Options:
  --force        Overwrite files even if they were modified
  --dry-run      Compute the result without writing anything to disk
  --json         Print the result as a single line of JSON
  -h, --help     Show this help message
  -v, --version  Print the harness version
`;

function readVersion() {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
  return pkg.version;
}

function printHumanSummary(result, version) {
  const groups = [
    ["added", result.added],
    ["updated", result.updated],
    ["skipped", result.skipped],
    ["conflicts", result.conflicts],
    ["removed", result.removed],
    ["orphaned", result.orphaned || []],
  ];
  for (const [label, paths] of groups) {
    for (const p of paths) {
      if (label === "conflicts") {
        console.log(
          `  ${label.padEnd(9)} ${p} -- your version differs from the harness template; see ${p}.new (the incoming version); resolve manually, then re-run with --force or delete the .new file`
        );
      } else {
        console.log(`  ${label.padEnd(9)} ${p}`);
      }
    }
  }

  const conflictCount = result.conflicts ? result.conflicts.length : 0;
  if (conflictCount > 0) {
    console.log(
      `harness v${version}: ${result.action} finished with ${conflictCount} conflict(s); resolve them and re-run (exit code 2).`
    );
  } else {
    console.log(`harness v${version}: ${result.action} complete`);
  }
}

async function main(argv) {
  let version;
  try {
    version = readVersion();
  } catch {
    version = "unknown";
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        force: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (err) {
    console.error(USAGE);
    process.exit(1);
    return;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
    return;
  }

  if (values.version) {
    console.log(version);
    process.exit(0);
    return;
  }

  const [command, targetDirArg] = positionals;
  const targetDir = targetDirArg ?? ".";

  if (command !== "init" && command !== "update") {
    console.error(USAGE);
    process.exit(1);
    return;
  }

  const actionOpts = {
    targetDir,
    force: values.force,
    dryRun: values["dry-run"],
  };

  try {
    const action = command === "init" ? init : update;
    const result = await action(actionOpts);

    if (values.json) {
      console.log(JSON.stringify(result));
    } else {
      printHumanSummary(result, version);
    }

    process.exit(result.conflicts && result.conflicts.length > 0 ? 2 : 0);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (values.json) {
      console.log(JSON.stringify({ ok: false, error: message, code: "FATAL" }));
    } else {
      console.error(`harness: ${message}`);
    }
    process.exit(1);
  }
}

main(process.argv.slice(2));
