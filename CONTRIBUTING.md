# Contributing to harness

This document covers the development loop and the release process for the **plugin itself**.
To *use* harness in your own project, see [README.md](README.md); the hard rules of this
repository are in [CLAUDE.md](CLAUDE.md).

## Repository layout

| Path | What it holds |
|---|---|
| `.claude-plugin/plugin.json` | the plugin manifest |
| `.claude-plugin/marketplace.json` | the marketplace entry — this repo is its own single-plugin marketplace |
| `skills/harness/` | `SKILL.md` and `references/`: the workflow, and the authoritative description of it |
| `skills/<operation>/` | one entry point per operation: `/harness:<operation>` in Claude Code, `$<operation>` in Codex |
| `agents/harness-verifier.md` | the independent verifier subagent |
| `scripts/` | the executables: issue tracker CLI, status CLI, configuration CLI, external worker runner, installation check |
| `test/` | the `node --test` suite |
| `proposals/` | written and set aside; not part of the plugin |

Every file is authored once, in place. There is no template directory and no generated copy
of anything: what you edit is what ships.

## Development loop

1. Edit the plugin files.
2. `npm test` (`node --test`). Beyond the behavioural tests of the scripts, the suite checks
   the plugin's structure: skill frontmatter and reference links, the script paths each operation
   invokes, the verifier agent, that no operation is defined twice, and that the operation names
   documented in the README are exactly the ones shipped. A renamed file or a dangling link fails
   here instead of failing silently at runtime, where a broken operation simply never triggers.
3. Exercise the change in this repository, which runs on harness itself. Committing a new
   skill or agent is not proof it works — invoke it in a real session here.

**A session opened here does not load this working tree.** It loads the installed copy, even
though the cwd *is* the plugin root: measured on 2026-08-14, right after the marketplace was
re-registered as a remote, the harness skill announced its base directory as
`~/.claude/plugins/cache/diemrt/harness/0.6.0/skills/harness`. The registered source wins over
the current directory. Since `$SCRIPTS` is derived from that base directory, the workflow reaches
the released scripts too.

So step 3 costs a round of publication: merge, push, `/plugin marketplace update diemrt`, restart
the session. A restart alone only picks up what has already landed. Two things are unaffected and
are where most of the loop should stay — `npm test`, which runs on this repository, and any script
you invoke by path (`node scripts/…`), which is the copy you just edited. That is also exactly why
the suite is blind to the installed copy, and why the check below exists.

`ci.yml` runs on every push and pull request: `npm ci`, `npm test`, then a read of this
repository's own tracker through the shipped CLI. `.harness/config.json` declares `npm run
test` as the verification command, so that is the gate every issue must pass before it is published.

## Releasing

Three manifests carry the version and must agree: `.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json` and `.codex-plugin/plugin.json`. They are the only version
numbers in the repository — `package.json` deliberately has none, since nothing is published
from it. Consumers install from git, so the release is the tag.

```sh
# set the same version in all three files, commit, then:
git tag v1.0.0 && git push && git push --tags
```

### Check what is actually installed

**A release is not done until you have looked at the copy a consumer loads.** Neither `npm test`
nor the tracker can see it: the suite runs on this repository, never on the installed plugin.

```sh
node scripts/install-check.mjs
```

Exit 0 means the registered source is remote and the installed copy carries the same components
as this repository. Anything else prints one line of JSON naming what is wrong
([references/install-check.md](skills/harness/references/install-check.md) has the codes).

Two failures are worth knowing before you meet them:

- **`LOCAL_SOURCE`** — the marketplace is registered as a local `directory` instead of a remote.
  Consumers then load this working tree live: not a tag, not a commit, not even a clean tree.
  It is convenient while developing and it is not a release; if you keep it deliberately, know
  that every project on the machine runs your uncommitted work.
- **`DIVERGENT_INSTALL`** — the installed copy has a different shape from this repository.

**Updates follow the commit, not the version number.** A plugin fetched from a remote is
re-materialized when its sha changes; the version is the cache directory's name and the only
label a human can read. Bumping it is therefore not what ships the change — but leaving it still
means nobody can answer "which harness is this", which is how one copy stayed frozen for 159
commits while claiming to be the current one. Bump it, and check the copy afterwards.

Between 2026-07-29 and 2026-08-13 exactly that happened, and the report is in
[docs/superpowers/analisi/2026-08-13-plugin-pubblicato-divergente.md](docs/superpowers/analisi/2026-08-13-plugin-pubblicato-divergente.md).

**Tagging publishes nothing.** `ci.yml` is the only workflow, and all it does is `npm ci`,
`npm test` and a read of the tracker. Its `on: push:` has no ref filter, so pushing a tag *does*
run it — it just has nothing to publish with. The npm workflow that used to publish
`@diemrt/harness` on every `v*` tag was removed with the rest of the pre-plugin distribution
model, and `package.json` is `private` so `npm publish` refuses even if run by hand.
