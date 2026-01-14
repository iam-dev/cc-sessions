---
layout: default
title: Commands
nav_order: 3
---

# Command Reference

cc-sessions provides six slash commands for managing your session memories.

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
