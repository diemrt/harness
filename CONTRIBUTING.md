# Contributing to `@diemrt/harness`

This document covers the development loop and the release process for the **package
itself**. If you're looking to *use* the harness in your own project, see
[README.md](README.md).

Before changing anything, read [CLAUDE.md](CLAUDE.md) — it holds the hard rules of this
repository. The two that bite hardest:

- **Never edit the materialized copies of managed files at the repository root**
  (`issue-manager.mjs`, `init.mjs`, `issues.html`, `docs/AGENTS-RULES.md`, `docs/GIT.md`,
  `docs/ISSUES.md`, ...). Edits there are lost — or reported as conflicts — on the next
  `dev:sync`. Edit `template/` instead.
- **Never run `init` or `update` with `--force` at the repository root.** `issues.json` at
  the root holds the real issues tracking this project; `--force` would overwrite them with
  the empty template seed.

## Development loop

This repository develops itself by dogfooding its own harness. `template/` is the single
source of truth for everything distributed to consumers; the repository root holds a
materialized copy kept in sync with `npm run dev:sync`.

- Edit files under `template/`, never their materialized copies at the repository root.
- Run `npm run dev:sync` (`node src/cli.mjs update .`) to propagate the change to the root.
- `npm run dev:check` (`node src/cli.mjs update . --dry-run --json`) must report zero
  `updated`/`conflicts` before you commit; CI enforces the same check.
- `npm test` runs the `node:test` suite (`node --test`).

A note on `seeded-once` files: `AGENTS.md`, `docs/ARCHITECTURE.md` and `init.config.json`
exist both at the root and inside `template/`, but they are **separate files with separate
content** — the root ones belong to this repository, the `template/` ones are the generic
skeletons shipped to users. Changing one does not imply changing the other. Same story for
`issues.json`: the root one is this project's real data, `template/issues.json` is the
empty seed.

## Releasing a new version

The recurring release loop: prove it green locally, cut a tag, verify what shipped.

### 1. Before releasing — local green + real-artifact smoke test

```sh
npm test && npm run dev:check          # both clean (dev:check is what CI runs)
npm pack                               # builds the exact tarball npm would publish
```

Then, in an empty directory *outside* the repo, install from that tarball and exercise it —
this is the truest test because it respects the `files` field (unlike `npm link`):

```sh
npx --yes --package="<path-to-.tgz>" harness init
node issue-manager.mjs --help          # scripts run without npm install
node init.mjs setup
npx --yes --package="<path-to-.tgz>" harness update   # pristine dir: exit 0
# dirty a managed file, re-run update: expect <file>.new + exit code 2
```

Delete the `.tgz` afterwards — never commit it. Windows gotcha: with a *local* tarball
`--package` is mandatory (`npx <path>.tgz init` fails, the `.tgz` opens in an app); from
the public registry `npx @diemrt/harness init` just works.

### 2. Cut the release — version and tag must match

`publish.yml` ships the version in `package.json`, but only fires on a `v*` tag; a mismatch
publishes the wrong version.

```sh
# first release (package.json already at the target version):
git tag v0.1.0 && git push origin v0.1.0

# later releases — npm version bumps + commits + tags coherently:
npm version patch|minor|major
git push && git push --tags
```

`ci.yml` runs on every push/PR (`npm ci` → `npm test` → `dev:check`); `publish.yml` runs
only on a `v*` tag (`npm test` → `npm publish --provenance --access public`). A plain push
never publishes — tagging is the explicit, separate act. (One-time prerequisites — a public
GitHub repo and the `NPM_TOKEN` secret — are assumed already in place.)

### 3. Verify after publish

```sh
# GitHub → Actions → "Publish" workflow is green, then:
npm view @diemrt/harness version       # prints the version you just tagged
npx @diemrt/harness@latest init        # smoke-test from the registry in an empty dir
```

Use `@latest` (or a pinned `@0.1.0`) to defeat npx's cache, then repeat the step-1 sanity
checks against the published version.
