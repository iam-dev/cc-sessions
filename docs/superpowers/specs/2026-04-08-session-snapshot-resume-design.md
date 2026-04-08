# Session Snapshot & Resume Design

**Date:** 2026-04-08
**Status:** Approved

## Overview

Add three capabilities to cc-sessions:

1. **Auto-snapshot before compaction** — a Claude Code `Notification` hook saves the session automatically when context compaction fires
2. **Manual snapshot command** — `cc-sessions save` CLI command and `/sessions:snapshot` slash command let users snapshot before `/clear`
3. **Resume UI** — each session in the UI shows the exact `claude --resume` command needed to reopen it in Claude Code CLI, plus tag badges identifying how the session was saved

---

## Section 1 — Notification Hook (Auto-snapshot)

### What

A new hook handler `src/hooks/notification.ts` registered under the `Notification` Claude Code hook event.

### How

- Reads the notification payload from stdin (JSON)
- Checks if the notification indicates context compaction (e.g. `type === "context_compacted"` or message body contains `"compacted"`)
- If matched: imports the current session from its JSONL file in `~/.claude/projects/` using the existing import pipeline
- Tags the saved session with `"pre-compact"` in the `tags` field

### Hook registration

Added to `.claude/settings.json` under `hooks.Notification`:

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "cc-sessions notify" }
        ]
      }
    ]
  }
}
```

### New CLI sub-command

`cc-sessions notify` — reads stdin, detects compaction, snapshots session. Not intended for direct user use.

---

## Section 2 — Manual Save Command

### CLI: `cc-sessions save [session-id]`

| Scenario | Behaviour |
|----------|-----------|
| No args, run from project dir | Finds the most recently modified JSONL in `~/.claude/projects/` matching the cwd, imports it |
| `session-id` provided | Imports that specific Claude session ID |
| `CLAUDE_SESSION_ID` env var set | Uses that session ID (available when run from within a hook) |

- Tags the session with `"snapshot"`
- Prints: `✅ Session saved: <id> (pre-clear snapshot)`
- Skips if already imported (deduplication via existing `claudeSessionId` check)

### Slash command: `/sessions:snapshot`

Thin wrapper skill that runs `cc-sessions save` in the terminal and echoes the output. No new infrastructure beyond the CLI command.

---

## Section 3 — UI Changes

Both changes are isolated to `src/server/ui.ts`.

### 3a. Tag badges on session cards

Session cards display a `.session-card-meta` row with duration/tokens. We append tag badges for recognised tags:

| Tag | Badge |
|-----|-------|
| `"pre-compact"` | `📸 pre-compact` (muted accent colour) |
| `"snapshot"` | `📌 snapshot` (muted accent colour) |

The `tags` array is already present in the API response — no backend change needed.

### 3b. "Resume in Claude Code" section in session detail

Added above the existing "Session ID" footer line. Only rendered when `claudeSessionId` is non-empty.

```
RESUME IN CLAUDE CODE
claude --resume <claudeSessionId>        [Copy]
Open this session exactly where it was saved
```

- Dark code block using the existing monospace font (`.file-chip` style reference)
- Copy button calls `navigator.clipboard.writeText('claude --resume ' + claudeSessionId)`
- Subtitle text: `"Open this session exactly where it was saved"`

---

## Data Flow

```
Claude Code compacts context
  → fires Notification hook
    → cc-sessions notify (reads stdin)
      → detects compaction payload
        → importFromGlobalStore() for current session
          → SessionStore.save() with tag "pre-compact"

User types `/clear` (manual)
  → user runs /sessions:snapshot first
    → cc-sessions save
      → importFromGlobalStore() for current session
        → SessionStore.save() with tag "snapshot"

User opens cc-sessions UI
  → session card shows 📸 or 📌 badge if tagged
  → session detail shows "Resume in Claude Code" block
    → user copies `claude --resume <id>` and runs it in terminal
```

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/hooks/notification.ts` | New — notification hook handler |
| `src/cli.ts` | Add `save` and `notify` sub-commands |
| `src/server/ui.ts` | Add tag badges + resume section |
| `docs/commands.md` | Document `cc-sessions save` and `cc-sessions notify` |

---

## Out of Scope

- Watching `~/.claude/projects/` files for changes (file watcher approach rejected in favour of notification hook)
- Smarter periodic-save based on token count
- Any changes to the database schema (tags already stored in `tags_json`)
