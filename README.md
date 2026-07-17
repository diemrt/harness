<div align="center">

<h1><code>@diemrt/harness</code></h1>

**A controlled development harness for AI agents — an issue tracker, a stack-agnostic task
runner, and a set of agent operating rules — that you drop into any repo with one command
and keep in sync as the harness improves.**

[![npm](https://img.shields.io/npm/v/@diemrt/harness)](https://www.npmjs.com/package/@diemrt/harness)
[![CI](https://img.shields.io/github/actions/workflow/status/diemrt/harness/ci.yml?branch=main&label=CI)](https://github.com/diemrt/harness/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/@diemrt/harness)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@diemrt/harness)](LICENSE)
![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

[Quick start](#quick-start) · [How updates work](#the-update-model) · [What you get](#what-lands-in-your-project) · [Commands](#commands) · [Contributing](CONTRIBUTING.md)

</div>

---

## Why

You build a set of files that make AI agents behave in your repo — an issue tracker, a
task runner, a set of operating rules. Then you have a second repo. You copy the files in.
Then a third. Six months later every copy is subtly different, nobody remembers which one
is canonical, and improving the harness means merging the same change by hand five times.

`@diemrt/harness` turns that copy-paste into a managed install. `init` materializes the
harness into a project; `update` re-syncs it and tells you exactly what it changed, what
it left alone because it's yours, and what needs your hands.

## Quick start

```sh
# Materialize the harness into the current directory
npx @diemrt/harness init

# ...or into another directory
npx @diemrt/harness init path/to/project
```

Requires Node.js >= 18. **Nothing is installed into the target project** — no
`node_modules`, no added dependency. The scripts the harness drops in are plain ES modules
run with bare `node`:

```sh
node issue-manager.mjs ...      # create/list/update/close issues
node init.mjs setup             # run your project's "setup" steps
node init.mjs build             # run your project's "build" steps
```

`issues.html` is a standalone viewer: open it in a browser and it reads `issues.json` next
to it — no server, no build step.

## The update model

This is the core feature: `update` never silently clobbers your work, but it also never
lets your project's copy of the harness quietly rot.

Every file the harness distributes has exactly one **policy**, defined once in
[`src/policies.mjs`](src/policies.mjs):

| Policy | What `update` does | Files |
|---|---|---|
| **`managed`** | Keeps it in sync with the template — for as long as you haven't touched it | everything not listed below: `issue-manager.mjs`, `init.mjs`, `issues.html`, `docs/AGENTS-RULES.md`, `docs/EXTERNAL-WORKER.md`, `docs/GIT.md`, `docs/ISSUES.md`, `hooks/*`, `.gitignore` |
| **`seeded-once`** | Written once by `init`, then yours forever — never overwritten, even if the template changes | `AGENTS.md`, `docs/ARCHITECTURE.md`, `init.config.json` |
| **`data`** | Never overwritten once it exists | `issues.json` |

`managed` is the default: new files added to the template in future versions land in this
bucket automatically.

### How `update` decides what's safe to touch

For every `managed` file, `update` does a three-way comparison: the **new template's**
hash, the hash the **manifest** recorded the last time the harness wrote that file, and
the file's **current** hash on disk.

- **Disk still matches the manifest** → you never touched it. It's *pristine*, so `update`
  overwrites it in place and reports `updated`.
- **Disk has diverged from the manifest** → you edited it. `update` leaves your file
  alone, writes the incoming version alongside it as `<file>.new`, and reports a
  `conflict` — which is what drives exit code `2`.

So a real run, after you'd hand-edited `docs/GIT.md`, looks like this:

```console
$ npx @diemrt/harness update
  skipped   AGENTS.md
  skipped   init.config.json
  skipped   issue-manager.mjs
  ...
  conflicts docs/GIT.md -- your version differs from the harness template; see docs/GIT.md.new (the incoming version); resolve manually, then re-run with --force or delete the .new file
harness v0.5.0: update finished with 1 conflict(s); resolve them and re-run (exit code 2).

$ echo $?
2
```

Resolve it by hand: merge what you want from `docs/GIT.md.new` into `docs/GIT.md`, delete
the `.new` file, and re-run `update`.

`seeded-once` and `data` files are simpler: once they exist, `update` never touches them —
template changes or not, `--force` or not. Only `init --force` can overwrite them.

Files that a newer harness version has **dropped** from its template follow the same
principle: still pristine on disk → `update` deletes it (`removed`); edited by you →
`update` leaves it alone and reports it as `orphaned`, for you to decide.

> [!WARNING]
> `update --force` skips the pristine check entirely and overwrites every `managed` file
> in place, discarding local edits. `init --force` goes further and overwrites
> `seeded-once` and `data` files too — including `issues.json`. Use both deliberately.

## What lands in your project

```
AGENTS.md                   # project-owned operating notes (yours to edit)
docs/
  AGENTS-RULES.md           # invariant agent operating rules (harness-managed)
  ARCHITECTURE.md           # project-owned architecture doc (yours to edit)
  EXTERNAL-WORKER.md        # external worker handoff contract (harness-managed)
  GIT.md                    # git usage guidelines (harness-managed)
  ISSUES.md                 # guide to the issue tracker (harness-managed)
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

## Commands

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
  template, following the [per-file policy](#the-update-model) above. If no
  `.harness-manifest.json` is found, `update` behaves exactly like `init` (first-time
  materialization).
- **`--dry-run`** computes the full result — what would be added, updated, skipped,
  conflicted, removed, or orphaned — without writing anything to disk. Combine with
  `--json` for a CI-friendly drift check.
- **`--json`** prints the result as a single line of JSON instead of the human-readable
  summary.

Exit codes:

| Code | Meaning |
|------|---------|
| `0`  | Clean: no conflicts. |
| `2`  | Completed, but one or more files are in conflict and need manual resolution. |
| `1`  | Fatal error (bad arguments, unreadable template, etc.). |

## `init.config.json` is yours to fill in

The example commands `init.config.json` ships with (`npm install`, `npm test`, ...) are
placeholders. Fill in whatever setup/build commands make sense for your stack — Node,
Python, Go, .NET, or anything else. `init.mjs` just runs the `command` string for each step
through a shell (`spawnSync(..., { shell: true })`); making sure those commands are
portable across the shells your team and CI actually use is on you.

## Contributing

This repository develops itself by dogfooding its own harness: `template/` is the single
source of truth for everything distributed, and the repository root holds a materialized
copy kept in sync with `npm run dev:sync`.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the development loop and the release
process, and [CLAUDE.md](CLAUDE.md) for the full set of rules.

## License

MIT © [diemrt](https://github.com/diemrt)
