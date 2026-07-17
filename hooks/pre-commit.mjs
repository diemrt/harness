#!/usr/bin/env node
/**
 * Pre-commit gate: ruolo worker.
 * Regola definitiva del flusso harness: i worker non committano e non esiste
 * alcun bypass.
 */
if (process.env.HARNESS_ROLE === "worker") {
  process.stderr.write(
    "HARNESS PRE-COMMIT GATE: regola di ruolo definitiva: i worker (HARNESS_ROLE=worker) non possono committare e non esiste alcun bypass.\n",
  );
  process.exit(1);
}
process.exit(0);
