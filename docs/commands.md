---
layout: default
title: Commands
nav_order: 3
---

# Command Reference

cc-sessions provides slash commands and CLI commands for managing your session memories.

## /sessions

Show summary of the last session in the current project.

```
/sessions
```

### Output

```
┌─────────────────────────────────────────────────────────────────┐
│  📍 LAST SESSION                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Project:   myapp                                                │
│  When:      Yesterday at 3:42 PM (47 min)                       │
│  Tokens:    125K                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  🎯 SUMMARY                                                      │
│  Refactoring authentication system - extracted TokenService      │
│  class and updated import sites.                                 │
│                                                                  │
│  ✅ COMPLETED                                                    │
│  • Extracted TokenService class                                  │
│  • Updated Register.tsx imports                                  │
│  • Added unit tests                                              │
│                                                                  │
│  ⏳ PENDING                                                      │
│  • Update middleware/auth.ts                                     │
│  • Update pages/Login.tsx                                        │
│                                                                  │
│  📁 FILES MODIFIED                                               │
│  • src/services/TokenService.ts (created)                        │
│  • src/pages/Register.tsx (modified)                             │
│                                                                  │
│  💡 SUGGESTED NEXT STEPS                                         │
│  1. Complete remaining import updates                            │
│  2. Run integration tests                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## /sessions:search

Search across all saved sessions.

```
/sessions:search <query> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `query` | Search terms (required) |

### Options

| Option | Description |
|--------|-------------|
| `--project <path>` | Limit search to specific project |
| `--from <date>` | Start date (e.g., "last week", "2025-01-01") |
| `--to <date>` | End date |
| `--limit <n>` | Maximum results (default: 20) |

### Examples

```bash
# Basic search
/sessions:search authentication

# Search within a project
/sessions:search "bug fix" --project ./myapp

# Search recent sessions
/sessions:search refactor --from "last month"

# Limit results
/sessions:search api --limit 5
```

### Output

```
🔍 Search: "authentication"
Found 5 sessions:

┌─────────────────────────────────────────────────────────────────┐
│ 1. Auth refactor - TokenService extraction                       │
│    Jan 12 · 47 min · 125K tokens · /projects/myapp              │
│    "...extracted authentication logic into..."                   │
├─────────────────────────────────────────────────────────────────┤
│ 2. OAuth integration debugging                                   │
│    Jan 8 · 23 min · 67K tokens · /projects/myapp                │
│    "...fixed authentication flow for Google..."                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## /sessions:resume

Resume a session with full context restoration.

```
/sessions:resume [session-id]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `session-id` | Session ID to resume (optional, defaults to last session) |

### How It Works

1. Loads session memory from the store
2. Displays context summary for confirmation
3. Injects context as conversation primer
4. Optionally loads original Claude session

### Example

```
/sessions:resume mem_abc123_xyz789
```

### Output

```
┌─────────────────────────────────────────────────────────────────┐
│  🔄 RESUMING SESSION                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Loading: "Auth refactor - TokenService extraction"              │
│  From: Jan 12, 2025 at 3:42 PM                                  │
│                                                                  │
│  📋 CONTEXT BEING RESTORED:                                      │
│                                                                  │
│  You were refactoring the authentication system:                 │
│  - Created TokenService class to centralize token logic          │
│  - Updated 3 of 5 files that import the old auth module         │
│  - Remaining: middleware/auth.ts, pages/Login.tsx               │
│                                                                  │
│  Your last message was:                                          │
│  "Let's continue with the remaining imports tomorrow"            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## /sessions:list

Browse all saved sessions.

```
/sessions:list [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--project <path>` | Filter by project path |
| `--limit <n>` | Number of sessions to show (default: 10) |
| `--all` | Include archived sessions |
| `--page <n>` | Page number for pagination |

### Examples

```bash
# List recent sessions
/sessions:list

# List sessions for a specific project
/sessions:list --project ./myapp

# Show more sessions
/sessions:list --limit 20

# Include archived
/sessions:list --all
```

### Output

```
📋 Recent Sessions (10 of 47)

┌─────────────────────────────────────────────────────────────────┐
│ 1. Auth refactor - TokenService extraction                       │
│    Jan 12 · 47 min · myapp                                       │
├─────────────────────────────────────────────────────────────────┤
│ 2. Bug fix: Login redirect loop                                  │
│    Jan 11 · 15 min · myapp                                       │
├─────────────────────────────────────────────────────────────────┤
│ 3. API documentation update                                      │
│    Jan 10 · 32 min · api-docs                                    │
└─────────────────────────────────────────────────────────────────┘

Page 1 of 5 · [N]ext [P]rev [Q]uit
```

---

## /sessions:export

Export session to markdown or JSON format.

```
/sessions:export [session-id] [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `session-id` | Session ID to export (optional, defaults to last) |

### Options

| Option | Description |
|--------|-------------|
| `--format <fmt>` | Output format: `md` or `json` (default: md) |
| `--output <path>` | Save to file path |
| `--full` | Include full conversation if available |

### Examples

```bash
# Export last session as markdown
/sessions:export

# Export specific session as JSON
/sessions:export mem_abc123 --format json

# Save to file
/sessions:export --output ./notes/session.md

# Include full conversation
/sessions:export --full
```

### Markdown Output

```markdown
# Session: Auth refactor - TokenService extraction

**Project:** myapp
**Date:** January 12, 2025 3:42 PM
**Duration:** 47 minutes
**Tokens:** 125,432

## Summary

Refactoring authentication system - extracted TokenService
class and updated import sites.

## Tasks

### Completed
- [x] Extracted TokenService class
- [x] Updated Register.tsx imports

### Pending
- [ ] Update middleware/auth.ts
- [ ] Update pages/Login.tsx

## Files Modified

- `src/services/TokenService.ts` (created)
- `src/pages/Register.tsx` (modified)

## Next Steps

1. Complete remaining import updates
2. Run integration tests
```

---

## /sessions:settings

View and configure memory settings.

```
/sessions:settings
```

### Interactive Menu

```
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION MEMORY SETTINGS                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  📦 RETENTION                                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Full sessions:    [1 year     ▼]                        │    │
│  │ Archives:         [Forever    ▼]                        │    │
│  │ Max storage:      [10 GB      ]                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  💾 AUTO-SAVE                                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ [✓] Auto-save sessions                                  │    │
│  │ [✓] Generate AI summaries                               │    │
│  │ [✓] Extract tasks                                       │    │
│  │ [ ] Cloud sync (Pro)                                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  📊 STORAGE STATUS                                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Sessions saved:    847                                  │    │
│  │ Storage used:      2.3 GB / 10 GB                       │    │
│  │ Oldest session:    Mar 15, 2024                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Retention Options

| Option | Description |
|--------|-------------|
| 7 days | Minimal storage |
| 30 days | Claude default |
| 90 days | Quarterly |
| 1 year | Recommended |
| Forever | Never delete |

See [Configuration](configuration.html) for full details on all settings.

---

## /sessions:ui

Open the Sessions Browser UI in your default browser.

```
/sessions:ui
```

Starts a local web server at `http://127.0.0.1:3456` and opens the UI automatically.

### What You Get

- **Projects page** — grid of project cards with name, last summary, activity, and session count
- **Project Summary view** — aggregate stats (sessions, tokens, duration, tasks done) plus README rendering and recent activity
- **Session list view** — all sessions for a project with summary, duration, and token usage
- **Session detail view** — full panel with tasks, files, key decisions, next steps, and blockers
- **All Sessions view** — flat chronological list across every project
- **Live search** — full-text search from the sidebar filters sessions in real time

### Also Available as CLI

```bash
# Start UI (opens browser automatically)
cc-sessions ui

# Custom port, no auto-open
cc-sessions ui --port 4000 --no-open
```

---

## cc-sessions save

Snapshot the current session immediately — run this before `/clear` to preserve your context.

```bash
cc-sessions save [claude-session-id]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `claude-session-id` | Optional. Session UUID to snapshot. Defaults to the most recently active session. |

### Examples

```bash
# Save the current session (most recently active)
cc-sessions save

# Save a specific session by its Claude session ID
cc-sessions save abc123-def456
```

### Output

```
✅ Session saved: abc123-def456 (pre-clear snapshot)
```

### When to use

Run this command before typing `/clear` in Claude Code. The saved snapshot will appear in the sessions UI with a 📌 snapshot badge, and you can resume it later with `claude --resume <id>`.

### Session tags

Sessions saved with this command are tagged `snapshot` in the database. Sessions saved automatically via context compaction are tagged `pre-compact`.

---

## cc-sessions summarize

Regenerate AI summaries for sessions that were saved with rule-based summaries.

```bash
cc-sessions summarize [session-id]   # regenerate one specific session
cc-sessions summarize                # regenerate sessions tagged no-ai-summary (default)
cc-sessions summarize --all          # force-regenerate every session
cc-sessions summarize --no-ai        # rule-based only (no AI providers)
cc-sessions summarize --limit <n>    # cap sessions processed (default: 50)
```

### When to use

After running `cc-sessions import`, many sessions will have `no-ai-summary` tags if AI was unavailable during import. Run `cc-sessions summarize` to retroactively upgrade those summaries.

### Output

```
Scanning for sessions to summarize...
Found 47 sessions.

[  1/47] myapp: Updated import docs...             ✅ CC CLI
[  2/47] cc-sessions: Add authentication...        ✅ API
[  3/47] project: Refactored nav...                ✅ rule-based
[  4/47] VlamGuard: Log file not found, skipping   ⚠️  skipped

Done. 44 updated, 3 skipped.
```

### Provider chain

Tries in order: CC CLI (`claude`) → Anthropic API (`ANTHROPIC_API_KEY`) → rule-based fallback.

---

## cc-sessions import

Bulk-import Claude Code CLI sessions from `~/.claude/projects/` into the cc-sessions database.

```bash
cc-sessions import [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--project <path>` | Filter to sessions matching a project path substring |
| `--dry-run` | Preview what would be imported without writing to the database |
| `--no-ai` | Use fast rule-based summaries instead of AI-generated ones |
| `--since <date>` | Only import sessions on or after an ISO 8601 date (e.g. `2026-01-01`) |
| `--limit <n>` | Cap the number of sessions processed per run (default: **100**) |

> **Note:** The default limit is 100 sessions. To import your entire history, pass a large number like `--limit 9999`.

### Examples

```bash
# Import ALL sessions (override the default 100-session limit)
cc-sessions import --limit 9999

# Preview how many sessions would be imported without writing
cc-sessions import --dry-run --limit 9999

# Import only sessions for a specific project
cc-sessions import --project ./myapp --limit 9999

# Import recent sessions without AI summaries (faster)
cc-sessions import --since 2026-01-01 --no-ai --limit 9999

# Cap to 50 sessions (for testing)
cc-sessions import --limit 50
```

### Deduplication

Sessions already present in the database (identified by their Claude session ID) are automatically skipped. You can safely re-run `import` at any time.

### Output

```
Scanning ~/.claude/projects/...
Found 142 session files, 38 already imported.

[  0%]   1/104  Importing session abc123...
[ 25%]  26/104  Importing session def456...
[ 50%]  52/104  Importing session ghi789...
[100%] 104/104  Done.

✅ Imported 104 sessions (38 skipped as duplicates)
```

Imported sessions are tagged with `"imported"` so you can filter or identify them later.

---

## /sessions:import

Import all Claude Code CLI sessions from `~/.claude/projects/` with AI-generated summaries.

```
/sessions:import
/sessions:import --limit 9999
/sessions:import --no-ai
/sessions:import --since 2025-01-01
/sessions:import --project /path/to/project
/sessions:import --dry-run
```

### Options

| Option | Description |
|--------|-------------|
| `--limit <n>` | Maximum sessions to import (default: 100) |
| `--no-ai` | Skip AI summaries; use rule-based instead |
| `--since <date>` | Only import sessions on or after this date (ISO 8601) |
| `--project <path>` | Only import sessions for a specific project |
| `--dry-run` | Preview what would be imported without saving |

Runs `cc-sessions import` with any arguments passed. Safe to re-run — sessions already in the database are automatically skipped.

---

## /sessions:summarize

Regenerate AI-powered summaries for sessions with rule-based (no-ai-summary) summaries.

```
/sessions:summarize
/sessions:summarize --all
/sessions:summarize --all --limit 9999
/sessions:summarize mem_abc123_xyz789
/sessions:summarize --no-ai
```

### Options

| Option | Description |
|--------|-------------|
| `[session-id]` | Optional. Summarize a single specific session. |
| `--all` | Force-regenerate all sessions, not just `no-ai-summary` ones |
| `--no-ai` | Use rule-based summarizer only (no AI providers) |
| `--limit <n>` | Cap sessions processed (default: 50) |

### When to use

After importing sessions with `--no-ai` or when AI was unavailable at import time, sessions are tagged `no-ai-summary`. Run `/sessions:summarize --all --limit 9999` to retroactively upgrade all summaries with AI.

### Output

```
Scanning for sessions to summarize...
Found 47 sessions.

[  1/47] myapp: Updated import docs...             ✅ CC CLI
[  2/47] cc-sessions: Add authentication...        ✅ API
[  3/47] project: Refactored nav...                ✅ rule-based
[  4/47] VlamGuard: Log file not found, skipping   ⚠️  skipped

Done. 44 updated, 3 skipped.
```

### Provider chain

Tries in order: CC CLI (`claude` binary) → Anthropic API (`ANTHROPIC_API_KEY`) → rule-based fallback.

---

## /sessions:clear

Save the current session with a full AI summary, then clear context.

```
/sessions:clear
```

Runs `cc-sessions save`, reports the saved session ID, then runs `/clear`. If the save fails (e.g., the session is too new), warns the user before clearing.

Use this instead of `/clear` when you want to preserve your session before starting a new context.

---

## Auto-save on /clear (SessionStart hook)

cc-sessions can automatically save your session whenever you type `/clear`. This is set up automatically when using the plugin. For standalone (npm install) setup, add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "clear",
        "hooks": [{ "type": "command", "command": "cc-sessions on-clear" }]
      }
    ]
  }
}
```

Sessions saved this way are tagged `pre-clear` and show a 🗑️ badge in the UI.
