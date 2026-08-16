import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const sharedSkillsDir = path.join(rootDir, "skills");

function commandNames() {
  return readdirSync(path.join(rootDir, "commands"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.basename(name, ".md"))
    .sort();
}

function frontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, "Codex entry skill must carry frontmatter");
  return Object.fromEntries(
    match[1].split(/\r?\n/).map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator), line.slice(separator + 1).trim()];
    })
  );
}

test("the Codex manifest exposes a dedicated skill root", () => {
  const manifestPath = path.join(rootDir, ".codex-plugin", "plugin.json");
  assert.ok(existsSync(manifestPath), "Codex needs its own plugin manifest");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.name, "harness");
  assert.equal(manifest.skills, "./skills/");
});

test("every Claude command has exactly one Codex $ entry", () => {
  const entries = readdirSync(sharedSkillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== "harness")
    .sort();
  assert.deepEqual(entries, commandNames());

  for (const name of entries) {
    const skillPath = path.join(sharedSkillsDir, name, "SKILL.md");
    assert.ok(existsSync(skillPath), `$harness:${name} is missing SKILL.md`);
    const content = readFileSync(skillPath, "utf8");
    const fields = frontmatter(content);
    assert.equal(fields.name, name, `the folder ${name} must register as $harness:${name}`);
    assert.match(fields.description, /^Use when /, `${name} needs a trigger-only description`);
    assert.match(
      content,
      /base directory announced for this entry skill/i,
      `${name} must derive the plugin root from the base Codex actually announces`
    );
    assert.match(
      content,
      /If the entry base is not announced, stop and ask for it/i,
      `${name} must fail closed instead of guessing an installed path`
    );
    assert.match(content, /skills\/harness\/SKILL\.md/, `${name} must load the authoritative skill`);
    assert.match(content, /skills\/harness\/references\//, `${name} must load its operation reference`);
    assert.match(
      content,
      /Operazioni portabili per host senza slash command/,
      `${name} must name the adapter section instead of asking Codex to infer it`
    );
  }
});

test("Codex and Claude share additive entry skills like Superpowers", () => {
  const claudeSkills = readdirSync(path.join(rootDir, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(claudeSkills, [...commandNames(), "harness"].sort());
  assert.ok(existsSync(path.join(rootDir, ".claude-plugin", "plugin.json")));
});

test("the README explains Codex $ discovery and reload", () => {
  const readme = readFileSync(path.join(rootDir, "README.md"), "utf8");
  for (const name of commandNames()) {
    assert.ok(readme.includes(`$harness:${name}`), `README misses $harness:${name}`);
  }
  assert.match(readme, /new (thread|session)/i, "Codex must reload the plugin in a new thread");
});
