---
name: sessions-summarize
description: Regenerate AI summaries for sessions that only have rule-based summaries. Use when imported sessions have poor or missing summaries.
allowed-tools: Bash
---

Run this command to regenerate AI summaries:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" summarize $ARGUMENTS
```

Arguments:
- `[sessionId]` - Optional session ID to summarize a specific session
- `--all` - Regenerate all sessions, not just those with rule-based summaries
- `--no-ai` - Use rule-based summarizer only (no AI providers)
- `--limit <number>` - Maximum number of sessions to process (default: 50)

Show the full output to the user. If no sessions need summarizing, suggest running with `--all` to force regeneration.
