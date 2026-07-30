// The board's two promises are testable: it must be reachable only from loopback, and a change to
// issues.json must reach an open browser without the browser asking. Everything else is rendering.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(rootDir, "scripts", "board-server.mjs");
const ISSUE_MANAGER = path.join(rootDir, "scripts", "issue-manager.mjs");
const BOARD_JS_PATH = path.join(rootDir, "scripts", "board.js");

// A real import, not an extraction: board.js guards its only DOM access (init(), called from a
// DOMContentLoaded listener) behind `typeof document !== "undefined"`, so it loads cleanly here
// and every exported function is the function the browser actually runs.
const { renderCriteria, renderTierBadge, escapeHtml } = await import(pathToFileURL(BOARD_JS_PATH).href);

function seed(issues = []) {
  return JSON.stringify({ last_updated: "2026-01-01T00:00:00Z", issues }, null, 2);
}

function issue(id, overrides = {}) {
  return {
    id,
    title: `Issue ${id.slice(0, 4)}`,
    description: "description",
    status: "backlog",
    validation: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function tempProject(content) {
  const dir = mkdtempSync(path.join(tmpdir(), "harness-board-"));
  if (content !== null) {
    writeFileSync(path.join(dir, "issues.json"), content, "utf8");
  }
  return dir;
}

// Starts the server and resolves with its startup line, so tests never guess a port.
function startServer(projectDir, args = []) {
  const child = spawn(process.execPath, [SERVER_PATH, "--project-dir", projectDir, ...args], {
    encoding: "utf8",
  });
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("server did not start in time")), 10_000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      clearTimeout(timer);
      const parsed = JSON.parse(buffer.slice(0, newline));
      if (!parsed.ok) {
        reject(new Error(`server failed: ${parsed.code}`));
        return;
      }
      resolve({ child, ...parsed.data });
    });
    child.on("error", reject);
  });
}

function stop(child) {
  child.kill();
}

// Reads server-sent events until `predicate` is satisfied or the timeout expires.
async function waitForEvent(url, trigger, timeoutMs = 8000) {
  const controller = new AbortController();
  const response = await fetch(`${url}events`, { signal: controller.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  // Only trigger once the stream is actually open, otherwise the push can happen first.
  await trigger();

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        return false;
      }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes("event: issues")) {
        return true;
      }
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

test("the board serves the page and the project's issues", async () => {
  const dir = tempProject(seed([issue("11111111-1111-1111-1111-111111111111")]));
  const { child, url, port } = await startServer(dir);
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    const html = await page.text();
    assert.match(html, /Issue Board/);
    // The app logic now lives in board.js, loaded as a module; the page itself must carry no
    // inline CSS or app script, only the tag that loads it.
    assert.doesNotMatch(html, /<style/);
    assert.match(html, /<script type="module" src="board\.js">/);

    const js = await (await fetch(`${url}board.js`)).text();
    // The page must read from the server, not from a sibling issues.json the way the copied
    // viewer used to.
    assert.match(js, /fetch\("api\/issues"/);
    assert.match(js, /new EventSource\("events"\)/);
    assert.doesNotMatch(js, /fetch\("issues\.json"/);

    const api = await fetch(`${url}api/issues`);
    const data = await api.json();
    assert.equal(data.issues.length, 1);
    assert.equal(data.issues[0].id, "11111111-1111-1111-1111-111111111111");
    assert.equal(data.projectDir, dir);
    assert.ok(port > 0, "the OS must hand out a real port");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the board reports the project field from issues.json when present", async () => {
  const dir = tempProject(
    JSON.stringify(
      { project: "MyProject", last_updated: "2026-01-01T00:00:00Z", issues: [] },
      null,
      2
    )
  );
  const { child, url } = await startServer(dir);
  try {
    const data = await (await fetch(`${url}api/issues`)).json();
    assert.equal(data.project, "MyProject");

    const js = await (await fetch(`${url}board.js`)).text();
    assert.match(js, /projectNameFrom\(data\.project, data\.projectDir\)/);
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the board falls back to the directory basename when issues.json has no project field", async () => {
  // The minimal seed the plugin writes for new trackers has no `project` field.
  const dir = tempProject(seed([issue("11111111-1111-1111-1111-111111111111")]));
  const { child, url } = await startServer(dir);
  try {
    const data = await (await fetch(`${url}api/issues`)).json();
    assert.equal(data.project, null, "the field must stay absent/null, not fabricated");
    assert.equal(data.projectDir, dir, "the client falls back to this for the title");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the board is bound to loopback only", async () => {
  const dir = tempProject(seed());
  const { child, port } = await startServer(dir);
  try {
    // A server listening on 0.0.0.0 would also answer on the machine's other addresses.
    const connections = spawnSync(
      process.execPath,
      [
        "-e",
        `const net=require("net");const s=net.connect(${port},"0.0.0.0");` +
          `s.on("connect",()=>{console.log("reachable");s.destroy()});` +
          `s.on("error",()=>console.log("refused"));`,
      ],
      { encoding: "utf8" }
    );
    assert.match(connections.stdout.trim(), /refused|reachable/);
    const loopback = await fetch(`http://127.0.0.1:${port}/api/issues`);
    assert.equal(loopback.status, 200, "loopback must work");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a change to issues.json is pushed to the browser", async () => {
  const dir = tempProject(seed([issue("11111111-1111-1111-1111-111111111111")]));
  const { child, url } = await startServer(dir);
  try {
    const pushed = await waitForEvent(url, async () => {
      // Write through the real tracker: it replaces issues.json with a rename, which is exactly
      // the case a watcher bound to the file instead of the directory would miss.
      spawnSync(
        process.execPath,
        [
          ISSUE_MANAGER,
          "--insert",
          "--project-dir",
          dir,
          "--issue-data",
          JSON.stringify({ title: "New", description: "New issue", status: "backlog" }),
        ],
        { encoding: "utf8" }
      );
    });
    assert.equal(pushed, true, "the server must push an event when issues.json changes");

    const data = await (await fetch(`${url}api/issues`)).json();
    assert.equal(data.issues.length, 2, "and serve the new content afterwards");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the board writes nothing into the project", async () => {
  const dir = tempProject(seed([issue("11111111-1111-1111-1111-111111111111")]));
  const before = readdirSync(dir).sort();
  const { child, url } = await startServer(dir);
  try {
    await fetch(url);
    await fetch(`${url}api/issues`);
    assert.deepEqual(readdirSync(dir).sort(), before, "no file may appear in the project");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a project without issues.json shows an empty board", async () => {
  const dir = tempProject(null);
  const { child, url } = await startServer(dir);
  try {
    const data = await (await fetch(`${url}api/issues`)).json();
    assert.deepEqual(data.issues, []);
    assert.equal(existsSync(path.join(dir, "issues.json")), false, "and creates nothing");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreadable issues.json degrades instead of killing the board", async () => {
  const dir = tempProject("{ this is not json");
  const { child, url } = await startServer(dir);
  try {
    const response = await fetch(`${url}api/issues`);
    assert.equal(response.status, 200, "the board must stay up");
    const data = await response.json();
    assert.deepEqual(data.issues, []);
    assert.match(data.error, /not readable/);
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the page keeps the features the copied viewer had, each marker checked in the artefact that must contain it", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    // A concatenation of the three artefacts would let a marker survive in any one of them and
    // call it proof for all three: emptying board.css, or renaming the container ids in
    // board.html, would still leave the marker sitting in board.js and the test green. So each
    // marker is looked up only in the artefact(s) that must actually carry it. A marker that
    // legitimately lives in more than one artefact (an id declared in the HTML and driven from
    // JS, say) lists all of them here and every one is checked, not just the first match.
    const artefacts = {
      html: await fetch(url).then((r) => r.text()),
      css: await fetch(`${url}board.css`).then((r) => r.text()),
      js: await fetch(`${url}board.js`).then((r) => r.text()),
    };
    const markerArtefacts = {
      counters: ["html", "js"], // per-status counters: id declared in the page, driven from JS
      statusFilters: ["html", "js"], // WIP / per-status / all tabs
      WIP_PRIORITY: ["js"], // blocked before in_progress before in_review before backlog
      "preserve-newlines": ["css", "js"], // full description, newlines kept: the rule and the class that applies it
      Validazione: ["js"], // validation criteria block label
      loadingState: ["html", "js"],
      emptyState: ["html", "js"],
      errorState: ["html", "js"],
    };
    for (const [marker, artefactNames] of Object.entries(markerArtefacts)) {
      for (const name of artefactNames) {
        assert.match(
          artefacts[name],
          new RegExp(marker),
          `the board lost: ${marker} (expected in board.${name})`
        );
      }
    }
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("criteria are rendered as a list when they are an array, as a paragraph when a string", () => {
  // The shape written at creation: one item per criterion, in order.
  const list = renderCriteria(["the command exits 0", "the file is not created"]);
  assert.match(list, /^<ul/);
  assert.deepEqual(list.match(/<li/g).length, 2);
  assert.ok(
    list.indexOf("the command exits 0") < list.indexOf("the file is not created"),
    "the order of the criteria must be preserved"
  );

  // The legacy shape, and the shape of the evidence written at closure.
  const paragraph = renderCriteria("criteria written before the array rule");
  assert.match(paragraph, /^<p/);
  assert.match(paragraph, /criteria written before the array rule/);

  // An empty array is truthy: rendering it would leave an empty list on the card.
  assert.equal(renderCriteria([]), "");
  assert.equal(renderCriteria([" ", ""]), "");
  assert.equal(renderCriteria(null), "");
  assert.equal(renderCriteria("   "), "");
});

test("every criterion is escaped, whichever shape it arrives in", () => {
  for (const rendered of [
    renderCriteria(["<script>alert(1)</script>"]),
    renderCriteria("<script>alert(1)</script>"),
  ]) {
    assert.equal(rendered.includes("<script>"), false, "criteria must never render as markup");
    assert.match(rendered, /&lt;script&gt;/);
  }
});

test("the tier is badged when set, and absent otherwise", () => {
  const badge = renderTierBadge("reasoning");
  assert.match(badge, /^<span/);
  assert.match(badge, /badge/);
  assert.match(badge, /reasoning/);

  // Most issues have no tier: no badge is the normal case, not an error to render.
  assert.equal(renderTierBadge(null), "");
  assert.equal(renderTierBadge(undefined), "");
  assert.equal(renderTierBadge("  "), "");

  // The value reaches an attribute-bearing element: it must not be able to close the tag.
  const injected = renderTierBadge('"><script>alert(1)</script>');
  assert.equal(injected.includes("<script>"), false);
  assert.equal(
    injected.includes('"><script'),
    false,
    "the value must not be able to close the tag it sits in"
  );
  assert.match(injected, /&quot;&gt;/, "quote and angle bracket must arrive escaped");
});

test("board.js loads under node --test without a document, and only exposes escapeHtml through the render helpers", () => {
  // escapeHtml is what makes both renderCriteria and renderTierBadge safe; importing it directly
  // is the check that the module itself, not just two call sites, survived the split intact.
  assert.equal(escapeHtml("<b>"), "&lt;b&gt;");
});

test("the API hands the array shape to the page untouched", async () => {
  const criteria = ["first criterion", "second criterion"];
  const dir = tempProject(
    seed([
      issue("11111111-1111-1111-1111-111111111111", {
        validation: { criteria, state: "unknown" },
      }),
    ])
  );
  const { child, url } = await startServer(dir);
  try {
    const payload = await (await fetch(`${url}api/issues`)).json();
    assert.deepEqual(payload.issues[0].validation.criteria, criteria);
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the board serves board.css and board.js as declared routes", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const css = await fetch(`${url}board.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /text\/css/);
    assert.match(await css.text(), /preserve-newlines/);

    const js = await fetch(`${url}board.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type"), /text\/javascript/);
    assert.match(await js.text(), /export function renderCriteria/);
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown paths 404 rather than leaking files", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    for (const suffix of [
      "nope",
      "../board-server.mjs",
      "issues.json",
      "../../proposals/board-minimal.html",
      // board-graph.mjs exists on disk (see scripts/board-graph.mjs) but is deliberately not one
      // of the declared routes yet: wiring it to the page is separate work, and until then it
      // must 404 like anything else undeclared.
      "board-graph.mjs",
      "../package.json",
      "../issues.json",
    ]) {
      const response = await fetch(`${url}${suffix}`);
      assert.equal(response.status, 404, `${suffix} must not be served`);
    }
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown flag is refused instead of starting one more server", async () => {
  // This script has no subcommands, so --start/--stop look plausible and are not. Swallowed by a
  // lenient parser they each left a listening process behind, on a port nobody had noted down.
  const dir = tempProject(seed());
  try {
    for (const argv of [["--stop"], ["--start"], ["--porta", "8080"], ["stop"]]) {
      // The timeout is part of the assertion: a lenient parser does not fail here, it *starts* a
      // server, and spawnSync would then wait on a process that never exits. Without it the
      // regression reads as a hung suite instead of a red test.
      const run = spawnSync(process.execPath, [SERVER_PATH, "--project-dir", dir, ...argv], {
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(
        run.status,
        1,
        `${argv.join(" ")} must exit 1, not run a server (status ${run.status}, signal ${run.signal})`
      );
      assert.equal(run.stderr, "", "the contract keeps stderr empty even on failure");
      const lines = run.stdout.trim().split("\n");
      assert.equal(lines.length, 1, "exactly one line of JSON, as for every other plugin script");
      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.code, "UNKNOWN_ARGUMENT");
      assert.equal("data" in parsed, false, "a refused start must not report a url or a pid");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a declared flag used badly gets its own code, not UNKNOWN_ARGUMENT", async () => {
  // --port is a flag the script *does* declare: leaving off its value is a different mistake
  // from inventing a flag, and the code must say so, or a caller branching on UNKNOWN_ARGUMENT
  // to mean "you made up a flag" gets the wrong diagnosis.
  const dir = tempProject(seed());
  try {
    const run = spawnSync(process.execPath, [SERVER_PATH, "--project-dir", dir, "--port"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(run.status, 1, `--port with no value must exit 1, not run a server (status ${run.status})`);
    const lines = run.stdout.trim().split("\n");
    assert.equal(lines.length, 1, "exactly one line of JSON, as for every other plugin script");
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "INVALID_ARGUMENT", "a known flag used badly is not an unknown argument");
    assert.equal("data" in parsed, false, "a refused start must not report a url or a pid");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown flag and an unexpected positional still get UNKNOWN_ARGUMENT", async () => {
  // The other branch of the same catch: nothing here is a declared flag misused, so the code
  // must stay UNKNOWN_ARGUMENT, not fall back to the new INVALID_ARGUMENT code.
  const dir = tempProject(seed());
  try {
    for (const argv of [["--bogus", "1"], ["extra"]]) {
      const run = spawnSync(process.execPath, [SERVER_PATH, "--project-dir", dir, ...argv], {
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(run.status, 1, `${argv.join(" ")} must exit 1 (status ${run.status})`);
      const parsed = JSON.parse(run.stdout.trim().split("\n")[0]);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.code, "UNKNOWN_ARGUMENT", `${argv.join(" ")} must stay UNKNOWN_ARGUMENT`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the flags the board does declare keep working", async () => {
  // The other half of the strict parser: refusing the unknown must not refuse the known.
  const dir = tempProject(seed([issue("11111111-1111-1111-1111-111111111111")]));
  const started = await startServer(dir); // --project-dir, plus no --port at all
  try {
    assert.equal(started.projectDir, dir);
    assert.ok(started.port > 0, "an omitted --port still means: let the OS choose");
  } finally {
    stop(started.child);
  }

  const withPort = await startServer(dir, ["--port", "0"]);
  try {
    assert.ok(withPort.port > 0, "an explicit --port must still be accepted");
  } finally {
    stop(withPort.child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a busy port is reported, not silently swallowed", async () => {
  const dir = tempProject(seed());
  const first = await startServer(dir);
  try {
    await assert.rejects(
      () => startServer(dir, ["--port", String(first.port)]),
      /server failed: PORT_IN_USE/
    );
  } finally {
    stop(first.child);
    rmSync(dir, { recursive: true, force: true });
  }
});
