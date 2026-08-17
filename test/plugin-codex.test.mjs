import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const sharedSkillsDir = path.join(rootDir, "skills");

// The operations are the skill directories, minus the workflow skill itself. Claude Code registers
// them as /harness:<name>, Codex as $<name>, from the same files.
function operationNames() {
  return readdirSync(sharedSkillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== "harness")
    .sort();
}

function frontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, "an entry skill must carry frontmatter");
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    fields[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }
  return fields;
}

test("the Codex manifest exposes the shared skill root", () => {
  const manifestPath = path.join(rootDir, ".codex-plugin", "plugin.json");
  assert.ok(existsSync(manifestPath), "Codex needs its own plugin manifest");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.name, "harness");
  assert.equal(manifest.skills, "./skills/");
});

test("every operation is one skill, readable by a host that substitutes nothing", () => {
  for (const name of operationNames()) {
    const skillPath = path.join(sharedSkillsDir, name, "SKILL.md");
    assert.ok(existsSync(skillPath), `$${name} is missing SKILL.md`);
    const content = readFileSync(skillPath, "utf8");
    const fields = frontmatter(content);
    assert.equal(fields.name, name, `the folder ${name} must register as $${name}`);
    assert.match(
      content,
      /base directory annunciata per questa skill/i,
      `${name} must derive the plugin root from the base the host actually announces`
    );
    assert.match(
      content,
      /fermati e chiedila/i,
      `${name} must fail closed instead of guessing an installed path`
    );
    assert.match(content, /skills\/harness\/SKILL\.md/, `${name} must name the authoritative skill`);
    assert.match(content, /skills\/harness\/references\//, `${name} must name its operation reference`);

    const interfacePath = path.join(sharedSkillsDir, name, "agents", "openai.yaml");
    assert.ok(existsSync(interfacePath), `${name} needs agents/openai.yaml to appear in the $ menu`);
  }
});

test("Codex and Claude read the same skills, and Claude reads no second copy", () => {
  const claudeSkills = readdirSync(sharedSkillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(claudeSkills, [...operationNames(), "harness"].sort());

  const manifestPath = path.join(rootDir, ".claude-plugin", "plugin.json");
  assert.ok(existsSync(manifestPath));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.ok(
    !("commands" in manifest),
    "declaring `commands` would register a second spelling of the same operations, which is what duplicated them in the / menu"
  );
});

test("the two manifests and the marketplace agree on the version", () => {
  // The Codex manifest was written in its own commit and stayed a release behind the other two
  // without anything noticing: nothing reads the three together except a human comparing them.
  const read = (...segments) => JSON.parse(readFileSync(path.join(rootDir, ...segments), "utf8"));
  const claude = read(".claude-plugin", "plugin.json");
  const codex = read(".codex-plugin", "plugin.json");
  const marketplace = read(".claude-plugin", "marketplace.json");
  const published = marketplace.plugins.find((entry) => entry.name === "harness");
  assert.ok(published, "the marketplace must publish the harness plugin");
  assert.equal(codex.version, claude.version, "the Codex manifest is behind the Claude one");
  assert.equal(published.version, claude.version, "the marketplace is behind the plugin manifest");
});

test("the README explains Codex $ discovery and reload", () => {
  const readme = readFileSync(path.join(rootDir, "README.md"), "utf8");
  for (const name of operationNames()) {
    assert.ok(readme.includes(`$harness:${name}`), `README misses $harness:${name}`);
  }
  assert.match(readme, /new (thread|session)/i, "Codex must reload the plugin in a new thread");
});
