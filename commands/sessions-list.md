---
name: sessions:list
description: Browse all saved sessions
allowed-tools: Bash
---

# List Sessions

Browse all saved session memories.

## Usage Examples

```
/sessions:list
/sessions:list --project ./myapp
/sessions:list --limit 20
/sessions:list --all
```

## Instructions

When the user runs `/sessions:list`, execute via CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" list $ARGUMENTS
```

Arguments:
- `--project` - Filter by project path
- `--limit` - Number of sessions to show (default 10)
- `--all` - Include archived sessions

## Output Format

```
Session Memories

Showing {count} of {total} sessions

┌─────────────────────────────────────────────────────────────────┐
│ 1. {summary}                                                    │
│    Project: {projectName}                                       │
│    {date} - {duration} - {tokens} tokens                        │
│    ID: {sessionId}                                              │
├─────────────────────────────────────────────────────────────────┤
│ 2. {summary}                                                    │
│    Project: {projectName}                                       │
│    {date} - {duration} - {tokens} tokens                        │
│    ID: {sessionId}                                              │
└─────────────────────────────────────────────────────────────────┘

Commands:
- /sessions:resume <id> - Resume a session
- /sessions:export <id> - Export session to markdown
- /sessions:search <query> - Search sessions
```

## Empty State

```
No session memories found.

Sessions are automatically saved when you:
- End a Claude Code session
- Close the terminal
- Work for more than 5 minutes (auto-checkpoint)

Start working on a project and your context will be preserved!
```

## Storage Stats Footer

```
───────────────────────────────────────────────────────────────────
Storage: {usedMB} MB used - {totalSessions} sessions
Configure retention: /sessions:settings
```
