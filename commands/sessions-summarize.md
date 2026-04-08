---
name: sessions:summarize
description: Regenerate AI summaries for sessions that only have rule-based summaries
allowed-tools: Bash
---

# Summarize Sessions

Regenerate AI-powered summaries for imported sessions.

## Usage Examples

```
/sessions:summarize
/sessions:summarize --all
/sessions:summarize --all --limit 9999
/sessions:summarize mem_abc123_xyz789
/sessions:summarize --no-ai
```

## Instructions

When the user runs `/sessions:summarize`, execute via CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" summarize $ARGUMENTS
```

Arguments:
- `[sessionId]` - Optional session ID to summarize a specific session
- `--all` - Regenerate all sessions, not just those with rule-based summaries
- `--no-ai` - Use rule-based summarizer only (no AI providers)
- `--limit <number>` - Maximum number of sessions to process (default: 50)

## Default Behavior

Without arguments, only sessions with rule-based (no-ai-summary) summaries are processed. Use `--all` to force regeneration of all sessions.

## Success Output

Display the CLI output directly to the user, which will show progress and a summary of how many sessions were processed.

## Error Messages

If no sessions need summarizing:
```
No sessions found that need AI summarization.

Use --all to regenerate summaries for all sessions.
```
