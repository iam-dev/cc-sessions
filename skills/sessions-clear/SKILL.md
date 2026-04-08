---
name: sessions-clear
description: Save the current session with a summary, then clear context. Use instead of /clear when you want to preserve the session before clearing.
allowed-tools: Bash
---

First, save the current session by running this in the terminal:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" save
```

If it prints `✅ Session saved: <id>`, report the session ID to the user, then run `/clear`.

If it prints `⚠️ No session log found`, warn the user: "Session could not be saved. This may be because the session is very new or no changes have been made. Do you still want to clear context?"

Wait for user confirmation before running `/clear` if the save failed.
