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

### Notification payload shape

Claude Code invokes `Notification` hooks by passing JSON to stdin. The known payload shape is:

```json
{
  "hook_event_name": "Notification",
  "session_id": "<uuid>",
  "cwd": "/path/to/project",
  "params": {
    "message": "..."
  }
}
```

The `session_id` and `cwd` fields are present on all `Notification` payloads. The `params.message` string varies. For context compaction the message contains the word `"compact"` (case-insensitive). Detection strategy: check `payload.params?.message` with `/compact/i`. This is a heuristic — if the message is absent or the field changes in a future Claude Code release, the hook falls through silently without error.

### New file: `src/hooks/notification.ts`

Follows the same structure and error handling contract as `session-end.ts`:

1. Read and parse stdin as JSON → `payload`
2. Guard: if `payload.hook_event_name !== 'Notification'` or no compaction keyword in message, exit 0 silently
3. Locate JSONL: `findCurrentSessionLog(payload.session_id, payload.cwd)` from `./utils`
4. If not found, log to stderr (only when `CC_MEMORY_DEBUG` set) and exit 0
5. Parse JSONL: `parseLogFile(logPath)` from `../parser/jsonl`
6. Skip if `parsed.messagesCount < 1`
7. Generate summary (AI if enabled, fallback otherwise) — same pattern as `session-end.ts`
8. Build `SessionMemory` directly (same `createSessionMemory()` helper pattern as `session-end.ts`) — **do NOT call `importFromGlobalStore()`**, which adds an `"imported"` tag and blocks on deduplication
9. Inject tag: merge `"pre-compact"` into `sessionMemory.tags`
10. **Upsert logic**: call `store.getByClaudeSessionId(parsed.claudeSessionId)`
    - If found (session already exists): set `sessionMemory.id` to the existing record's `id`, then call `store.save(sessionMemory)` — `INSERT OR REPLACE` on primary key updates in place
    - If not found: use a freshly generated `id` (via `generateId()` from `./utils`)
11. Call `store.save(sessionMemory)`; `store.close()`
12. Log `✅ cc-sessions: Snapshot saved (pre-compact)` to stdout
13. Wrap everything in try/catch; on error log to stderr (when `CC_MEMORY_DEBUG`) and exit 0

### Hook registration

Added to the user's Claude Code settings (`~/.claude/settings.json`) during `cc-sessions setup` or documented in the README as a manual step:

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

### New CLI sub-command: `cc-sessions notify`

Added to `src/cli.ts`. Reads stdin, calls the notification hook handler exported from `src/hooks/notification.ts`. Always exits 0. Not intended for direct user use.

---

## Section 2 — Manual Save Command

### Snapshot save logic (shared helper)

Both `cc-sessions save` and `cc-sessions notify` use the same core snapshot logic. Extract it to `src/hooks/snapshot.ts` (new file):

```
saveSnapshot(logPath: string, store: SessionStore, config: Config, tag: string): Promise<void>
```

This avoids duplicating the parse → summarise → upsert flow.

Steps inside `saveSnapshot`:
1. Parse JSONL at `logPath`
2. Skip if `messagesCount < 1`
3. Generate summary (AI or fallback)
4. Build `SessionMemory` (no `"imported"` tag — this is not the importer path)
5. Inject `tag` into `sessionMemory.tags`
6. Upsert: check `getByClaudeSessionId` → set existing `id` if found, else generate new
7. `store.save(sessionMemory)`

### CLI: `cc-sessions save [claude-session-id]`

Added to `src/cli.ts`.

| Scenario | Behaviour |
|----------|-----------|
| No args | `findCurrentSessionLog('', process.cwd())` from `src/hooks/utils` — matches by encoded cwd, falls back to most recently modified JSONL within 5 min |
| `claude-session-id` arg provided | `findCurrentSessionLog(claudeSessionId, process.cwd())` — matches by session ID in filename first |

- Calls `saveSnapshot(logPath, store, config, 'snapshot')`
- Prints `✅ Session saved: <claudeSessionId> (pre-clear snapshot)` on success
- Prints `⚠️  No session log found — run this command from your project directory` if JSONL not located
- Error handling: try/catch, exit 1 with message on failure (CLI context — user is watching)

### Slash command: `/sessions:snapshot`

Skill file at: `~/.claude/skills/sessions-snapshot.md` (or the project's `.claude/skills/` directory)

Content: instructs Claude to run `cc-sessions save` in the terminal and show the output. Exact invocation:

```bash
cc-sessions save
```

The skill echoes whatever `cc-sessions save` prints to stdout. No additional logic in the skill file.

---

## Section 3 — UI Changes

Both changes are isolated to `src/server/ui.ts`.

### 3a. Tag badges on session cards

New CSS class added to the `<style>` block:

```css
.tag-badge {
  background: #2a2420;
  border: 1px solid #5a3a20;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 10px;
  color: var(--accent);
  flex-shrink: 0;
}
```

In `buildSessionCard()`, after the `.session-card-meta` row, append tag badges for recognised tags:

| Tag value | Badge text |
|-----------|-----------|
| `"pre-compact"` | `📸 pre-compact` |
| `"snapshot"` | `📌 snapshot` |

Implementation: iterate `s.tags` array; for each recognised tag append `h('span', { class: 'tag-badge', text: '...' })` to the meta row. Tags already flow through the existing API (`claudeSessionId` and `tags` are both present in the `SessionMemory` serialised by `rowToSession()` and returned by `GET /api/sessions/:id` and `GET /api/sessions`).

### 3b. "Resume in Claude Code" section in session detail

In `openDetail()`, insert the resume block above the existing footer line (`detail-id`).

Only rendered when `s.claudeSessionId` is a non-empty string.

The block structure (built with the existing `h()` helper):

```
┌─────────────────────────────────────────────────┐
│ RESUME IN CLAUDE CODE                            │
│ claude --resume <claudeSessionId>    [Copy]      │
│ Open this session exactly where it was saved     │
└─────────────────────────────────────────────────┘
```

New CSS class:

```css
.resume-block {
  background: #1a1a1a;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 16px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.resume-cmd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.resume-cmd-text {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: var(--text);
}
.resume-copy-btn {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: color .12s, border-color .12s;
}
.resume-copy-btn:hover { color: var(--text); border-color: #555; }
.resume-hint {
  font-size: 11px;
  color: var(--dim);
}
```

Copy button click handler: `navigator.clipboard.writeText('claude --resume ' + s.claudeSessionId)` — update button text to `Copied!` for 1500ms then revert.

---

## Data Flow

```
Claude Code compacts context
  → fires Notification hook (JSON on stdin with session_id, cwd, params.message)
    → cc-sessions notify
      → src/hooks/notification.ts detects /compact/i in message
        → findCurrentSessionLog(session_id, cwd) → logPath
          → saveSnapshot(logPath, store, config, 'pre-compact')
            → upsert with tag "pre-compact"

User about to /clear (manual)
  → user runs /sessions:snapshot (slash command) or cc-sessions save (CLI)
    → findCurrentSessionLog('', cwd) → logPath
      → saveSnapshot(logPath, store, config, 'snapshot')
        → upsert with tag "snapshot"

User opens cc-sessions UI → session card
  → 📸 or 📌 badge visible if tagged

User clicks session → detail view
  → "Resume in Claude Code" block shows: claude --resume <claudeSessionId>
    → user copies and runs in terminal → resumes session at point of snapshot
```

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/hooks/notification.ts` | New — Notification hook handler; reads stdin, detects compaction, calls `saveSnapshot` |
| `src/hooks/snapshot.ts` | New — shared `saveSnapshot()` helper used by notification hook and save command |
| `src/cli.ts` | Add `save [claude-session-id]` and `notify` sub-commands |
| `src/server/ui.ts` | Add `.tag-badge` + `.resume-block` CSS; add tag badges to `buildSessionCard()`; add resume section to `openDetail()` |
| `docs/commands.md` | Document `cc-sessions save` command |

> `src/hooks/utils.ts` — no changes needed; `findCurrentSessionLog` is already exported and handles session-ID-first + cwd-encoded fallback + recency fallback.

---

## Out of Scope

- Watching `~/.claude/projects/` files for changes (file watcher approach rejected in favour of notification hook)
- Smarter periodic-save based on token count
- Any changes to the database schema (tags already stored in `tags_json`)
- The `"imported"` tag: snapshot saves bypass the importer pipeline entirely, so this tag is never added to snapshot sessions
