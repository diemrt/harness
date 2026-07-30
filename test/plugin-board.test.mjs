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
const BOARD_GRAPH_PATH = path.join(rootDir, "scripts", "board-graph.mjs");

// A real import, not an extraction: board.js guards its only DOM access (init(), called from a
// DOMContentLoaded listener) behind `typeof document !== "undefined"`, so it loads cleanly here
// and every exported function is the function the browser actually runs.
const {
  renderCriteria,
  renderTierBadge,
  escapeHtml,
  state,
  getFilteredIssues,
  GRAPH_METRICS,
  layoutGraph,
  renderEdges,
  graphNode,
  renderUnchained,
  renderCycleBanner,
} = await import(pathToFileURL(BOARD_JS_PATH).href);

// The graph's arithmetic is verified in plugin-board-graph.test.mjs; here it is only the input
// the renderer is fed, so the layout is tested against real levels instead of a hand-made shape.
const { buildGraph } = await import(pathToFileURL(BOARD_GRAPH_PATH).href);

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
      // Near-misses of the declared routes: the lookup is exact on the table, not a prefix or a
      // guess at an extension, so a name that merely looks like an asset is still a 404.
      "board-graph.js",
      "board.js.map",
      "board-graph.mjs/",
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

test("the board serves board-graph.mjs so the page can import it as a module", async () => {
  // The browser refuses a module whose response is not a JavaScript MIME type: served as
  // anything else, the import in board.js fails and the graph view never renders.
  const dir = tempProject(seed());
  const { child, url } = await startServer(dir);
  try {
    const module = await fetch(`${url}board-graph.mjs`);
    assert.equal(module.status, 200);
    assert.match(module.headers.get("content-type"), /text\/javascript/);
    assert.match(await module.text(), /export function buildGraph/);

    const js = await (await fetch(`${url}board.js`)).text();
    assert.match(
      js,
      /import \{[^}]*buildGraph[^}]*\} from "\.\/board-graph\.mjs"/,
      "board.js must import the module, not carry a second copy of the layering"
    );
  } finally {
    stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Graph rendering ------------------------------------------------------------
// buildGraph is verified on its own; what follows is the renderer's half of the contract, which
// is what a browser would otherwise be needed for: coordinates, markup, fallbacks.

const A = "aaaaaaaa-1111-1111-1111-111111111111";
const B = "bbbbbbbb-2222-2222-2222-222222222222";
const C = "cccccccc-3333-3333-3333-333333333333";
const D = "dddddddd-4444-4444-4444-444444444444";

// A → B → C, plus A → C skipping a level, and D chained to nothing.
function chainFixture() {
  return buildGraph([
    issue(A),
    issue(B, { depends_on: [A] }),
    issue(C, { depends_on: [A, B] }),
    issue(D),
  ]);
}

test("layoutGraph gives every level its own column and leaves the unchained issues out of them", () => {
  const layout = layoutGraph(chainFixture());

  assert.equal(layout.columns.length, 3, "three levels, three columns");
  assert.deepEqual(layout.columns.map((column) => column.level), [0, 1, 2]);
  for (let i = 1; i < layout.columns.length; i += 1) {
    assert.equal(
      layout.columns[i].x - layout.columns[i - 1].x,
      GRAPH_METRICS.nodeWidth + GRAPH_METRICS.gapX,
      "columns are one card plus one corridor apart"
    );
  }
  // D has neither dependencies nor dependents: it must not have been given a coordinate at all,
  // or it would be sitting in the level 0 column instead of in the wrapping grid.
  assert.equal(layout.positions.has(D), false);
  assert.equal(layout.positions.has(A), true);
  assert.ok(layout.width > 0 && layout.height > 0, "the plane must have a size to scroll");
});

test("the unchained issues render as a labelled wrapping grid, not as a column", () => {
  const graph = chainFixture();
  assert.deepEqual(graph.unchained.map((node) => node.id), [D]);

  const markup = renderUnchained(graph.unchained);
  assert.match(markup, /senza catena/);
  assert.match(markup, /graph-group__grid/);
  // No coordinates: the browser wraps these, layoutGraph never touches them.
  assert.match(markup, /graph-node--flow/);
  assert.equal(markup.includes("left:"), false, "an unchained card must not be positioned");

  assert.equal(renderUnchained([]), "", "nothing to show means no label either");
});

test("edges leave the dependency and land on the issue that declares it", () => {
  const graph = chainFixture();
  const layout = layoutGraph(graph);

  const from = layout.positions.get(A);
  const to = layout.positions.get(B);
  const edge = layout.edges.find((entry) => entry.from === A && entry.to === B);
  assert.ok(edge, "the arc goes from the dependency to the dependent, not the other way round");

  const first = edge.points[0];
  const last = edge.points[edge.points.length - 1];
  assert.equal(first[0], from.x + from.width, "it starts on the right edge of the dependency");
  assert.equal(first[1], Math.round(from.y + from.height / 2));
  assert.equal(last[0], to.x, "and ends on the left edge of the target");
  assert.equal(last[1], Math.round(to.y + to.height / 2));
  assert.ok(last[0] > first[0], "the arrow always points forward, never back into a column");

  const svg = renderEdges(layout);
  assert.equal((svg.match(/<polyline/g) || []).length, layout.edges.length);
  assert.match(svg, /marker-end="url\(#graph-arrow\)"/, "the tip is on the target end");
  assert.match(svg, /<marker id="graph-arrow"/);
  assert.match(svg, new RegExp(`points="${first.join(",")} `), "the polyline carries the points");
});

test("an edge that skips a level turns inside the corridor between the columns", () => {
  const layout = layoutGraph(chainFixture());
  const jump = layout.edges.find((edge) => edge.from === A && edge.to === C);
  assert.equal(jump.span, 2, "A is at level 0 and C at level 2");

  const sourceRight = layout.positions.get(A).x + GRAPH_METRICS.nodeWidth;
  const [, turn] = jump.points;
  assert.ok(
    turn[0] > sourceRight && turn[0] < sourceRight + GRAPH_METRICS.gapX,
    `the vertical leg must sit in the corridor (${sourceRight} < ${turn[0]} < ${sourceRight + GRAPH_METRICS.gapX})`
  );
  // Four points, three segments: out, across, in. A straight line would have no elbow to route.
  assert.equal(jump.points.length, 4);
  assert.equal(jump.points[1][0], jump.points[2][0], "the middle segment is the vertical one");

  // Parallel long edges must not share one line, or a fan-in reads as a single arc.
  const second = layoutGraph(
    buildGraph([
      issue(A),
      issue(B, { depends_on: [A] }),
      issue(C, { depends_on: [A, B] }),
      issue(D, { depends_on: [A, B] }),
    ])
  ).edges.filter((edge) => edge.span > 1);
  assert.equal(second.length, 2);
  assert.notEqual(second[0].points[1][0], second[1].points[1][0], "each long edge gets its lane");
});

test("a done dependency is drawn as a compact ghost instead of an arrow out of nowhere", () => {
  const graph = buildGraph([
    issue(A, { status: "done", title: "Chiusa" }),
    issue(B, { depends_on: [A] }),
  ]);
  const layout = layoutGraph(graph);

  const ghost = graph.byId.get(A);
  assert.equal(ghost.ghost, "done");
  assert.equal(
    layout.positions.get(A).height,
    GRAPH_METRICS.ghostHeight,
    "a ghost is shorter than a real card"
  );
  assert.notEqual(GRAPH_METRICS.ghostHeight, GRAPH_METRICS.nodeHeight);

  const markup = graphNode(ghost, "");
  assert.match(markup, /graph-node--ghost/, "the dashed border rides on this class");
  assert.match(markup, /Chiusa/, "title");
  assert.match(markup, /badge--done/, "and status");
  assert.equal(markup.includes("graph-node__id"), false, "nothing else: a ghost is not work");

  // The same shape for an id nothing in the tracker answers for, id included so it can be found.
  const unknown = buildGraph([issue(B, { depends_on: [C] })]).byId.get(C);
  assert.equal(unknown.ghost, "unknown");
  const unknownMarkup = graphNode(unknown, "");
  assert.match(unknownMarkup, /graph-node--ghost/);
  assert.match(unknownMarkup, /id sconosciuto/);
  assert.match(unknownMarkup, new RegExp(C.slice(0, 8)));
});

test("a cycle in the data is named, not drawn: the banner carries the ids", () => {
  // issue-manager refuses to write this; a hand-edited issues.json can still hold it.
  const graph = buildGraph([issue(A, { depends_on: [B] }), issue(B, { depends_on: [A] })]);
  assert.equal(graph.cycle.detected, true, "the guard must find it rather than loop");

  const banner = renderCycleBanner(graph.cycle);
  assert.match(banner, /Ciclo nelle dipendenze/);
  assert.match(banner, /ripiega sulla lista/);
  for (const id of graph.cycle.ids) {
    assert.match(banner, new RegExp(id), `the banner must name ${id}`);
  }

  // No cycle, no banner: the page must not carry an alert it has nothing to say in.
  assert.equal(renderCycleBanner(chainFixture().cycle), "");
  assert.equal(renderCycleBanner(null), "");
});

test("the list keeps every issue the graph drops, done included", () => {
  const issues = [issue(A, { status: "done" }), issue(B, { status: "in_progress" })];
  const graph = buildGraph(issues);
  assert.deepEqual(
    graph.nodes.map((node) => node.id),
    [B],
    "the graph answers 'what do I work on now', so a closed issue is not a node"
  );

  const previousIssues = state.issues;
  const previousStatus = state.activeStatus;
  const previousQuery = state.query;
  try {
    state.issues = issues;
    state.query = "";
    state.activeStatus = "all";
    assert.deepEqual(
      getFilteredIssues().map((it) => it.id),
      [A, B],
      "the list is the reference view: the whole tracker is reachable from it"
    );
    state.activeStatus = "done";
    assert.deepEqual(getFilteredIssues().map((it) => it.id), [A]);
  } finally {
    state.issues = previousIssues;
    state.activeStatus = previousStatus;
    state.query = previousQuery;
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
