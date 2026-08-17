#!/usr/bin/env node
// Compares the harness copy Claude Code has installed against this repository, and says whether
// what other projects load is what lives here.
//
// Usage:
//   node install-check.mjs [--plugin-dir <path>] [--claude-dir <path>] [--help]
//
// Output is ONE line of JSON, the contract issue-manager.mjs uses:
//   success -> {"ok":true,"data":<payload>}                      exit code 0
//   failure -> {"ok":false,"error":"<message>","code":"<CODE>"}  exit code 1
// Nothing is ever written to stderr.
//
// It exists because of a divergence that lasted 159 commits without anything noticing: the
// marketplace was registered as a local `directory` on the author's working tree, so every consumer
// project loaded uncommitted work, while the copy in the plugin cache stayed frozen at the day the
// plugin was an empty scaffold. Neither `npm test` nor the tracker could see it — the suite runs on
// the repository, never on the installed copy. See
// docs/superpowers/analisi/2026-08-13-plugin-pubblicato-divergente.md.
//
// What it checks, and what it deliberately does not: divergence here means SHAPE, not content. A
// copy one release behind carries the same files with older bytes, and failing on that would make
// the check cry every day until it is ignored. A copy whose `skills/` is empty is not a lagging
// release, it is a different artifact. Content drift is reported as a number, never as a failure.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The directories that ARE the plugin. Everything Claude Code loads from harness lives in one of
// them, so a copy that matches here matches where it counts.
//
// `commands/` is in the list even though the plugin no longer ships it, and that is the point: an
// installed copy that still carries it is a copy from before the operations became skills, and it
// registers every /harness:* command twice. Dropping the entry would make exactly that divergence
// invisible to the check written to catch divergences.
export const COMPONENT_DIRS = ["agents", "commands", "scripts", "skills"];

const USAGE = [
  "Usage:",
  "  node install-check.mjs [--plugin-dir <path>] [--claude-dir <path>] [--help]",
  "",
  "Compares the harness copy Claude Code installed against this repository: the source it was",
  "registered from, and whether the four component directories carry the same files.",
  "Output is one line of JSON on stdout, never anything on stderr.",
  "",
  "--plugin-dir  the repository to compare against (default: the current directory). Must hold",
  "              .claude-plugin/plugin.json and .claude-plugin/marketplace.json.",
  "--claude-dir  Claude Code's configuration directory (default: $CLAUDE_CONFIG_DIR, or ~/.claude)",
  "",
  "Exit codes: 0 when the installed copy is aligned and comes from a remote source; 1 otherwise,",
  "and on any request that could not be carried out. This is a per-machine check about a local",
  "installation: it is meant for whoever releases, not for CI, which has nothing installed.",
  "",
  "Codes: LOCAL_SOURCE, DIVERGENT_INSTALL, NOT_INSTALLED, MISSING_MANIFEST, FILE_NOT_FOUND,",
  "       INVALID_JSON, UNKNOWN_ARGUMENT",
  "",
].join("\n");

function ok(data) {
  process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
  process.exit(0);
}

function fail(message, code) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: message, code })}\n`);
  process.exit(1);
}

function readJson(file, { optional = false } = {}) {
  if (!existsSync(file)) {
    if (optional) return null;
    fail(`Il file '${file}' non esiste.`, "FILE_NOT_FOUND");
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Il file '${file}' non è JSON leggibile: ${error.message}`, "INVALID_JSON");
  }
  return null;
}

// Every file under the component directories, as repository-relative POSIX paths, sorted. Paths and
// not contents: see the note at the top about shape versus bytes.
export function componentInventory(root) {
  const files = [];

  function walk(dir, prefix) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }

  for (const dir of COMPONENT_DIRS) {
    walk(path.join(root, dir), dir);
  }
  return files.sort();
}

// `.gitkeep` is how an empty component directory looks once it has been committed, and it is
// exactly what the frozen copy carried in all four. Counting it as content would let the emptiest
// possible plugin pass as populated.
export function isPlaceholder(file) {
  return path.basename(file) === ".gitkeep";
}

export function realComponents(files) {
  return files.filter((file) => !isPlaceholder(file));
}

// Top-level entries present in the installed copy and absent from the repository. This is what
// catches a copy built on the previous distribution model: hooks/, src/, template/, init.mjs,
// issues.html. Dotted entries are skipped — .git, .claude and friends are noise from how the copy
// was taken, not components anybody loads.
export function topLevelExtras(installRoot, repoRoot) {
  const listing = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  };
  const inRepo = new Set(listing(repoRoot));
  return listing(installRoot)
    .filter((name) => !inRepo.has(name))
    .sort();
}

function sha256(file) {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

// Informational only, and the comment is here so nobody promotes it to a failure later: a release
// and the commit after it differ by design.
export function countContentDrift(shared, installRoot, repoRoot) {
  let drifted = 0;
  for (const rel of shared) {
    const a = sha256(path.join(installRoot, rel));
    const b = sha256(path.join(repoRoot, rel));
    if (a === null || b === null || a !== b) drifted += 1;
  }
  return drifted;
}

// "github", "git" and "url" are all remote: they name something fetched, which is the property that
// matters. "directory" names a folder on this machine, which is the defect this guard exists for.
export function isRemoteSource(source) {
  const kind = source && typeof source === "object" ? source.source : null;
  return kind === "github" || kind === "git" || kind === "url";
}

export function compareInstall({ installRoot, repoRoot }) {
  const installed = realComponents(componentInventory(installRoot));
  const repo = realComponents(componentInventory(repoRoot));
  const installedSet = new Set(installed);
  const repoSet = new Set(repo);

  const missing = repo.filter((file) => !installedSet.has(file));
  const extra = installed.filter((file) => !repoSet.has(file));
  const shared = repo.filter((file) => installedSet.has(file));

  return {
    componentsInstalled: installed.length,
    componentsRepo: repo.length,
    missing,
    extra,
    extraTopLevel: topLevelExtras(installRoot, repoRoot),
    contentDrift: countContentDrift(shared, installRoot, repoRoot),
  };
}

function resolveDir(value, fallback, label) {
  const dir = path.resolve(value ?? fallback);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`La directory ${label} '${dir}' non esiste.`, "FILE_NOT_FOUND");
  }
  return dir;
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      options: {
        "plugin-dir": { type: "string" },
        "claude-dir": { type: "string" },
        help: { type: "boolean", default: false },
      },
    }));
  } catch (error) {
    fail(
      `${error.message.replace(/\.?$/, ".")} install-check.mjs accetta solo --plugin-dir, --claude-dir e --help.`,
      "UNKNOWN_ARGUMENT"
    );
    return;
  }

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const repoRoot = resolveDir(values["plugin-dir"], process.cwd(), "del plugin");
  const claudeDir = resolveDir(
    values["claude-dir"],
    process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"),
    "di configurazione di Claude Code"
  );

  const manifest = readJson(path.join(repoRoot, ".claude-plugin", "plugin.json"), { optional: true });
  const marketplace = readJson(path.join(repoRoot, ".claude-plugin", "marketplace.json"), {
    optional: true,
  });
  if (!manifest?.name || !marketplace?.name) {
    fail(
      `'${repoRoot}' non è la radice di un plugin: servono .claude-plugin/plugin.json e .claude-plugin/marketplace.json, entrambi con un 'name'.`,
      "MISSING_MANIFEST"
    );
    return;
  }

  const key = `${manifest.name}@${marketplace.name}`;
  const registry = readJson(path.join(claudeDir, "plugins", "installed_plugins.json"), {
    optional: true,
  });
  const markets = readJson(path.join(claudeDir, "plugins", "known_marketplaces.json"), {
    optional: true,
  });
  const records = registry?.plugins?.[key];
  const record = Array.isArray(records) ? records[0] : null;

  if (!record) {
    fail(
      `Nessuna installazione di '${key}' registrata in '${claudeDir}'. Non c'è niente da confrontare: questo controllo parla di una macchina, non di un repository.`,
      "NOT_INSTALLED"
    );
    return;
  }

  const source = markets?.[marketplace.name]?.source ?? null;
  if (!isRemoteSource(source)) {
    const kind = source?.source ?? "sconosciuta";
    fail(
      `Il marketplace '${marketplace.name}' è registrato con sorgente '${kind}', non remota: i progetti che usano '${manifest.name}' non caricano un rilascio, caricano una cartella di questa macchina così com'è, lavoro non committato compreso. Registralo dalla forma remota documentata nel README.`,
      "LOCAL_SOURCE"
    );
    return;
  }

  const installRoot = record.installPath;
  if (!installRoot || !existsSync(installRoot)) {
    fail(
      `'${key}' risulta installato in '${installRoot}', ma quella directory non esiste. Reinstalla il plugin invece di sistemare il registro a mano.`,
      "FILE_NOT_FOUND"
    );
    return;
  }

  const diff = compareInstall({ installRoot, repoRoot });
  const payload = {
    plugin: key,
    version: manifest.version ?? null,
    installedVersion: record.version ?? null,
    source: source.source,
    installPath: installRoot,
    ...diff,
  };

  if (diff.missing.length > 0 || diff.extra.length > 0 || diff.extraTopLevel.length > 0) {
    const parts = [];
    if (diff.missing.length > 0) parts.push(`${diff.missing.length} file mancanti`);
    if (diff.extra.length > 0) parts.push(`${diff.extra.length} file di troppo`);
    if (diff.extraTopLevel.length > 0) {
      parts.push(`estranei alla radice: ${diff.extraTopLevel.join(", ")}`);
    }
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error: `La copia installata di '${key}' non ha la stessa forma di '${repoRoot}': ${parts.join("; ")}. Chi usa il plugin sta caricando un artefatto diverso da quello che qui viene verificato.`,
        code: "DIVERGENT_INSTALL",
        data: payload,
      })}\n`
    );
    process.exit(1);
  }

  ok({ ...payload, state: "aligned" });
}

// The pure functions above are imported by the tests; main() must not run then.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
