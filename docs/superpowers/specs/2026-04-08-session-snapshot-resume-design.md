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
  "cwd": "<path>",
  "params": {
    "message": "..."
  }
}
```

Detection strategy: check `payload.params?.message` with `/compact/i`. If absent or no match, exit 0 silently.

### Stdout contract for Notification hooks

Claude Code does not parse hook stdout as structured protocol data for `Notification` hooks — it is displayed to the user as freeform output. However, to be consistent with the existing pattern in `session-end.ts` and to avoid any UI noise during background compaction, **all output from `notification.ts` goes to stderr, guarded by `CC_MEMORY_DEBUG`**. No stdout output is produced.

### New file: `src/hooks/notification.ts`

```
try {
  1. Read and parse stdin → payload
  2. Guard: if hook_event_name !== 'Notification' or no /compact/i in params.message → exit 0
  3. findCurrentSessionLog(payload.session_id, payload.cwd) → logPath
  4. If not found → log to stderr (CC_MEMORY_DEBUG only) → exit 0
  5. const store = new SessionStore()
  6. try {
       await saveSnapshot(logPath, store, config, 'pre-compact')
       if (CC_MEMORY_DEBUG) process.stderr.write('cc-sessions: Snapshot saved (pre-compact)\n')
     } finally {
       store.close()   ← store lifecycle owned by notification.ts
     }
} catch (err) {
  if (CC_MEMORY_DEBUG) process.stderr.write('cc-sessions: ' + err.message + '\n')
  // always exit 0
}
```

### Hook registration

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "cc-sessions notify" }]
      }
    ]
  }
}
```

### New CLI sub-command: `cc-sessions notify`

Added to `src/cli.ts`. Reads stdin, calls the notification hook handler. Always exits 0.

---

## Section 2 — Manual Save Command

### Shared helper: `src/hooks/snapshot.ts`

```ts
export async function saveSnapshot(
  logPath: string,
  store: SessionStore,
  config: Config,
  tag: string
): Promise<void>
```

Steps:
1. `parseLogFile(logPath)` → `parsed`
2. Skip if `parsed.messagesCount < 1`
3. `generateSummary` or fallback → `summary`
4. Build `SessionMemory` using the same `createSessionMemory` helper as `session-end.ts`. At this point `id` is set to `generateId()` (a temporary value — step 6 will overwrite it if needed). `claudeSessionId` comes from `parsed.claudeSessionId`.
5. **Append** `tag` to existing tags: `sessionMemory.tags = [...sessionMemory.tags, tag]` — this preserves any tags already produced by `summary.tags` from the AI
6. **Upsert**: `const existing = store.getByClaudeSessionId(parsed.claudeSessionId)` → if found: **unconditionally overwrite** `sessionMemory.id = existing.id` so `INSERT OR REPLACE` updates the existing record instead of inserting a duplicate
7. `store.save(sessionMemory)`

> **Note:** `store.close()` is NOT called inside `saveSnapshot` — callers own the store lifecycle and must close it themselves.

### CLI: `cc-sessions save [claude-session-id]`

Added to `src/cli.ts`.

| Scenario | Behaviour |
|----------|-----------|
| No args | `findCurrentSessionLog('', process.cwd())` — with empty string, the session-ID match in `findCurrentSessionLog` matches every log (empty string is a substring of everything), so the function immediately returns the most recently modified JSONL file. This is the intended fallback behaviour: grab the active session. |
| `claude-session-id` arg | `findCurrentSessionLog(claudeSessionId, process.cwd())` — matches by UUID in filename |

- Calls `saveSnapshot(logPath, store, config, 'snapshot')` then `store.close()`
- Prints `✅ Session saved: <claudeSessionId> (pre-clear snapshot)` on success
- Prints `⚠️  No session log found — run this command from your project directory` if JSONL not located
- **Exit code policy**: `cc-sessions save` is a user-facing CLI command; exit 1 on failure is acceptable and expected. When invoked from the slash command (inside a Claude session), the error output is visible to the user and that is intentional — the user should know if the save failed before they type `/clear`.

### Slash command: `/sessions:snapshot`

Skill file at `~/.claude/skills/sessions-snapshot.md`.
Instructs Claude to run `cc-sessions save` in the terminal and show output.

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

In `buildSessionCard()`, after the `.session-card-meta` row, iterate `s.tags` and append `.tag-badge` spans for recognised tags:

| Tag value | Badge text |
|-----------|-----------|
| `"pre-compact"` | `📸 pre-compact` |
| `"snapshot"` | `📌 snapshot` |

### 3b. Resume block in session detail

In `openDetail()`, above the `.detail-id` footer line, insert when `s.claudeSessionId` is non-empty.

New CSS classes:

```css
.resume-block {
  background: #1a1a1a; border: 1px solid var(--border);
  border-radius: 6px; padding: 12px 16px; margin-bottom: 16px;
  display: flex; flex-direction: column; gap: 6px;
}
.resume-cmd {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.resume-cmd-text {
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; color: var(--text);
}
.resume-copy-btn {
  background: var(--card-bg); border: 1px solid var(--border);
  border-radius: 4px; padding: 3px 10px; font-size: 11px;
  color: var(--muted); cursor: pointer; flex-shrink: 0;
  transition: color .12s, border-color .12s;
}
.resume-copy-btn:hover { color: var(--text); border-color: #555; }
.resume-hint { font-size: 11px; color: var(--dim); }
```

Command displayed and copied: `claude --resume <s.claudeSessionId>`

**Copy button implementation** — use `navigator.clipboard.writeText()` with an explicit fallback:

```js
function copyToClipboard(text, btn) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      showCopied(btn);
    }).catch(function() {
      fallbackCopy(text, btn);
    });
  } else {
    fallbackCopy(text, btn);
  }
}

function fallbackCopy(text, btn) {
  // Create a temporary input for manual selection in non-secure or unsupported contexts
  var inp = document.createElement('input');
  inp.style.cssText = 'position:fixed;opacity:0';
  inp.value = text;
  document.body.appendChild(inp);
  inp.select();
  try { document.execCommand('copy'); showCopied(btn); } catch(e) {}
  document.body.removeChild(inp);
}

function showCopied(btn) {
  var orig = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(function() { btn.textContent = orig; }, 1500);
}
```

The UI server binds to `127.0.0.1` which qualifies as a secure context in Chromium; the fallback handles Firefox and other environments.

---

## Data Flow

```
Claude Code compacts context
  → fires Notification hook (JSON on stdin with session_id, cwd, params.message)
    → cc-sessions notify
      → src/hooks/notification.ts detects /compact/i in message
        → findCurrentSessionLog(session_id, cwd) → logPath
          → store = new SessionStore()
          → saveSnapshot(logPath, store, config, 'pre-compact')  [upsert]
          → store.close()

User about to /clear (manual)
  → user runs /sessions:snapshot (slash command) or cc-sessions save (CLI)
    → findCurrentSessionLog('', cwd) → most recently modified JSONL
      → store = new SessionStore()
      → saveSnapshot(logPath, store, config, 'snapshot')  [upsert]
      → store.close()

User opens cc-sessions UI → session card
  → 📸 or 📌 badge visible if tagged

User clicks session → detail view
  → "Resume in Claude Code" block (when claudeSessionId non-empty)
    → claude --resume <claudeSessionId>   [Copy button with fallback]
      → user runs command in terminal → Claude Code resumes session at snapshot point
```

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/hooks/notification.ts` | New — Notification hook handler |
| `src/hooks/snapshot.ts` | New — shared `saveSnapshot()` helper |
| `src/cli.ts` | Add `save [claude-session-id]` and `notify` sub-commands |
| `src/server/ui.ts` | Tag badges + resume block CSS and DOM |
| `docs/commands.md` | Document `cc-sessions save` command |
| `~/.claude/skills/sessions-snapshot.md` | New — slash command skill file |

`src/hooks/utils.ts` — no changes needed.

---

## Out of Scope

- File watcher approach
- Smarter periodic-save based on token count
- DB schema changes (tags already stored in `tags_json`)
- `"imported"` tag on snapshot sessions — snapshot path bypasses the importer pipeline entirely
