---
name: status
description: Use when the user explicitly invokes the harness status operation, asks to clock in, or wants the current tracker summary.
---

# Harness status

1. Start from the base directory announced for this entry skill; resolve the plugin root as `<entry-base>/../..`. If the entry base is not announced, stop and ask for it; never guess or reuse an installed path.
2. Read `<plugin-root>/skills/harness/SKILL.md` completely.
3. Read `<plugin-root>/skills/harness/references/status.md` completely.
4. Follow “Operazioni portabili per host senza slash command” in the main skill and run its status script through the shell. Do not invoke a Claude slash command or expand `${CLAUDE_PLUGIN_ROOT}` literally.
