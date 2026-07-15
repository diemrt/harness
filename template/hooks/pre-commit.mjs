#!/usr/bin/env node
/**
 * Pre-commit gate: documentation-verification gate for the harness.
 *
 * A git hook is a separate OS process and cannot inject a turn into the
 * agent's session. Instead, this gate BLOCKS the commit (exit 1) and prints
 * a structured instruction on stderr that the agent is expected to read and
 * act on, consistent with the "Gate sul commit" section of AGENTS-RULES.md.
 *
 * Anti-loop bypass: once the agent (or a human) has verified that docs/ and
 * AGENTS.md are up to date, re-run the commit with HARNESS_DOCS_VERIFIED=1
 * set in the environment and this gate exits 0 without blocking.
 *
 * Zero runtime dependencies: only node:* builtins plus the git binary.
 */

import { execFileSync } from "node:child_process";

// Anti-loop bypass: the verification has already happened, let the commit through.
if (process.env.HARNESS_DOCS_VERIFIED === "1") {
  process.exit(0);
}

/**
 * Collect the files currently staged for commit. Returns [] if git is
 * unavailable or there is nothing staged; the gate still blocks so the
 * agent performs the documentation check regardless.
 */
function stagedFiles() {
  try {
    const out = execFileSync("git", ["diff", "--cached", "--name-only"], {
      encoding: "utf8",
    });
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const staged = stagedFiles();
const stagedList =
  staged.length > 0
    ? staged.map((f) => `  - ${f}`).join("\n")
    : "  (nessun file rilevato in stage)";

const message = `
=============================================================================
 HARNESS PRE-COMMIT GATE — verifica documentazione
=============================================================================

Questo commit e' bloccato di proposito. Trattare questo output come un
ulteriore prompt e agire prima di ricommittare.

ISTRUZIONE PER L'AGENTE:
  1. Avvia un subagent di verifica documentale che controlli, alla luce dei
     file in stage qui sotto, se sono state sviluppate NUOVE FUNZIONALITA' e
     se i file in docs/ o AGENTS.md vanno di conseguenza aggiornati.
  2. Se servono aggiornamenti, applicali e mettili in stage (git add).
  3. Ricommitta impostando la variabile d'ambiente HARNESS_DOCS_VERIFIED=1
     (bypass anti-loop), cosi' questo gate non blocca il commit gia' verificato.

FILE IN STAGE:
${stagedList}

BYPASS (uso umano o dopo la verifica) — imposta HARNESS_DOCS_VERIFIED=1:
  bash/sh:      HARNESS_DOCS_VERIFIED=1 git commit -m "..."
  PowerShell:   $env:HARNESS_DOCS_VERIFIED=1; git commit -m "..."
  cmd:          set HARNESS_DOCS_VERIFIED=1 && git commit -m "..."
=============================================================================
`;

process.stderr.write(message);
process.exit(1);
