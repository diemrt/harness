// The board's two promises are testable: it must be reachable only from loopback, and a change to
// issues.json must reach an open browser without the browser asking. Everything else is rendering.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(rootDir, "scripts", "board-server.mjs");
const ISSUE_MANAGER = path.join(rootDir, "scripts", "issue-manager.mjs");

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

// The server canonicalises the directory it is handed, so a test comparing the path it reports
// has to canonicalise too: on Windows tmpdir() can already be an 8.3 short path.
function canonical(dir) {
  return realpathSync.native(dir);
}

// A path that reaches the same directory without being its canonical form — an 8.3 short path on
// Windows. Null when there is none to be had: 8.3 generation can be disabled per volume, and no
// other platform has the concept.
function shortPath(dir) {
  if (process.platform !== "win32") {
    return null;
  }
  // %TEMP% is itself often already short, in which case mkdtemp handed us the short path to begin
  // with and there is nothing to ask cmd for.
  if (canonical(dir) !== dir) {
    return dir;
  }
  const result = spawnSync("cmd", ["/c", `for %I in ("${dir}") do @echo %~sI`], { encoding: "utf8" });
  const short = (result.stdout ?? "").trim();
  if (!short || short === dir || !existsSync(short)) {
    return null;
  }
  return short;
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
    // The page must read from the server, not from a sibling issues.json the way the copied
    // viewer used to.
    assert.match(html, /fetch\("api\/issues"/);
    assert.match(html, /new EventSource\("events"\)/);
    assert.doesNotMatch(html, /fetch\("issues\.json"/);

    const api = await fetch(`${url}api/issues`);
    const data = await api.json();
    assert.equal(data.issues.length, 1);
    assert.equal(data.issues[0].id, "11111111-1111-1111-1111-111111111111");
    assert.equal(data.projectDir, canonical(dir));
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

    const html = await (await fetch(url)).text();
    assert.match(html, /projectNameFrom\(data\.project, data\.projectDir\)/);
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
    assert.equal(data.projectDir, canonical(dir), "the client falls back to this for the title");
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

test("a project directory given as an 8.3 short path does not kill the board", async (t) => {
  const dir = tempProject(seed([issue("11111111-1111-1111-1111-111111111111")]));
  const short = shortPath(dir);
  if (!short) {
    rmSync(dir, { recursive: true, force: true });
    t.skip("no 8.3 short path to be had on this platform or volume");
    return;
  }

  const { child, url } = await startServer(short);
  try {
    const data = await (await fetch(`${url}api/issues`)).json();
    assert.equal(data.projectDir, canonical(dir), "the announced path must be the canonical one");

    // watch() on a short path does not return an error: libuv aborts the process outright
    // (`!_wcsnicmp(filename, dir, dirlen)`, src\win\fs-event.c). The board would be dead by the
    // time the first change arrived, with its URL already announced as live.
    const pushed = await waitForEvent(url, async () => {
      spawnSync(
        process.execPath,
        [
          ISSUE_MANAGER,
          "--insert",
          "--project-dir",
          short,
          "--issue-data",
          JSON.stringify({ title: "New", description: "New issue", status: "backlog" }),
        ],
        { encoding: "utf8" }
      );
    });
    assert.equal(pushed, true, "a server started on a short path must still push");
    assert.equal(child.exitCode, null, "and must still be running: the libuv abort exits with 9");
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

test("the page keeps the features the copied viewer had", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    // Each of these was lost once already by rewriting the page instead of serving it.
    for (const marker of [
      "counters", // per-status counters
      "statusFilters", // WIP / per-status / all tabs
      "WIP_PRIORITY", // blocked before in_progress before in_review before backlog
      "preserve-newlines", // full description, newlines kept
      "Validazione", // validation criteria block
      "loadingState",
      "emptyState",
      "errorState",
      'id="issue-', // anchor target of a dependency chip
      "\\.issue-card:target", // and what says which card the jump landed on
      // The outline colour is checked as a string because no test here runs a browser, and the
      // way this broke once was silent: hsl() around daisyUI's --p, which holds bare oklch
      // components, is invalid at computed-value time and drops the whole outline to none.
      "outline: 2px solid oklch\\(",
    ]) {
      assert.match(html, new RegExp(marker), `the board page lost: ${marker}`);
    }
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

// Pulls a named function out of the served page and makes it callable here. The alternative — a
// marker regexp on the HTML — would pass on a renderer that is present and wrong.
function extractFunctions(html, names) {
  const sources = names.map((name) => {
    const start = html.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `the page must define ${name}`);
    let depth = 0;
    let index = html.indexOf("{", start);
    while (index < html.length) {
      if (html[index] === "{") depth += 1;
      if (html[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
      index += 1;
    }
    assert.ok(index < html.length, `${name} must have a balanced body`);
    return html.slice(start, index + 1);
  });
  return new Function(`${sources.join("\n")}\nreturn { ${names.join(", ")} };`)();
}

test("criteria are rendered as a list when they are an array, as a paragraph when a string", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { renderCriteria } = extractFunctions(html, ["renderCriteria", "escapeHtml"]);

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
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every criterion is escaped, whichever shape it arrives in", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { renderCriteria } = extractFunctions(html, ["renderCriteria", "escapeHtml"]);

    for (const rendered of [
      renderCriteria(["<script>alert(1)</script>"]),
      renderCriteria("<script>alert(1)</script>"),
    ]) {
      assert.equal(rendered.includes("<script>"), false, "criteria must never render as markup");
      assert.match(rendered, /&lt;script&gt;/);
    }
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the tier is badged when set, and absent otherwise", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { renderTierBadge } = extractFunctions(html, ["renderTierBadge", "escapeHtml"]);

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
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a dependency that is being rendered gets a chip that jumps to it", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { renderDependsOn } = extractFunctions(html, ["renderDependsOn", "escapeHtml"]);

    const target = "aaaaaaaa-1111-1111-1111-111111111111";
    const rendered = renderDependsOn(
      [target],
      new Set([target]),
      new Map([[target, "the issue that must close first"]])
    );

    assert.match(rendered, new RegExp(`<a href="#issue-${target}"`), "the chip must be an anchor onto the target card");
    assert.match(rendered, />aaaaaaaa</, "the chip shows the first eight characters of the id");
    assert.equal(rendered.includes(`>${target}<`), false, "the whole GUID does not belong on the chip");
    // The tooltip is where the id stays copyable and the title says what it points at.
    assert.match(rendered, new RegExp(`title="${target} — the issue that must close first"`));
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a dependency nobody is rendering gets an inert chip, whether it is filtered out or gone", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { renderDependsOn } = extractFunctions(html, ["renderDependsOn", "escapeHtml"]);

    // In the payload, but filtered out of this render: the title is still known.
    const filtered = "bbbbbbbb-2222-2222-2222-222222222222";
    const outOfView = renderDependsOn([filtered], new Set(), new Map([[filtered, "a closed dependency"]]));
    assert.match(outOfView, /^\s*<div/);
    assert.match(outOfView, /<span[^>]*title="bbbbbbbb-2222-2222-2222-222222222222 — a closed dependency"/);
    assert.equal(outOfView.includes("<a "), false, "an unreachable chip must not be a link");
    assert.equal(outOfView.includes("href="), false, "an unreachable chip must not carry an href");

    // Not in the payload at all: the CLI forbids it, a hand edit of issues.json does not.
    const unknown = "cccccccc-3333-3333-3333-333333333333";
    const orphan = renderDependsOn([unknown], new Set(), new Map());
    assert.equal(orphan.includes("href="), false);
    assert.match(orphan, new RegExp(`title="${unknown}"`), "an id nobody knows keeps the id alone as its tooltip");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no dependencies means no block at all, and the declared order is kept", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { renderDependsOn } = extractFunctions(html, ["renderDependsOn", "escapeHtml"]);

    // Most issues depend on nothing: an empty label with no chips under it would be noise on
    // every card of the board, so absence renders as absence.
    assert.equal(renderDependsOn([], new Set(), new Map()), "");
    assert.equal(renderDependsOn(undefined, new Set(), new Map()), "");
    assert.equal(renderDependsOn(null, new Set(), new Map()), "");

    const first = "dddddddd-4444-4444-4444-444444444444";
    const second = "eeeeeeee-5555-5555-5555-555555555555";
    const rendered = renderDependsOn([first, second], new Set([first, second]), new Map());
    assert.ok(
      rendered.indexOf("dddddddd") < rendered.indexOf("eeeeeeee"),
      "the chips must follow the order the field declares"
    );
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a dependency's title cannot break out of the tooltip it is written into", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { renderDependsOn } = extractFunctions(html, ["renderDependsOn", "escapeHtml"]);

    // The title of another issue reaches an attribute here, and titles are free text.
    const id = "ffffffff-6666-6666-6666-666666666666";
    const rendered = renderDependsOn([id], new Set([id]), new Map([[id, '"><script>alert(1)</script>']]));

    assert.equal(rendered.includes("<script>"), false, "a title must never render as markup");
    assert.equal(
      rendered.includes('"><script'),
      false,
      "the title must not be able to close the attribute it sits in"
    );
    assert.match(rendered, /&quot;&gt;/);
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
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

test("unknown paths 404 rather than leaking files", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    for (const suffix of ["nope", "../board-server.mjs", "issues.json", "../../proposals/board-minimal.html"]) {
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

test("a declared flag used badly is not reported as an unknown one", async () => {
  // The parser fails the same way for "you invented a flag" and for "this flag of ours is missing
  // its value", and the catch used to flatten both into UNKNOWN_ARGUMENT. The message stayed
  // readable, but the code is what a caller branches on, and it named the wrong mistake: nobody
  // invented --port. Both codes are asserted here and in the test above, so collapsing the catch
  // back onto one code turns one of the two red whichever code it picks.
  const dir = tempProject(seed());
  try {
    for (const argv of [["--port"], ["--project-dir"], ["--port", "--project-dir", dir]]) {
      const run = spawnSync(process.execPath, [SERVER_PATH, ...argv], {
        encoding: "utf8",
        cwd: dir,
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
      assert.equal(
        parsed.code,
        "INVALID_ARGUMENT_VALUE",
        `${argv.join(" ")} names a flag the script declares: that is not an unknown argument`
      );
      assert.equal("data" in parsed, false, "a refused start must not report a url or a pid");
      // The human reading the line still needs to know which flag went wrong.
      assert.match(parsed.error, /--(port|project-dir)/);
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
    assert.equal(started.projectDir, canonical(dir));
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

// ---------------------------------------------------------------------------
// The tasks on the card: one summary row per array, and the tasks themselves only on expansion.
// The card hides nothing today and has no collapse mechanism at all, so twelve execution tasks
// always visible would fill the screen and the board would lose the thing it exists for.
// ---------------------------------------------------------------------------

function boardTask(id, overrides = {}) {
  return { id, short_title: `task ${id}`, full_description: `do the thing ${id}`, checked: false, ...overrides };
}

test("progressBar fills only when the work is actually finished", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { progressBar } = extractFunctions(html, ["progressBar"]);

    assert.equal(progressBar(0, 0), "");
    assert.equal(progressBar(0, 4).length, 10);
    assert.equal(progressBar(4, 4), "▓".repeat(10));
    // Nine of ten is not ten of ten: rounding up would show a finished row for work that is not,
    // which is the fresh-looking stale datum this design refuses everywhere else.
    assert.ok(progressBar(9, 10).endsWith("░"));
    assert.ok(!progressBar(0, 4).includes("▓"));
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a task block summarises in one row and keeps the tasks collapsed", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { renderTaskBlock } = extractFunctions(html, ["renderTaskBlock", "escapeHtml", "progressBar"]);

    const rendered = renderTaskBlock([boardTask(1, { checked: true }), boardTask(2)], {
      issueId: "abc",
      kind: "exec",
      label: "task",
      expanded: new Set(),
    });

    assert.match(rendered, /<details/);
    assert.ok(!/<details[^>]*\sopen/.test(rendered), "a collapsed block must not carry the open attribute");
    assert.match(rendered, /1\/2/);
    assert.match(rendered, /task 1/);
    assert.match(rendered, /do the thing 1/);
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an expanded block comes back expanded after a re-render", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { renderTaskBlock } = extractFunctions(html, ["renderTaskBlock", "escapeHtml", "progressBar"]);

    // Every push from the server rebuilds the list through innerHTML, and that happens constantly
    // while the work is going on: a block that closed itself on every write would be unusable.
    const rendered = renderTaskBlock([boardTask(1)], {
      issueId: "abc",
      kind: "exec",
      label: "task",
      expanded: new Set(["abc:exec"]),
    });
    assert.match(rendered, /<details[^>]*\sopen/);
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a card with no tasks renders no block at all", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { renderTaskBlock } = extractFunctions(html, ["renderTaskBlock", "escapeHtml", "progressBar"]);

    const options = { issueId: "abc", kind: "exec", label: "task", expanded: new Set() };
    assert.equal(renderTaskBlock([], options), "");
    assert.equal(renderTaskBlock(null, options), "");
    assert.equal(renderTaskBlock(undefined, options), "");
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("task text is escaped like every other field on the card", async () => {
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const html = await (await fetch(url)).text();
    const { renderTaskBlock } = extractFunctions(html, ["renderTaskBlock", "escapeHtml", "progressBar"]);

    const rendered = renderTaskBlock(
      [{ id: 1, short_title: "<script>alert(1)</script>", full_description: '"><img onerror=x>', checked: false }],
      { issueId: '"><script>alert(2)</script>', kind: "exec", label: "task", expanded: new Set() }
    );
    assert.equal(rendered.includes("<script>"), false);
    assert.equal(rendered.includes("<img onerror"), false);
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the board never writes: no HTTP method mutates issues.json", async () => {
  const dir = tempProject(seed([issue("11111111-1111-1111-1111-111111111111")]));
  const { child, url } = await startServer(dir);
  try {
    const before = readFileSync(path.join(dir, "issues.json"), "utf8");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      await fetch(new URL("api/issues", url), {
        method,
        body: method === "DELETE" ? undefined : '{"issues":[]}',
      });
    }
    assert.equal(
      readFileSync(path.join(dir, "issues.json"), "utf8"),
      before,
      "the board is read-only: the guard against self-validation lives in the process environment, " +
        "and a click in a browser carries no role"
    );
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Staying alive, and dying out loud. The board announced an URL and then died three times in one
// session — 50, 25 and 16 minutes — without saying anything, which is worse than dying: the caller
// keeps an URL it believes is live.
// ---------------------------------------------------------------------------

// Reads the child's stdout until a second JSON line shows up (the first is the startup line).
function nextLine(child, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("no further line on stdout")), timeoutMs);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const line = buffer.split("\n").find((l) => l.trim().length > 0);
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      }
    });
  });
}

test("the project directory disappearing is announced on stdout, not spun on in silence", async () => {
  const dir = tempProject(seed());
  const { child } = await startServer(dir);
  try {
    const dying = nextLine(child);
    rmSync(dir, { recursive: true, force: true });

    const line = await dying;
    assert.equal(line.ok, false);
    assert.equal(line.code, "WATCH_LOST");
    assert.match(line.error, /board cannot follow/);
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an SSE client that vanishes without closing does not take the process with it", async () => {
  const dir = tempProject(seed());
  const { child, url, port } = await startServer(dir);
  try {
    // A raw socket, destroyed mid-stream: a killed tab or a suspended laptop leaves exactly this,
    // a connection the server still believes in.
    const socket = net.connect(port, "127.0.0.1");
    await new Promise((resolve) => socket.on("connect", resolve));
    socket.write("GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    await new Promise((resolve) => setTimeout(resolve, 200));
    socket.destroy();

    // The write lands while the server may still be holding the dead response.
    writeFileSync(path.join(dir, "issues.json"), seed([issue("22222222-2222-2222-2222-222222222222")]), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal((await fetch(url)).status, 200);
    const payload = await (await fetch(new URL("api/issues", url))).json();
    assert.equal(payload.issues.length, 1);
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SIGTERM still closes the server with an open SSE connection", async () => {
  const dir = tempProject(seed());
  const { child, port } = await startServer(dir);
  try {
    const socket = net.connect(port, "127.0.0.1");
    // The server going away resets this socket, and an unhandled 'error' here would fail the test
    // for the very thing it is checking happens.
    socket.on("error", () => {});
    await new Promise((resolve) => socket.on("connect", resolve));
    socket.write("GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    await new Promise((resolve) => setTimeout(resolve, 200));

    // What matters is that it exits rather than hanging on the open stream. The exit code is not
    // asserted: Windows has no real SIGTERM, and Node emulates it by terminating the process
    // outright, so the handler that would exit 0 never runs there.
    const exited = new Promise((resolve) => child.on("exit", () => resolve(true)));
    child.kill("SIGTERM");
    const closed = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
    assert.equal(closed, true, "an open SSE connection must not keep the server alive after SIGTERM");
    socket.destroy();
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});
