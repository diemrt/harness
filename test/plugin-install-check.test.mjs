// The guard against the divergence of 2026-08-13: a plugin installed from a local directory,
// frozen at the day its component directories were empty, while 159 commits of rewrite happened in
// the repository and nothing anywhere said so.
//
// Two halves, the split the rest of the suite uses: the decision is proved on functions over
// directories, the contract is proved on the process. The fixtures below build a whole fake
// ~/.claude, because the thing under test is precisely the relationship between that registry and a
// repository — and neither may be the real one.

import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPONENT_DIRS,
  compareInstall,
  componentInventory,
  isPlaceholder,
  isRemoteSource,
  realComponents,
  topLevelExtras,
} from "../scripts/install-check.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/install-check.mjs", import.meta.url));

function tmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), `harness-${prefix}-`));
}

function write(root, rel, content = "x") {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

// A plugin root with the two manifests plus whatever component files are asked for.
function pluginRoot(files, { name = "harness", marketplace = "diemrt", version = "0.6.0" } = {}) {
  const root = tmp("plugin");
  write(root, ".claude-plugin/plugin.json", JSON.stringify({ name, version }));
  write(root, ".claude-plugin/marketplace.json", JSON.stringify({ name: marketplace }));
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  return root;
}

// A fake Claude Code configuration directory: the two registry files, nothing else.
function claudeRoot({ key, installPath, source, version = "0.6.0", marketplace = "diemrt" }) {
  const root = tmp("claude");
  write(
    root,
    "plugins/installed_plugins.json",
    JSON.stringify({
      version: 2,
      plugins: key ? { [key]: [{ scope: "user", installPath, version }] } : {},
    })
  );
  write(
    root,
    "plugins/known_marketplaces.json",
    JSON.stringify(source ? { [marketplace]: { source } } : {})
  );
  return root;
}

function run(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { ...result, json: JSON.parse(result.stdout) };
}

test("componentInventory guarda solo le quattro directory che sono il plugin", () => {
  const root = tmp("inv");
  write(root, "skills/harness/SKILL.md");
  write(root, "commands/status.md");
  write(root, "agents/harness-verifier.md");
  write(root, "scripts/issue-manager.mjs");
  write(root, "docs/una-nota.md");
  write(root, "README.md");

  assert.deepEqual(componentInventory(root), [
    "agents/harness-verifier.md",
    "commands/status.md",
    "scripts/issue-manager.mjs",
    "skills/harness/SKILL.md",
  ]);
  assert.deepEqual(COMPONENT_DIRS, ["agents", "commands", "scripts", "skills"]);
});

test("una directory di componenti assente non e' un errore, e' zero file", () => {
  const root = tmp("inv-empty");
  write(root, "skills/harness/SKILL.md");
  assert.deepEqual(componentInventory(root), ["skills/harness/SKILL.md"]);
});

test(".gitkeep non conta come componente: e' esattamente cio' che la copia congelata portava", () => {
  const files = ["agents/.gitkeep", "commands/.gitkeep", "scripts/.gitkeep", "skills/.gitkeep"];
  assert.equal(files.every(isPlaceholder), true);
  assert.deepEqual(realComponents(files), []);
});

test("remota vuol dire qualcosa che si scarica; directory no", () => {
  assert.equal(isRemoteSource({ source: "github", repo: "diemrt/harness" }), true);
  assert.equal(isRemoteSource({ source: "url", url: "https://example.invalid/x.git" }), true);
  assert.equal(isRemoteSource({ source: "git", url: "https://example.invalid/x.git" }), true);
  assert.equal(isRemoteSource({ source: "directory", path: "C:/qualcosa" }), false);
  assert.equal(isRemoteSource(null), false);
  assert.equal(isRemoteSource({}), false);
});

test("topLevelExtras trova il modello di distribuzione precedente, e ignora i dotfile", () => {
  const repo = tmp("repo");
  write(repo, "scripts/issue-manager.mjs");
  write(repo, "README.md");

  const install = tmp("install");
  write(install, "scripts/issue-manager.mjs");
  write(install, "README.md");
  write(install, "hooks/pre-commit");
  write(install, "src/cli.mjs");
  write(install, "template/issues.json");
  write(install, "init.mjs");
  write(install, "issues.html");
  write(install, ".harness/runs/qualcosa.log");

  assert.deepEqual(topLevelExtras(install, repo), [
    "hooks",
    "init.mjs",
    "issues.html",
    "src",
    "template",
  ]);
});

test("compareInstall separa cosa manca, cosa e' di troppo, e quanto e' vecchio", () => {
  const repo = tmp("repo-cmp");
  write(repo, "skills/harness/SKILL.md", "nuovo");
  write(repo, "scripts/tracker-graph.mjs", "uguale");

  const install = tmp("install-cmp");
  write(install, "skills/.gitkeep");
  write(install, "scripts/tracker-graph.mjs", "uguale");
  write(install, "scripts/vecchio.mjs");

  const diff = compareInstall({ installRoot: install, repoRoot: repo });
  assert.deepEqual(diff.missing, ["skills/harness/SKILL.md"]);
  assert.deepEqual(diff.extra, ["scripts/vecchio.mjs"]);
  assert.equal(diff.componentsInstalled, 2, "il .gitkeep non viene contato");
  assert.equal(diff.contentDrift, 0);
});

test("il contenuto diverso e' un numero, mai un fallimento", () => {
  const repo = tmp("repo-drift");
  write(repo, "scripts/a.mjs", "versione nuova");
  const install = tmp("install-drift");
  write(install, "scripts/a.mjs", "versione vecchia");

  const diff = compareInstall({ installRoot: install, repoRoot: repo });
  assert.deepEqual(diff.missing, []);
  assert.deepEqual(diff.extra, []);
  assert.equal(diff.contentDrift, 1, "la deriva si conta");
});

test("una sorgente directory viene respinta prima di ogni confronto", () => {
  const repo = pluginRoot({ "skills/harness/SKILL.md": "x" });
  const claude = claudeRoot({
    key: "harness@diemrt",
    installPath: repo,
    source: { source: "directory", path: repo },
  });

  const run1 = run(["--plugin-dir", repo, "--claude-dir", claude]);
  assert.equal(run1.status, 1);
  assert.equal(run1.stderr, "");
  assert.equal(run1.json.ok, false);
  assert.equal(run1.json.code, "LOCAL_SOURCE");
  // La copia e' identica al repository, eppure fallisce: e' la sorgente il difetto, non il diff.
  assert.match(run1.json.error, /lavoro non committato/);
});

test("una copia senza i componenti del repository e' DIVERGENT_INSTALL, e li nomina", () => {
  const repo = pluginRoot({
    "skills/harness/SKILL.md": "x",
    "commands/status.md": "x",
    "scripts/issue-manager.mjs": "x",
  });
  const install = tmp("install-div");
  write(install, "skills/.gitkeep");
  write(install, "commands/.gitkeep");
  write(install, "scripts/.gitkeep");
  write(install, "hooks/pre-commit");
  write(install, "init.mjs");

  const claude = claudeRoot({
    key: "harness@diemrt",
    installPath: install,
    source: { source: "github", repo: "diemrt/harness" },
  });

  const result = run(["--plugin-dir", repo, "--claude-dir", claude]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(result.json.code, "DIVERGENT_INSTALL");
  assert.equal(result.json.data.componentsInstalled, 0);
  assert.equal(result.json.data.missing.length, 3);
  assert.deepEqual(result.json.data.extraTopLevel, ["hooks", "init.mjs"]);
});

test("una copia allineata da sorgente remota esce 0", () => {
  const repo = pluginRoot({ "skills/harness/SKILL.md": "x", "scripts/a.mjs": "y" });
  const install = tmp("install-ok");
  write(install, "skills/harness/SKILL.md", "x");
  write(install, "scripts/a.mjs", "y");

  const claude = claudeRoot({
    key: "harness@diemrt",
    installPath: install,
    source: { source: "github", repo: "diemrt/harness" },
  });

  const result = run(["--plugin-dir", repo, "--claude-dir", claude]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.json.ok, true);
  assert.equal(result.json.data.state, "aligned");
  assert.equal(result.json.data.plugin, "harness@diemrt");
  assert.equal(result.json.data.contentDrift, 0);
});

test("una copia allineata ma vecchia resta allineata: la deriva non fa fallire", () => {
  const repo = pluginRoot({ "scripts/a.mjs": "riscritto oggi" });
  const install = tmp("install-stale");
  write(install, "scripts/a.mjs", "com'era al rilascio");

  const claude = claudeRoot({
    key: "harness@diemrt",
    installPath: install,
    source: { source: "github", repo: "diemrt/harness" },
  });

  const result = run(["--plugin-dir", repo, "--claude-dir", claude]);
  assert.equal(result.status, 0);
  assert.equal(result.json.data.state, "aligned");
  assert.equal(result.json.data.contentDrift, 1, "riportata, non fatale");
});

test("niente di installato non e' una divergenza: e' un'altra risposta", () => {
  const repo = pluginRoot({ "skills/harness/SKILL.md": "x" });
  const claude = claudeRoot({ key: null, source: { source: "github", repo: "diemrt/harness" } });

  const result = run(["--plugin-dir", repo, "--claude-dir", claude]);
  assert.equal(result.status, 1);
  assert.equal(result.json.code, "NOT_INSTALLED");
});

test("una directory che non e' la radice di un plugin lo dice, invece di confrontare il nulla", () => {
  const notAPlugin = tmp("not-plugin");
  write(notAPlugin, "README.md");
  const claude = claudeRoot({ key: null, source: null });

  const result = run(["--plugin-dir", notAPlugin, "--claude-dir", claude]);
  assert.equal(result.status, 1);
  assert.equal(result.json.code, "MISSING_MANIFEST");
});

test("un flag inventato si ferma qui, come negli altri script", () => {
  const result = run(["--fix"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(result.json.code, "UNKNOWN_ARGUMENT");
});

test("--help e' testo, esce 0, e non scrive su stderr", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /--plugin-dir/);
  assert.match(result.stdout, /LOCAL_SOURCE/);
});
