/**
 * Single source of truth for how a template file is treated by init/update.
 *
 * Policies:
 *   - "data":         user-owned data files; never overwritten once created.
 *   - "seeded-once":  written on init, but left alone by update even if the
 *                     template version changes (the user is expected to edit
 *                     these).
 *   - "managed":      the default. The harness keeps these in sync with the
 *                     template as long as the user has not modified them
 *                     (per the manifest hash). New files added to template/
 *                     in future versions automatically fall into this
 *                     bucket without any code change here.
 *
 * All relative paths used with this module MUST use forward slashes as the
 * separator, regardless of platform (see toPosixPath in actions.mjs).
 */

export const DATA_FILES = new Set(["issues.json"]);

export const SEEDED_ONCE_FILES = new Set([
  "AGENTS.md",
  "docs/ARCHITECTURE.md",
  "init.config.json",
]);

/**
 * Determine the policy for a template-relative path.
 * @param {string} relPath template-relative path, forward-slash separated
 * @returns {"data"|"seeded-once"|"managed"}
 */
export function policyFor(relPath) {
  if (DATA_FILES.has(relPath)) return "data";
  if (SEEDED_ONCE_FILES.has(relPath)) return "seeded-once";
  return "managed";
}
