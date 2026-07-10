import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

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
 * @returns {object|null} parsed manifest, or null when absent
 */
export function readManifest(dir) {
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  const raw = readFileSync(manifestPath, "utf8");
  return JSON.parse(raw);
}

/**
 * Write the harness manifest to a directory using an atomic write
 * (temp file in the same directory, then rename).
 * @param {string} dir
 * @param {object} manifest
 * @returns {void}
 */
export function writeManifest(dir, manifest) {
  const manifestPath = join(dir, MANIFEST_FILE);
  const tmpPath = join(
    dir,
    `.${MANIFEST_FILE}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  );
  const contents = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(tmpPath, contents, "utf8");
  renameSync(tmpPath, manifestPath);
}

/**
 * Build a manifest object from a harness version and a map of files.
 * @param {string} harnessVersion
 * @param {Map<string, {sha256: string, policy: string}>} files
 * @returns {{harnessVersion: string, generatedAt: string, files: object}}
 */
export function buildManifest(harnessVersion, files) {
  const sortedKeys = [...files.keys()].sort();
  const filesObj = {};
  for (const key of sortedKeys) {
    const entry = files.get(key);
    filesObj[key] = { sha256: entry.sha256, policy: entry.policy };
  }
  return {
    harnessVersion,
    generatedAt: new Date().toISOString(),
    files: filesObj,
  };
}
