---
name: sessions:import
description: Import Claude Code CLI sessions from ~/.claude/projects/ into the database
allowed-tools: Bash
---

# Import Sessions

Import Claude Code CLI sessions from `~/.claude/projects/` into the cc-sessions database.

## Usage Examples

```
/sessions:import
/sessions:import --limit 9999
/sessions:import --no-ai
/sessions:import --since 2025-01-01
/sessions:import --project /path/to/project
/sessions:import --dry-run
```

## Instructions

When the user runs `/sessions:import`, execute via CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" import $ARGUMENTS
```

Arguments:
- `--limit <number>` - Maximum number of sessions to import (default: 100)
- `--no-ai` - Skip AI summary generation; use rule-based summaries instead
- `--since <date>` - Only import sessions on or after this date (ISO 8601 or YYYY-MM-DD)
- `--project <path>` - Only import sessions for a specific project path
- `--dry-run` - Preview sessions that would be imported without saving

## Default Behavior

Without arguments, imports up to 100 sessions with AI-generated summaries. Use `--limit 9999` to import all sessions.

## Success Output

Display the CLI output directly to the user, showing how many sessions were imported and summarized.
