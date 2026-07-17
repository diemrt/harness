# @diemrt/harness

A controlled AI-agent development harness — an issue tracker, a stack-agnostic task
runner, and a set of agent operating rules — that you drop into any project with one
command, and keep in sync as the harness improves. Instead of copying these files by
hand into every repository and watching each copy quietly drift, you install
`@diemrt/harness` once and run `update` whenever the harness itself gets better; the
tool tells you exactly what changed, what it's safe to overwrite, and what you need to
merge by hand.

## Quick start

```sh
# Materialize the harness into the current directory
npx @diemrt/harness init

# Materialize it into another directory
npx @diemrt/harness init path/to/project
```

Requires Node.js >= 18. Nothing is installed into the target project: no
`node_modules`, no added dependency. The scripts the harness drops into your project
are plain ES modules run with bare `node` (`node issue-manager.mjs ...`,
`node init.mjs setup|build`).

## What lands in your project

Running `init` copies these files into the target directory:

```
AGENTS.md                  # project-owned operating notes (yours to edit)
docs/
  AGENTS-RULES.md           # invariant agent operating rules (harness-managed)
  ARCHITECTURE.md           # project-owned architecture doc (yours to edit)
  EXTERNAL-WORKER.md        # external worker handoff contract (harness-managed)
  GIT.md                     # git usage guidelines (harness-managed)
  ISSUES.md                  # guide to the issue tracker (harness-managed)
hooks/
  install.mjs               # git hook installer (harness-managed)
  pre-commit                # git pre-commit entrypoint (harness-managed)
  pre-commit.mjs            # worker-role commit guard (harness-managed)
  post-commit               # git post-commit entrypoint (harness-managed)
  post-commit.mjs           # docs-issue post-commit automation (harness-managed)
  match.mjs                 # glob matcher for docsGate include/exclude (harness-managed)
issue-manager.mjs           # issue tracker CLI (harness-managed)
init.mjs                    # stack-agnostic setup/build runner (harness-managed)
init.config.json            # your setup/build commands (project-owned)
issues.html                 # standalone HTML viewer for issues.json (harness-managed)
issues.json                 # your project's issues (never overwritten)
.gitignore                  # root ignore rules (harness-managed)
```

Plus a hidden `.harness-manifest.json` at the root of the target directory: bookkeeping
for `update`, not something you edit by hand.

The two workhorse scripts are run directly with Node, no npm install required:

```sh
node issue-manager.mjs ...      # create/list/update/close issues
node init.mjs setup             # run your project's "setup" steps
node init.mjs build              # run your project's "build" steps
```

`issues.html` is a standalone viewer: open it in a browser and it reads `issues.json`
next to it — no server, no build step.

## Commands reference

```
harness init [targetDir]      Copy the harness template into targetDir
harness update [targetDir]    Sync targetDir with the current template

targetDir defaults to "." when omitted.

Options:
  --force        Overwrite files even if they were modified
  --dry-run      Compute the result without writing anything to disk
  --json         Print the result as a single line of JSON
  -h, --help     Show this help message
  -v, --version  Print the harness version
```

- **`init`** writes every template file that doesn't already exist at the destination.
  Existing files are left alone (reported as `skipped`) unless `--force` is passed, in
  which case they're overwritten (`updated`).
- **`update`** re-syncs an already-initialized directory against the harness's current
  template, following the per-file policy described below. If no
  `.harness-manifest.json` is found, `update` behaves exactly like `init` (first-time
  materialization).
- **`--dry-run`** computes the full result — what would be added, updated, skipped,
  conflicted, removed, or orphaned — without writing anything to disk. Combine with
  `--json` for a CI-friendly drift check.
- **`--json`** prints the result as a single line of JSON instead of the human-readable
  summary.
- **`targetDir`** is the only positional argument; it defaults to `.`.

Exit codes:

| Code | Meaning |
|------|---------|
| `0`  | Clean: no conflicts. |
| `2`  | Completed, but one or more files are in conflict and need manual resolution. |
| `1`  | Fatal error (bad arguments, unreadable template, etc.). |

## The update model

This is the core feature: `update` never silently clobbers your work, but it also
never lets your project's copy of the harness quietly rot.

Every file the harness distributes has exactly one **policy**, defined once in
`src/policies.mjs`:

- **`managed`** — the default. The harness keeps these files in sync with its
  template for as long as you haven't touched them: `issue-manager.mjs`, `init.mjs`,
  `issues.html`, `docs/AGENTS-RULES.md`, `docs/EXTERNAL-WORKER.md`, `docs/GIT.md`,
  `docs/ISSUES.md`, `hooks/install.mjs`, `hooks/pre-commit`,
  `hooks/pre-commit.mjs`, `hooks/post-commit`, `hooks/post-commit.mjs`,
  `hooks/match.mjs`, `.gitignore`.
- **`seeded-once`** — written once by `init`, then yours forever. `update` never
  overwrites these even if the template's version has changed, because you're expected
  to customize them for your project: `AGENTS.md`, `docs/ARCHITECTURE.md`,
  `init.config.json`.
- **`data`** — user-owned data, never overwritten once it exists: `issues.json`.

### How `update` decides what's safe to touch

For every `managed` file, `update` performs a three-way comparison: the new template's
hash, the hash the manifest recorded the last time the harness wrote that file, and the
file's current hash on disk.

- If the file on disk still matches what the manifest last recorded, it's **pristine**
  — you (or an agent) never touched it — so `update` overwrites it in place and reports
  it as `updated`.
- If the file on disk has diverged from what the manifest recorded, you edited it.
  `update` leaves it untouched and instead writes the new template version alongside
  it as `<file>.new`, reporting it as a `conflict` (this is what drives the exit code
  `2`). Resolve it by hand — merge whatever you need from `<file>.new` into your file,
  then delete the `.new` file — and re-run `update` (or use `--force`, see below).
- `--force` skips the pristine check entirely and overwrites every `managed` file in
  place, discarding local edits. Use it deliberately.

`seeded-once` and `data` files are simpler: if they already exist, `update` never
touches them, template changes or not, `--force` or not (only `init --force` can
overwrite an existing `seeded-once`/`data` file).

`managed` files that a newer harness version has dropped from its template are handled
the same way on removal: if the file is still pristine on disk, `update` deletes it
(`removed`); if you had edited it, `update` leaves it as-is and reports it as
`orphaned` so you can decide what to do with it yourself.

## `init.config.json` is yours to fill in

The example commands `init.config.json` ships with (`npm install`, `npm test`, ...) are
placeholders. Fill in whatever setup/build commands make sense for your stack — Node,
Python, Go, .NET, or anything else. `init.mjs` just runs the `command` string for each
step through a shell (`spawnSync(..., { shell: true })`); making sure those commands
are portable across the shells your team and CI actually use is on you.

## Contributing / developing this package

This repository develops itself by dogfooding its own harness. `template/` is the
single source of truth for everything distributed to consumers; the repository root
holds a materialized copy kept in sync with `npm run dev:sync`. If you're working on
the harness itself, see `CLAUDE.md` for the full set of rules (what never to edit at
the root, how `seeded-once` files at the root relate to their `template/` counterparts,
etc.). In short:

- Edit files under `template/`, never their materialized copies at the repository root.
- Run `npm run dev:sync` (`node src/cli.mjs update .`) to propagate the change to the
  root.
- `npm run dev:check` (`node src/cli.mjs update . --dry-run --json`) must report zero
  `updated`/`conflicts` before you commit; CI enforces the same check.
- `npm test` runs the `node:test` suite (`node --test`).

### Releasing a new version

The recurring release loop: prove it green locally, cut a tag, verify what shipped.

**1. Before releasing — local green + real-artifact smoke test.**

```sh
npm test && npm run dev:check          # both clean (dev:check is what CI runs)
npm pack                               # builds the exact tarball npm would publish
```

Then, in an empty directory *outside* the repo, install from that tarball and exercise
it — this is the truest test because it respects the `files` field (unlike `npm link`):

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

**2. Cut the release — version and tag must match.** `publish.yml` ships the version in
`package.json`, but only fires on a `v*` tag; a mismatch publishes the wrong version.

```sh
# first release (package.json already at the target version):
git tag v0.1.0 && git push origin v0.1.0

# later releases — npm version bumps + commits + tags coherently:
npm version patch|minor|major
git push && git push --tags
```

`ci.yml` runs on every push/PR (`npm ci` → `npm test` → `dev:check`); `publish.yml` runs
only on a `v*` tag (`npm test` → `npm publish --provenance --access public`). A plain push
never publishes — tagging is the explicit, separate act. (One-time prerequisites — a
public GitHub repo and the `NPM_TOKEN` secret — are assumed already in place.)

**3. Verify after publish.**

```sh
# GitHub → Actions → "Publish" workflow is green, then:
npm view @diemrt/harness version       # prints the version you just tagged
npx @diemrt/harness@latest init        # smoke-test from the registry in an empty dir
```

Use `@latest` (or a pinned `@0.1.0`) to defeat npx's cache, then repeat the step-1 sanity
checks against the published version.

## License

MIT
