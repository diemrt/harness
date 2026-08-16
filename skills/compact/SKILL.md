---
name: compact
description: Use when the user explicitly invokes harness compaction for completed tracked issues.
---

# Harness compact

1. Start from the base directory announced for this entry skill; resolve the plugin root as `<entry-base>/../..`. If the entry base is not announced, stop and ask for it; never guess or reuse an installed path.
2. Read `<plugin-root>/skills/harness/SKILL.md` completely.
3. Read `<plugin-root>/skills/harness/references/issues.md` completely, including the `--compact` contract.
4. Follow “Operazioni portabili per host senza slash command” in the main skill. Propose the compaction and obtain confirmation before calling the tracker primitive; preserve the worker-role restriction.
