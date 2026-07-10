import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const pkgPath = path.join(rootDir, "package.json");

test("package.json parses and has expected core fields", () => {
  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);

  assert.equal(pkg.name, "@diemrt/harness");
  assert.equal(pkg.type, "module");
  assert.ok(pkg.bin && typeof pkg.bin.harness === "string", "bin.harness must be defined");

  const binPath = path.resolve(rootDir, pkg.bin.harness);
  assert.ok(existsSync(binPath), `bin.harness entry must point at an existing file: ${binPath}`);
});

test("every path listed in files exists on disk", () => {
  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);

  assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0, "files must be a non-empty array");

  for (const entry of pkg.files) {
    const stripped = entry.endsWith("/") ? entry.slice(0, -1) : entry;
    const fullPath = path.resolve(rootDir, stripped);
    assert.ok(existsSync(fullPath), `files entry must exist on disk: ${entry} (${fullPath})`);
  }
});

test("template/issues.json parses and is an empty seed", () => {
  const templateIssuesPath = path.join(rootDir, "template", "issues.json");
  const raw = readFileSync(templateIssuesPath, "utf8");
  const data = JSON.parse(raw);

  assert.ok(Array.isArray(data.issues), "issues must be an array");
  assert.equal(data.issues.length, 0, "template issues.json must seed with zero issues");
});
