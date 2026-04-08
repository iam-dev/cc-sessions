---
name: sessions-import
description: Import all Claude Code CLI sessions from ~/.claude/projects/ into the cc-sessions database with AI-generated summaries. Use when the user wants to import their session history.
allowed-tools: Bash
---

Run this command in the terminal to import all sessions:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" import --limit 9999
```

Show the full output to the user. After it completes, run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" list --limit 5
```

Show those 5 sessions to the user so they can verify the summaries look meaningful. If many sessions show "no-ai-summary" tags, suggest running the summarize command to regenerate them with AI.
