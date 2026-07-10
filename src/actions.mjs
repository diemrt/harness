import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, buildManifest, writeManifest } from "./manifest.mjs";
import { policyFor } from "./policies.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, "..", "template");
const PACKAGE_JSON_PATH = join(__dirname, "..", "package.json");

/**
 * Convert a path to use forward slashes, the canonical separator used
 * throughout this codebase for relative paths (manifest keys, policy
 * lookups, reported file lists), regardless of host platform.
 * @param {string} p
 * @returns {string}
 */
function toPosixPath(p) {
  return p.split("\\").join("/");
}

/**
 * Recursively walk a directory, returning template-relative paths
 * (forward-slash separated) for every regular file found.
 * @param {string} rootDir
 * @returns {string[]}
 */
function walkFiles(rootDir) {
  const results = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(toPosixPath(relative(rootDir, fullPath)));
      }
    }
  }

  if (existsSync(rootDir)) {
    walk(rootDir);
  }
  return results;
}

function readHarnessVersion() {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
  return pkg.version;
}

/**
 * Copy template/ into targetDir and write the harness manifest.
 * @param {object} opts
 * @param {string} opts.targetDir
 * @param {boolean} [opts.force]
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<object>}
 */
export async function init(opts) {
  const { targetDir, force = false, dryRun = false } = opts;

  const relPaths = walkFiles(TEMPLATE_DIR).sort();
  const harnessVersion = readHarnessVersion();

  const added = [];
  const updated = [];
  const skipped = [];
  const manifestFiles = new Map();

  for (const relPath of relPaths) {
    const srcPath = join(TEMPLATE_DIR, ...relPath.split("/"));
    const destPath = join(targetDir, ...relPath.split("/"));
    const templateBuf = readFileSync(srcPath);
    const templateHash = sha256(templateBuf);
    const policy = policyFor(relPath);

    // The manifest always records the template's notion of this file,
    // regardless of whether it was written, overwritten, or left alone.
    manifestFiles.set(relPath, { sha256: templateHash, policy });

    const destExists = existsSync(destPath);

    if (!destExists) {
      added.push(relPath);
      if (!dryRun) {
        mkdirSync(dirname(destPath), { recursive: true });
        writeFileSync(destPath, templateBuf);
      }
    } else if (force) {
      updated.push(relPath);
      if (!dryRun) {
        mkdirSync(dirname(destPath), { recursive: true });
        writeFileSync(destPath, templateBuf);
      }
    } else {
      skipped.push(relPath);
    }
  }

  if (!dryRun) {
    const manifest = buildManifest(harnessVersion, manifestFiles);
    mkdirSync(targetDir, { recursive: true });
    writeManifest(targetDir, manifest);
  }

  return {
    ok: true,
    action: "init",
    added: added.sort(),
    updated: updated.sort(),
    skipped: skipped.sort(),
    conflicts: [],
    removed: [],
  };
}

/**
 * Sync targetDir with the current template/, respecting file policies.
 * Implemented in a later phase.
 * @param {object} opts
 * @returns {Promise<object>}
 */
export async function update(opts) {
  throw new Error("not implemented");
}
