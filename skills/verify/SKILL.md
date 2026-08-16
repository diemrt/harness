---
name: verify
description: Use when the user explicitly invokes independent verification for a harness issue that is ready for review.
---

# Harness verify

1. Start from the base directory announced for this entry skill; resolve the plugin root as `<entry-base>/../..`. If the entry base is not announced, stop and ask for it; never guess or reuse an installed path.
2. Read `<plugin-root>/skills/harness/SKILL.md` completely.
3. Read `<plugin-root>/skills/harness/references/verification.md` completely.
4. Follow “Operazioni portabili per host senza slash command” in the main skill. Always dispatch a distinct verifier; never verify inline.
