// Structural checks on the plugin's agents. The verifier's independence rests on two things a
// test can actually hold: it must not be able to edit files, and the skill must name the agent
// that exists.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const agentPath = path.join(rootDir, "agents", "harness-verifier.md");
const skillDir = path.join(rootDir, "skills", "harness");

function readAgent() {
  assert.ok(existsSync(agentPath), "agents/harness-verifier.md must exist");
  return readFileSync(agentPath, "utf8");
}

function frontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, "the agent must open with a --- delimited frontmatter block");
  return match[1];
}

test("harness-verifier declares a name and a description", () => {
  const fm = frontmatter(readAgent());
  assert.match(fm, /^name:\s*harness-verifier$/m);
  const description = fm.match(/description:\s*>?([\s\S]*?)(?=\n[a-z_-]+:|$)/);
  assert.ok(description, "the agent must carry a description");
  assert.ok(
    description[1].replace(/\s+/g, " ").trim().length > 60,
    "the description must say when to use the agent, not just name it"
  );
});

test("harness-verifier cannot edit files", () => {
  const fm = frontmatter(readAgent());
  const tools = fm.match(/^tools:\s*\[(.*)\]$/m);
  assert.ok(tools, "the agent must declare an explicit tool list");
  const granted = tools[1].split(",").map((t) => t.trim());
  for (const forbidden of ["Edit", "Write", "NotebookEdit", "MultiEdit"]) {
    assert.ok(
      !granted.includes(forbidden),
      `${forbidden} would let the verifier fix the work it is meant to judge`
    );
  }
  assert.ok(granted.includes("Read"), "the verifier must be able to read the artifacts");
  assert.ok(granted.includes("Bash"), "the verifier must be able to run the verification gate");
});

test("harness-verifier has more than one shell", () => {
  // Verifying means executing: without a shell that starts, the agent can run neither the gate nor
  // the closure. One shell makes independent verification not degraded but impossible — which is
  // what happened the day Git Bash stopped initialising and a verification was lost.
  const fm = frontmatter(readAgent());
  const granted = fm
    .match(/^tools:\s*\[(.*)\]$/m)[1]
    .split(",")
    .map((t) => t.trim());
  const shells = granted.filter((tool) => ["Bash", "PowerShell"].includes(tool));
  assert.ok(
    shells.length >= 2,
    `the verifier declares only ${JSON.stringify(shells)}: one broken interpreter and it cannot verify at all`
  );
});

test("harness-verifier is told to switch shell when one will not start", () => {
  // Anchored to the distinction, not to the word "shell": the prompt names shells in several
  // places, and a bare /shell/ would still pass with the whole rule deleted. What must survive is
  // that a failing COMMAND and a failing INTERPRETER are told apart, and that retrying is refused.
  const body = readAgent();
  assert.match(
    body,
    /la\s+shell\s+non\s+parte/i,
    "the prompt must name the failure mode where the interpreter itself is broken"
  );
  assert.match(
    body,
    /non\s+ritentare\s+lo\s+stesso\s+comando\s+sulla\s+stessa\s+shell/i,
    "retrying a dead interpreter must be forbidden in so many words"
  );
  assert.match(
    body,
    /non\s+dichiarare\s+`?pass`?/i,
    "a verification that could not run must be told never to pass"
  );
});

test("harness-verifier is told not to correct the work", () => {
  const body = readAgent().split(/\r?\n---\r?\n/).slice(1).join("\n");
  assert.match(body, /non corregg/i, "the prompt must forbid fixing the work in so many words");
});

test("harness-verifier closes issues through the plugin's tracker", () => {
  const body = readAgent();
  const invocations = [...body.matchAll(/node "?([^"\s]*issue-manager\.mjs)/g)].map((m) => m[1]);
  assert.ok(invocations.length >= 2, "the agent must show how to read and how to close an issue");
  for (const invocation of invocations) {
    assert.ok(
      invocation.includes("CLAUDE_PLUGIN_ROOT"),
      `'${invocation}' assumes a copy of the tracker in the project`
    );
  }
});

test("harness-verifier knows what to do with an issue that has no criteria", () => {
  // A null validation is the one case where the contract is not in the criteria. Without
  // instructions the agent either stalls or passes everything by default, and both are worse than
  // no verification at all: they look like a gate.
  const body = readAgent();
  assert.match(body, /validation.{0,20}null/is, "the prompt must cover the null validation case");
  assert.match(
    body,
    /Verifica leggera/,
    "the agent must know where the contract of such an issue is written"
  );
  // Anchored to the sentence, not to the bare word: the closure payload shown further down the
  // prompt already contains "state":"fail", so a /\bfail\b/ here would pass with the whole
  // paragraph deleted.
  assert.match(
    body,
    /codice\s+eseguibile\s+è\s+un\s+\*{0,2}fail\*{0,2},\s*non\s+un['’]osservazione/i,
    "leaving the declared class of work must be stated as a failure, not a note"
  );
  // Tolerant of the line wrapping the markdown applies: what matters is the instruction, not where
  // the paragraph happens to break.
  assert.match(
    body,
    /da\s+null\s+a\s+\*{0,2}oggetto/i,
    "closure must be documented as populating the validation object"
  );
});

test("harness-verifier may not probe the project's own tracker", () => {
  // A verifier that runs a trial --insert with the cwd on the repository writes a fixture into
  // the project's real issues.json, and it ships in the commit of the very issue it was judging.
  // The rule only holds if it lives here, not in whatever prompt the orchestrator improvises.
  // Asserts are anchored to the sentence: the words alone appear elsewhere in the prompt.
  const body = readAgent();
  assert.match(
    body,
    /unica\s+scrittura\s+ammessa\s+sul\s+tracker\s+del\s+progetto\s+è\s+la\s+chiusura\s+della\s+issue/i,
    "the only write on the project tracker must be stated to be the closure of the issue"
  );
  assert.match(
    body,
    /copia\s+in\s+directory\s+temporanea\*{0,2},\s*passando\s+`--project-dir`/i,
    "trying the CLI out must be pinned to a temp copy through an explicit --project-dir"
  );
  assert.match(
    body,
    /probe\s+sul\s+tracker\s+reale\s+è\s+\*{0,2}un\s+errore\s+del\s+verificatore/i,
    "a probe on the real tracker must be named a mistake, not a footnote"
  );
});

test("harness-verifier is told to tick the validation.tasks it verified", () => {
  // A bare /validation\.tasks/ would be worthless here: the prompt already named them in the
  // no-shell-starts branch ("non spuntare nessun validation.tasks") while the procedure said
  // nothing, and two issues closed pass with every box at false. The prohibition was never the
  // missing half — the DUTY was. So the asserts are anchored to the duty and to the two edges
  // that keep it honest: what stays unticked, and that ticking everything is not a shortcut.
  const body = readAgent();
  assert.match(
    body,
    /spunta\s+i\s+`?validation\.tasks`?\s+man\s+mano/i,
    "the procedure must tell the verifier to tick the validation tasks as it verifies them"
  );
  assert.match(
    body,
    /lasci\s+non\s+spuntati\s+gli\s+altri/i,
    "a task the verifier could not check must be told to stay unticked"
  );
  assert.match(
    body,
    /non\s+spuntarli\s+tutti\s+per\s+chiudere/i,
    "ticking the whole checklist just to close must be forbidden in so many words"
  );
});

test("the closure payload the verifier is shown carries validation.tasks", () => {
  // The CLI keeps the stored tasks when the payload omits the field, so an example without them
  // closes the issue done/pass with every box still false and nothing reports an error. The
  // example is the thing the agent copies: prose asking for the tick loses to a payload showing
  // it is not needed, which is exactly how this defect was built.
  const body = readAgent();
  const payloads = [...body.matchAll(/\{"status":"(?:done|blocked)"[^\n`]*/g)].map((m) => m[0]);
  assert.equal(
    payloads.length,
    2,
    "the agent must show both the passing and the failing closure payload"
  );
  for (const payload of payloads) {
    assert.ok(
      payload.includes('"tasks"'),
      `'${payload}' omits validation.tasks: the closure would still succeed, with the checklist untouched`
    );
  }
  assert.match(
    body,
    /rispedito\s+\*{0,2}per\s+intero/i,
    "the prompt must say the tasks array has to be sent back whole for a tick to land"
  );
});

test("harness-verifier is told how to resolve the plugin root it is shown", () => {
  // The agent's commands all carry ${CLAUDE_PLUGIN_ROOT}, which no shell expands. Shown without a
  // resolution rule it leaves the verifier one move — reuse an absolute path from somewhere else —
  // and that path carries the plugin's version, so it runs against a stale copy instead of
  // failing. For a verifier that is the worst possible failure: a pass about code it never read.
  //
  // Anchored to the rule and to its consequence. The word "path" is everywhere in this prompt, and
  // even /CLAUDE_PLUGIN_ROOT/ would match the command examples the rule exists to explain.
  const body = readAgent();
  assert.match(
    body,
    /non\s+è\s+una\s+variabile\s+d['’]ambiente/i,
    "the agent must be told the token is not something a shell expands"
  );
  assert.match(
    body,
    /base\s+directory\s+della\s+skill\s+harness/i,
    "the agent must be given where the value comes from when nobody hands it over"
  );
  assert.match(
    body,
    /non\s+indovinarlo\s+e\s+non\s+riusare\s+un\s+path\s+assoluto\s+visto\s+altrove/i,
    "guessing the root must be forbidden in so many words"
  );
  assert.match(
    body,
    /gira\s+sulla\s+versione\s+sbagliata/i,
    "the silent failure must be named: the command runs, against the wrong copy"
  );
});

test("the skill names an agent that exists", () => {
  const referenced = [
    path.join(skillDir, "SKILL.md"),
    path.join(skillDir, "references", "verification.md"),
  ];
  const name = frontmatter(readAgent()).match(/^name:\s*(.+)$/m)[1].trim();
  for (const file of referenced) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/`(harness-[a-z-]+)`/g)) {
      assert.equal(
        match[1],
        name,
        `${path.basename(file)} points at the agent '${match[1]}', which the plugin does not ship`
      );
    }
  }
});
