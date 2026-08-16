<div align="center">

<h1><code>harness</code></h1>

**A controlled development harness for AI agents — an issue tracker, independent verification,
and a set of agent operating rules — installed as a Claude Code plugin, leaving nothing in your
project but `issues.json`.**

[![CI](https://img.shields.io/github/actions/workflow/status/diemrt/harness/ci.yml?branch=main&label=CI)](https://github.com/diemrt/harness/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/diemrt/harness)](LICENSE)
![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

[Install](#install) · [What it does](#what-it-does) · [What it leaves behind](#what-it-leaves-in-your-project) · [Slash commands](#slash-commands) · [Contributing](CONTRIBUTING.md)

</div>

---

> [!NOTE]
> **Arriving from the `@diemrt/harness` npm package?** That package is deprecated. Harness is
> a Claude Code plugin now: nothing to install from npm, nothing copied into your repository,
> nothing to keep in sync afterwards. See [Install](#install).

## Why

An agent left to its own devices decides what "done" means and then agrees with itself.
Harness takes both halves of that away: every piece of work is a tracked issue, every issue is
verified by an agent **other** than the one that did it, and nothing reaches the shared branch
before that verification passes.

Earlier versions shipped those rules as files copied into each repository, then as an npm
package that kept the copies in sync. The plugin removes the copies entirely — rules and
scripts live in the plugin, your project keeps only its own data.

## Install

In Claude Code:

```text
/plugin marketplace add diemrt/harness
/plugin install harness@diemrt
```

Requires Node.js >= 18. The plugin's scripts are plain ES modules run with bare `node` and
have zero runtime dependencies; **nothing is installed into your project** — no
`node_modules`, no added dependency.

Then, in any project, ask Claude to *clock in*. The first time, harness inspects the project,
proposes a setup command and a verification command, and asks you to confirm them before
writing anything.

### Codex CLI and other agent hosts

The repository also ships a Codex manifest. When harness is installed as a Codex plugin, the `$`
menu exposes explicit entry points while the main `$harness:harness` skill remains available:

| Codex skill | Operation |
|---|---|
| `$harness:status` | Clock in or print the tracker summary |
| `$harness:issue` | List, create, inspect, or update issues |
| `$harness:verify` | Dispatch independent verification |
| `$harness:compact` | Propose and run issue compaction |
| `$harness:docs-gate` | Check documentation coverage |
| `$harness:sweep` | Find important documented work that is not tracked |

These entry skills share the root `skills/` directory, following the same cross-host layout as
Superpowers. They route into the same authoritative
[`skills/harness/SKILL.md`](skills/harness/SKILL.md) and references used by Claude Code rather
than copying the workflow. Claude's `/harness:*` commands remain under `commands/` and are not
changed by the Codex manifest.

After installing or updating the Codex plugin, start a **new thread** before checking the `$`
menu. Plugin skills are loaded at thread startup, so the current thread keeps the previous
catalog.

An agent host without either integration can still read the portable operation index in the main
skill and invoke the plain Node.js scripts directly.

## What it does

- **Clock in** — reads the project's configuration, prepares the environment, and prints one
  screen of tracker status: what is in flight, and what can be taken now.
- **One issue in progress per dependency chain**, each worked by a dedicated subagent
  (internal, or an external CLI if you opt in).
- **Independent verification** — the worker leaves the issue in review; a separate
  `harness-verifier` agent runs the project's verification command against the real artifacts
  and is the only one allowed to close the issue.
- **Publication gate** — a local commit on a work branch is a foothold, not a publication. It
  is the push, or the merge, that the pass authorises.

The workflow itself is the plugin's `harness` skill, which Claude loads on its own when a
project has an `issues.json`. [`skills/harness/SKILL.md`](skills/harness/SKILL.md) and its
`references/` are the authoritative description; this README does not restate them.

## What it leaves in your project

| Path | What it is |
|---|---|
| `issues.json` | the tracker's data, at the project root |
| `.harness/` | configuration, the archives `/harness:compact` writes, and worker logs |

Nothing else: no scripts, no documents, no HTML viewer to keep in sync.

**What of that gets versioned is your call.** Harness writes no `.gitignore` — not yours,
which it never touches, and none of its own inside `.harness/`. The directory turns up as
untracked and you decide: commit `config.json` so the team shares one verification gate, or
keep it per clone; commit `.harness/archive/` so the blocks in `issues.json` still point at
something after a fresh clone, or accept that they will not. A tool that ignores files on your
behalf has taken that decision away from you, in a file you never asked for.

## Slash commands

The repetitive actions also have explicit commands. They are shortcuts, not a second
source of truth: the workflow lives in the `harness` skill, and each command points back at it.

| Command | What it does | Without arguments |
|---|---|---|
| `/harness:compact` | Proposes themed blocks to compact `done` issues, waits for confirmation, then archives them | Proposes blocks over every `done` issue in the tracker |
| `/harness:docs-gate` | Lists the commits that touched code without any issue declaring them in `covers` | Uses the window autocalibrated on the current project |
| `/harness:issue` | Lists issues by status, creates one, updates one | Shows the tracker: `in_progress`, `in_review`, `backlog` |
| `/harness:status` | Prints one screen of tracker status: counts, what is in flight, what can be taken now | Reads the current project |
| `/harness:sweep` | Sweeps the project's documents for what they found and never tracked, and proposes the issues worth opening | Proposes the corpus to read and asks you to confirm it |
| `/harness:verify` | Hands a finished issue to the independent `harness-verifier` agent | Picks among the issues sitting in `in_review` |

`/harness:verify` never verifies inline: it always delegates to the `harness-verifier`
subagent, so the agent that did the work is never the one that closes the issue. Closing an
issue (`done` / `pass`) is the verifier's job alone — `/harness:issue` will not do it.

## Contributing

This repository is the plugin, and it develops itself with it: the issues in `issues.json`
here are harness's own. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the development loop
and the release process, and [CLAUDE.md](CLAUDE.md) for the rules of this repository.

## License

MIT © [diemrt](https://github.com/diemrt)
