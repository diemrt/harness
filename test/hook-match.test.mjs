import test from "node:test";
import assert from "node:assert/strict";
import { globToRegExp, matchesAny } from "../template/hooks/match.mjs";

test("globToRegExp: **/*.mjs matches top-level and nested paths", () => {
  const re = globToRegExp("**/*.mjs");
  assert.equal(re.test("a.mjs"), true);
  assert.equal(re.test("src/b/c.mjs"), true);
});

test("globToRegExp: docs/** matches only under docs/", () => {
  const re = globToRegExp("docs/**");
  assert.equal(re.test("docs/x.md"), true);
  assert.equal(re.test("docs/a/b.md"), true);
  assert.equal(re.test("docsx/y.md"), false);
});

test("globToRegExp: *.md does not cross directory separators", () => {
  const re = globToRegExp("*.md");
  assert.equal(re.test("README.md"), true);
  assert.equal(re.test("docs/README.md"), false);
});

test("globToRegExp: literal pattern issues.json is exact", () => {
  const re = globToRegExp("issues.json");
  assert.equal(re.test("issues.json"), true);
  assert.equal(re.test("my-issues.json"), false);
  assert.equal(re.test("issues.json.bak"), false);
});

test("globToRegExp: dot and plus are treated as literals", () => {
  const re = globToRegExp("a+b.c");
  assert.equal(re.test("a+b.c"), true);
  assert.equal(re.test("abbbc"), false);
  assert.equal(re.test("aaabxc"), false);
});

test("matchesAny: returns false for empty and undefined patterns", () => {
  assert.equal(matchesAny("README.md", []), false);
  assert.equal(matchesAny("README.md", undefined), false);
});
