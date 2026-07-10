import { createHash } from "node:crypto";

export const MANIFEST_FILE = ".harness-manifest.json";

/**
 * Compute the sha256 hex digest of a buffer.
 * @param {Buffer|string} buf
 * @returns {string}
 */
export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Read the harness manifest from a directory.
 * @param {string} dir
 * @returns {Promise<object>}
 */
export async function readManifest(dir) {
  throw new Error("not implemented");
}

/**
 * Write the harness manifest to a directory (atomic write).
 * @param {string} dir
 * @param {object} manifest
 * @returns {Promise<void>}
 */
export async function writeManifest(dir, manifest) {
  throw new Error("not implemented");
}
