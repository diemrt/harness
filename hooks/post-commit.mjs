#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesAny } from "./match.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_DOCS_GATE = Object.freeze({
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
  exclude: [
    "docs/**",
    "test/**",
    "tests/**",
    "**/*.md",
    "issues.json",
    ".harness-manifest.json",
  ],
});

function runGitCommand(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function isMergeCommitHead() {
  const parentsLine = runGitCommand(["rev-list", "--parents", "-n", "1", "HEAD"]);
  const tokens = parentsLine.split(/\s+/).filter(Boolean);
  return tokens.length > 2;
}

function loadDocsGateConfig() {
  const configPath = join(__dirname, "..", "init.config.json");
  if (!existsSync(configPath)) {
    return DEFAULT_DOCS_GATE;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const docsGate = parsed?.docsGate ?? {};
    return {
      enabled: docsGate.enabled !== false,
      include: Array.isArray(docsGate.include) ? docsGate.include : DEFAULT_DOCS_GATE.include,
      exclude: Array.isArray(docsGate.exclude) ? docsGate.exclude : DEFAULT_DOCS_GATE.exclude,
    };
  } catch {
    return DEFAULT_DOCS_GATE;
  }
}

function getHeadChangedFiles() {
  const output = runGitCommand(["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "HEAD"]);
  if (!output) {
    return [];
  }
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

function buildIssuePayload(shortSha, subject, codeFiles) {
  return {
    title: `docs: verifica documentazione per commit ${shortSha}`,
    description: [
      `Contesto commit ${shortSha}: ${subject}`,
      "",
      "Valuta se servono aggiornamenti a docs/, AGENTS.md o README.md e descrivi cosa cambiare per ciascun file.",
      "Se non serve aggiornare nulla, chiudi la issue motivando la decisione.",
      "",
      "File di codice modificati:",
      ...codeFiles.map((file) => `- ${file}`),
    ].join("\n"),
    status: "backlog",
    validation: {
      criteria: `Verificare la documentazione per il commit ${shortSha} (${subject}). Controllare che tutti i file siano stati aggiornati, che sia stato usato meno testo possibile, che non siano state introdotte delle ripetizioni in documenti diversi`,
      state: "unknown",
    },
  };
}

try {
  if (isMergeCommitHead()) {
    process.exit(0);
  }

  const docsGate = loadDocsGateConfig();
  if (docsGate.enabled === false) {
    process.exit(0);
  }

  const changedFiles = getHeadChangedFiles();
  const codeFiles = changedFiles.filter(
    (filePath) => matchesAny(filePath, docsGate.include) && !matchesAny(filePath, docsGate.exclude)
  );
  if (codeFiles.length === 0) {
    process.exit(0);
  }

  const shortSha = runGitCommand(["rev-parse", "--short", "HEAD"]);
  const subject = runGitCommand(["log", "-1", "--pretty=%s"]);
  const issueManagerPath = join(__dirname, "..", "issue-manager.mjs");
  const payload = buildIssuePayload(shortSha, subject, codeFiles);

  const raw = execFileSync("node", [
    issueManagerPath,
    "--insert",
    "--issue-data",
    JSON.stringify(payload),
  ], { encoding: "utf8" });

  const response = JSON.parse(raw);
  if (!response?.ok || typeof response?.data?.id !== "string" || response.data.id.trim() === "") {
    throw new Error("issue-manager --insert returned an unexpected payload.");
  }

  console.warn(
    `HARNESS: creata issue docs ${response.data.id} - ${codeFiles.length} file di codice nel commit ${shortSha}`
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`HARNESS: post-commit warning: ${message}`);
}

process.exit(0);
