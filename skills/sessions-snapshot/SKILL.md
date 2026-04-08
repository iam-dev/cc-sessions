---
name: sessions-snapshot
description: Save the current Claude Code session before running /clear. Use when the user wants to snapshot their session, or before clearing context.
allowed-tools: Bash
---

Run this command in the terminal to save the current session:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" save
```

Show the full output to the user. If it prints `✅ Session saved:`, the snapshot was successful and the user can safely run `/clear`. If it prints `⚠️ No session log found`, advise the user to run the command from their project directory.
