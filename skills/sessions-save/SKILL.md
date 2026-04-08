---
name: sessions-save
description: Save the current Claude Code session to the database as a checkpoint. Use when the user wants to persist session progress without clearing context.
allowed-tools: Bash
---

Run this command to save the current session to the database:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" save
```

Show the full output to the user.

- If it prints `✅ Session saved: <id>`, report the session ID and confirm the session is saved.
- If it prints `⚠️ No session log found`, advise the user that the session may be too new or no activity has been recorded yet. They can try again after more work has been done.
