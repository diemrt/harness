<div align="center">

<h1><code>harness</code></h1>

**A controlled development harness for AI agents — an issue tracker, a live issue board, and
a set of agent operating rules — installed as a Claude Code plugin, leaving nothing in your
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
verified by an agent **other** than the one that did it, and nothing is committed before that
verification passes.

Earlier versions shipped those rules as files copied into each repository, then as an npm
package that kept the copies in sync. The plugin removes the copies entirely — rules, scripts
and board live in the plugin, your project keeps only its own data.

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

## What it does

- **Clock in** — reads the project's configuration, prepares the environment, starts the live
  issue board, and shows what is in flight.
- **One issue in progress per dependency chain**, each worked by a dedicated subagent
  (internal, or an external CLI if you opt in).
- **Independent verification** — the worker leaves the issue in review; a separate
  `harness-verifier` agent runs the project's verification command against the real artifacts
  and is the only one allowed to close the issue.
- **Commit gate** — one issue per commit, only after that verification passes.

The workflow itself is the plugin's `harness` skill, which Claude loads on its own when a
project has an `issues.json`. [`skills/harness/SKILL.md`](skills/harness/SKILL.md) and its
`references/` are the authoritative description; this README does not restate them.

## What it leaves in your project

| Path | What it is |
|---|---|
| `issues.json` | the tracker's data, at the project root — the only file harness adds to git |
| `.harness/` | per-clone configuration and worker logs; ships its own `.gitignore` with `*`, so it never reaches git and never touches yours |

Nothing else: no scripts, no documents, no HTML viewer to keep in sync. A teammate who does
not use harness sees one JSON file.

## Slash commands

The three repetitive actions also have explicit commands. They are shortcuts, not a second
source of truth: the workflow lives in the `harness` skill, and each command points back at it.

| Command | What it does | Without arguments |
|---|---|---|
| `/harness:board` | Starts the live issue board and prints its URL once; `stop` shuts it down | Starts the board for the current project |
| `/harness:issue` | Lists issues by status, creates one, updates one | Shows the tracker: `in_progress`, `in_review`, `backlog` |
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
