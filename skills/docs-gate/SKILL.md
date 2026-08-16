---
name: docs-gate
description: Use when the user explicitly invokes the harness documentation gate or asks which code commits lack tracked documentation coverage.
---

# Harness docs gate

1. Start from the base directory announced for this entry skill; resolve the plugin root as `<entry-base>/../..`. If the entry base is not announced, stop and ask for it; never guess or reuse an installed path.
2. Read `<plugin-root>/skills/harness/SKILL.md` completely.
3. Read `<plugin-root>/skills/harness/references/docs-gate.md` completely.
4. Follow “Operazioni portabili per host senza slash command” in the main skill and run the documentation-gate script through the shell. Report findings without treating uncovered commits as a command failure.
