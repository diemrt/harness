import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, buildManifest, writeManifest, readManifest } from "./manifest.mjs";
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
    orphaned: [],
  };
}

/**
 * Sync targetDir with the current template/, respecting file policies.
 *
 * Three-way comparison per managed file: the new template's hash, the
 * hash the manifest last recorded for that file, and the file's current
 * bytes on disk. A file is "pristine" (safe to overwrite) when its disk
 * hash still matches what the manifest recorded; otherwise it has been
 * modified by the user (or an agent) and must never be silently clobbered.
 * @param {object} opts
 * @param {string} opts.targetDir
 * @param {boolean} [opts.force]
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<object>}
 */
export async function update(opts) {
  const { targetDir, force = false, dryRun = false } = opts;

  const oldManifest = readManifest(targetDir);
  if (!oldManifest) {
    const result = await init(opts);
    return { ...result, action: "update" };
  }

  const relPaths = walkFiles(TEMPLATE_DIR).sort();
  const harnessVersion = readHarnessVersion();
  const newPathSet = new Set(relPaths);
  const oldFiles = oldManifest.files || {};

  const added = [];
  const updated = [];
  const skipped = [];
  const conflicts = [];
  const removed = [];
  const orphaned = [];
  const manifestFiles = new Map();

  for (const relPath of relPaths) {
    const srcPath = join(TEMPLATE_DIR, ...relPath.split("/"));
    const destPath = join(targetDir, ...relPath.split("/"));
    const templateBuf = readFileSync(srcPath);
    const newHash = sha256(templateBuf);
    const policy = policyFor(relPath);
    const rec = oldFiles[relPath];

    // The manifest always converges to the new template's notion of this
    // file, regardless of whether it was written, overwritten, left
    // alone, or turned into a conflict.
    manifestFiles.set(relPath, { sha256: newHash, policy });

    const destExists = existsSync(destPath);

    if (policy === "seeded-once" || policy === "data") {
      if (!destExists) {
        added.push(relPath);
        if (!dryRun) {
          mkdirSync(dirname(destPath), { recursive: true });
          writeFileSync(destPath, templateBuf);
        }
      } else {
        skipped.push(relPath);
      }
      continue;
    }

    // policy === "managed"
    if (!destExists) {
      added.push(relPath);
      if (!dryRun) {
        mkdirSync(dirname(destPath), { recursive: true });
        writeFileSync(destPath, templateBuf);
      }
      continue;
    }

    const diskBuf = readFileSync(destPath);
    const diskHash = sha256(diskBuf);

    if (diskHash === newHash) {
      // Already current; nothing to do.
      skipped.push(relPath);
      continue;
    }

    if (rec && diskHash === rec.sha256) {
      // Pristine: the file still matches what the harness last wrote.
      updated.push(relPath);
      if (!dryRun) {
        mkdirSync(dirname(destPath), { recursive: true });
        writeFileSync(destPath, templateBuf);
      }
      continue;
    }

    // Diverged from the manifest's recorded hash (or there was no prior
    // record at all): the user or an agent has modified this file.
    if (force) {
      updated.push(relPath);
      if (!dryRun) {
        mkdirSync(dirname(destPath), { recursive: true });
        writeFileSync(destPath, templateBuf);
      }
    } else {
      conflicts.push(relPath);
      if (!dryRun) {
        writeFileSync(`${destPath}.new`, templateBuf);
      }
    }
  }

  // Files the harness used to manage that are no longer part of the
  // template: drop them from the manifest, and clean up on disk only
  // when it is safe to do so.
  for (const relPath of Object.keys(oldFiles)) {
    if (newPathSet.has(relPath)) continue;

    const rec = oldFiles[relPath];
    const policy = rec.policy;

    if (policy === "seeded-once" || policy === "data") {
      // Leave the file on disk; only the manifest entry disappears.
      continue;
    }

    // policy === "managed"
    const destPath = join(targetDir, ...relPath.split("/"));
    if (!existsSync(destPath)) continue;

    const diskBuf = readFileSync(destPath);
    const diskHash = sha256(diskBuf);

    if (diskHash === rec.sha256) {
      removed.push(relPath);
      if (!dryRun) {
        unlinkSync(destPath);
      }
    } else {
      orphaned.push(relPath);
      // Diverged: leave it on disk, untouched, for the user to deal with.
    }
  }

  if (!dryRun) {
    const manifest = buildManifest(harnessVersion, manifestFiles);
    mkdirSync(targetDir, { recursive: true });
    writeManifest(targetDir, manifest);
  }

  return {
    ok: true,
    action: "update",
    added: added.sort(),
    updated: updated.sort(),
    skipped: skipped.sort(),
    conflicts: conflicts.sort(),
    removed: removed.sort(),
    orphaned: orphaned.sort(),
  };
}
