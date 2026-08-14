// Structural checks on the plugin's skill: a broken frontmatter or a dangling reference link
// only shows up as an agent quietly missing its instructions, so it is worth a test.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const skillDir = path.join(rootDir, "skills", "harness");
const skillPath = path.join(skillDir, "SKILL.md");
const referencesDir = path.join(skillDir, "references");

function readSkill() {
  return readFileSync(skillPath, "utf8");
}

// Minimal frontmatter reader: the delimiters and the two keys the loader needs, nothing more.
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, "SKILL.md must open with a --- delimited frontmatter block");
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv) {
      fields[kv[1]] = kv[2].trim();
    }
  }
  return fields;
}

test("SKILL.md carries a frontmatter with name and description", () => {
  const fields = parseFrontmatter(readSkill());
  assert.equal(fields.name, "harness");
  assert.ok(fields.description.length > 40, "description must be substantial enough to route to the skill");
});

test("every reference link in SKILL.md resolves to a file that exists", () => {
  const content = readSkill();
  const links = [...content.matchAll(/\]\((references\/[a-z-]+\.md)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 5, `expected the skill to link its references, found ${links.length}`);
  for (const link of new Set(links)) {
    assert.ok(existsSync(path.join(skillDir, link)), `dangling reference link: ${link}`);
  }
});

test("every reference file is reachable from SKILL.md", () => {
  const content = readSkill();
  for (const file of readdirSync(referencesDir).filter((f) => f.endsWith(".md"))) {
    assert.ok(
      content.includes(`references/${file}`),
      `${file} exists but SKILL.md never links it, so it will never be read`
    );
  }
});

test("cross-links between reference files resolve too", () => {
  for (const file of readdirSync(referencesDir).filter((f) => f.endsWith(".md"))) {
    const content = readFileSync(path.join(referencesDir, file), "utf8");
    for (const match of content.matchAll(/\]\(([a-z-]+\.md)\)/g)) {
      assert.ok(
        existsSync(path.join(referencesDir, match[1])),
        `${file} links ${match[1]}, which does not exist`
      );
    }
  }
});

test("the skill instructs against the v1 harness machinery", () => {
  const files = [
    skillPath,
    ...readdirSync(referencesDir).map((f) => path.join(referencesDir, f)),
  ];
  // These are commands and files the plugin model removed: an instruction to run or read them
  // would send an agent after something that no longer exists.
  const forbidden = [
    "node init.mjs",
    "issue-manager.mjs setup",
    ".harness-manifest.json",
    "harness update",
    "dev:sync",
    "seeded-once",
  ];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const needle of forbidden) {
      assert.ok(
        !content.includes(needle),
        `${path.basename(file)} still references the removed v1 machinery: ${needle}`
      );
    }
  }
});

test("the tracker is always invoked through the plugin root, never as a project file", () => {
  const files = [
    skillPath,
    ...readdirSync(referencesDir).map((f) => path.join(referencesDir, f)),
  ];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/node "?([^"\s]*issue-manager\.mjs)/g)) {
      const invocation = match[1];
      assert.ok(
        invocation.includes("$SCRIPTS") || invocation.includes("CLAUDE_PLUGIN_ROOT"),
        `${path.basename(file)} invokes the tracker as '${invocation}', which assumes a copy in the project`
      );
    }
  }
});

test("the skill says which work becomes an issue at all", () => {
  const content = readSkill();

  assert.match(
    content,
    /^## Cosa diventa una issue$/m,
    "the compass needs its own chapter: a rule folded into another one is a rule nobody finds"
  );
  assert.match(
    content,
    /costoso e invisibile/,
    "the compass must state both halves; either one alone opens issues that are not worth an agent"
  );

  // The old premise contradicted the compass outright, and a reader who stops at the opening
  // paragraph would follow the premise.
  assert.ok(
    !content.includes("ogni pezzo di lavoro è una issue tracciata"),
    "the opening still claims every piece of work is an issue"
  );

  // Order matters: "does this enter the tracker" comes before "how much ceremony does it get".
  const compass = content.indexOf("## Cosa diventa una issue");
  const light = content.indexOf("## Verifica leggera");
  assert.ok(
    compass < light,
    "the compass must precede the light-verification chapter, which presupposes an issue already decided"
  );
});

test("a criterion must be checkable with the verifier's own access", () => {
  const issues = readFileSync(path.join(referencesDir, "issues.md"), "utf8");
  const verification = readFileSync(path.join(referencesDir, "verification.md"), "utf8");

  // "verifiable by another agent" was never the whole rule: that agent has the worker's
  // environment and nothing more.
  assert.match(
    issues,
    /accessi che il verificatore ha/,
    "issues.md must tie a criterion's verifiability to the verifier's access, not only to its wording"
  );

  assert.match(
    verification,
    /^## Quando la prova sta fuori dalla portata dell'agent$/m,
    "verification.md must say what happens when the proof cannot be collected at all"
  );

  // All four are mandatory: dropping "what we proceed on meanwhile" is what turns a request
  // into a stall, and dropping "why not from here" is what turns it into lazy delegation.
  for (const voice of [
    "Cosa lanciare",
    "Cosa serve indietro",
    "Su cosa si prosegue intanto",
    "Perché non si può fare da qui",
  ]) {
    assert.ok(
      verification.includes(voice),
      `the out-of-reach request must ask "${voice}"`
    );
  }

  // The escape hatch exists, and its whole point is who holds the pen.
  assert.match(
    verification,
    /firma il committente/,
    "verification.md must say the reformulation is signed by the committente, never by the worker"
  );
});

test("the board is a tool you ask for, not a clock-in step", () => {
  const content = readSkill();
  const board = readFileSync(path.join(referencesDir, "board.md"), "utf8");

  // Slice out the clock-in chapter and assert the board is not in it. Grepping the whole
  // skill would match the reference index at the bottom, which must keep linking board.md.
  const start = content.indexOf("## Clock in");
  const end = content.indexOf("## Regola 1-WIP");
  assert.ok(start !== -1 && end > start, "the Clock in chapter moved: fix this test, not the skill");
  const clockIn = content.slice(start, end);

  assert.ok(
    !/board/i.test(clockIn),
    "clock-in still starts the board: the only consumer that ran it forbade it in writing"
  );
  assert.match(
    clockIn,
    /status-cli\.mjs/,
    "the tracker summary must stay the clock-in step that survives"
  );

  assert.ok(
    !board.includes("al clock-in, automaticamente"),
    "board.md still declares an automatic start"
  );
  assert.match(
    board,
    /^## Perché non parte da solo$/m,
    "board.md must record why the default changed, or it will be changed back"
  );
});

test("the skill says how $SCRIPTS is computed, not just what it stands for", () => {
  // ${CLAUDE_PLUGIN_ROOT} is not an environment variable: no shell expands it. Naming it without
  // saying how to resolve it leaves the reader one option — reuse an absolute path seen somewhere
  // else — and that path carries the plugin's version number, so it keeps working against a stale
  // copy instead of failing. Anchored to the derivation and to the ban, never to the bare word
  // "path": the skill says "path" dozens of times and a loose regex would pass with the rule gone.
  const content = readSkill();
  assert.match(
    content,
    /non\s+è\s+una\s+variabile\s+d['’]ambiente/i,
    "the skill must say that CLAUDE_PLUGIN_ROOT is not something a shell can expand"
  );
  assert.match(
    content,
    /base\s+directory\s+che\s+il\s+tool\s+Skill\s+annuncia/i,
    "the skill must name where the value actually comes from"
  );
  assert.match(
    content,
    /\.\.\/\.\.\/scripts/,
    "the skill must give the derivation from the skill's own base directory"
  );
  assert.match(
    content,
    /non\s+indovinarlo,?\s+e\s+non\s+riusare\s+un\s+path\s+assoluto\s+visto\s+altrove/i,
    "reusing an absolute path from elsewhere must be forbidden in so many words"
  );
  assert.match(
    content,
    /non\*{0,2}\s+fallisce/i,
    "the skill must say the stale path runs instead of failing: that is why the ban is not advice"
  );
});

test("installing harness is offered as advice, never as a step", () => {
  // The question arrives, and without an answer in writing the agent invents one — usually copying
  // the scripts into the project, which is the one thing harness does not do. It earns a section,
  // but a section that reads as a step would put an install into every clock-in.
  const content = readSkill();
  const start = content.indexOf("## Consiglio, su richiesta: installare harness");
  assert.ok(start !== -1, "the skill must carry the install section, marked as advice in its title");
  const end = content.indexOf("## Reference", start);
  const advice = content.slice(start, end === -1 ? undefined : end);

  assert.match(
    advice,
    /non\s+è\s+un\s+passo\s+del\s+workflow/i,
    "the section must disclaim being part of the workflow, in its own body and not only in its title"
  );
  assert.match(advice, /\/plugin\s+install\s+harness@diemrt/, "the section must give the command");
  assert.match(
    advice,
    /non\s+è\s+attivo\s+nella\s+sessione\s+in\s+corso/i,
    "a freshly installed plugin needs a restart, and that is the half everyone is bitten by"
  );

  // The clock-in must stay clear of it: an install that appears among the opening steps is exactly
  // the outcome the marking exists to prevent.
  const clockIn = content.slice(content.indexOf("## Clock in"), content.indexOf("## Regola 1-WIP"));
  assert.ok(
    !/\/plugin\s+install/.test(clockIn),
    "clock-in names an install command: the advice leaked into the workflow"
  );
});

test("the docs gate names the field and the script, not just the duty", () => {
  const content = readSkill();
  const start = content.indexOf("## Dopo il commit: gate documentale");
  const end = content.indexOf("## Clock out");
  assert.ok(start !== -1 && end > start, "the docs gate chapter moved: fix this test, not the skill");
  const chapter = content.slice(start, end);

  // A duty with no field to write and no way to notice it was skipped is the instruction that
  // already failed twice out of three times on the only project that ran it.
  assert.match(chapter, /covers/, "the docs issue must declare the revision it covers");
  assert.match(
    chapter,
    /docs-gate\.mjs/,
    "the chapter prescribes running the script, so it must name it directly, like status-cli.mjs"
  );
});

test("every CLI script the plugin ships is named where an agent will read it", () => {
  // The mirror image of the orphan-reference test above. A subagent, or an agent loading this
  // skill from outside, has no slash commands: it reads SKILL.md and follows the links into
  // references/. A script named nowhere in that corpus exists for nobody.
  const corpus = [
    readSkill(),
    ...readdirSync(referencesDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => readFileSync(path.join(referencesDir, f), "utf8")),
  ].join("\n");

  for (const file of readdirSync(path.join(rootDir, "scripts")).filter((f) => f.endsWith(".mjs"))) {
    assert.ok(
      corpus.includes(file),
      `scripts/${file} exists but neither SKILL.md nor any reference names it: an agent that reads the skill will never learn it is there`
    );
  }
});
