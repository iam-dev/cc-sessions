# Rich Session Summaries Design

**Date:** 2026-04-08
**Status:** Approved

## Overview

Replace the vague rule-based session summaries (e.g. "Worked on cc-sessions for 8 minutes. Modified 4 existing files. Used 5K tokens.") with a 3-tier provider chain that produces meaningful, human-readable summaries. Add a `cc-sessions summarize` command to retroactively regenerate summaries for existing sessions. Add `/sessions:import` and `/sessions:clear` slash command skills. Add a CI workflow that runs tests on every PR.

---

## Section 1 — Provider Chain Architecture

### Problem

Both `src/parser/summarizer.ts` and `src/importer/index.ts` contain duplicate `createFallbackSummary()` functions that produce output like:

> "Worked on cc-sessions for 8 minutes. Modified 4 existing files. Used 5K tokens."

AI summary generation is gated behind `config.autoSave.generateSummary` which defaults to `false`, so most sessions — including all imported sessions — receive only the weak fallback.

### New file structure

```
src/parser/providers/
  claude-cli.ts      spawns: claude -p "<prompt>" --output-format json
  anthropic-api.ts   Anthropic SDK logic (moved from summarizer.ts)
  rule-based.ts      improved rule-based extractor
src/parser/summarizer.ts   thin orchestrator — tries providers in order
```

### Provider chain

Providers are tried in order. The first to succeed returns its result. The rule-based provider always succeeds.

#### 1. Claude Code CLI provider (`src/parser/providers/claude-cli.ts`)

Spawns the local `claude` binary in non-interactive mode:

```bash
claude -p "<SUMMARY_PROMPT>" --output-format json
```

- Uses the user's existing Claude Code authentication — no extra API key required
- 30 second timeout via `AbortController`
- The `--output-format json` flag wraps the response in a JSON envelope:
  ```json
  { "type": "result", "subtype": "success", "result": "<JSON string>", "is_error": false }
  ```
  The provider extracts `response.result`, then JSON-parses that string as `SessionSummary`.
- Falls through (returns `null`) if:
  - `claude` is not found in `PATH`
  - Process exits non-zero
  - `is_error` is `true` in the envelope
  - `result` string cannot be parsed as valid `SessionSummary` JSON
  - Timeout fires

#### 2. Anthropic API provider (`src/parser/providers/anthropic-api.ts`)

Existing `generateSummary()` logic moved from `summarizer.ts`:

- Only attempted if `ANTHROPIC_API_KEY` environment variable is set
- Falls through (returns `null`) if key is absent or the API call throws

#### 3. Rule-based provider (`src/parser/providers/rule-based.ts`)

Significantly improved over the current fallback. Always returns a result.

**`no-ai-summary` tag:** `ruleBasedSummary()` appends `no-ai-summary` to the returned `SessionSummary.tags` array. The orchestrator and call sites do not need to add it manually. This allows `cc-sessions summarize` to target these sessions for later regeneration.

**Improvements over current fallback:**

| Field | Before | After |
|-------|--------|-------|
| `summary` | "Session in cc-sessions: modified 4 files over 8 minutes" | Derived from first user message + dominant tool types, e.g. "Updated import docs: edited commands.md, installation.md, README.md" |
| `description` | "Worked on cc-sessions for 8 minutes. Modified 4 existing files. Used 5K tokens." | Intent from first user message + file-level detail, e.g. "User asked to document `--limit 9999` for importing all sessions. Edited docs/commands.md, docs/installation.md, README.md, and docs/index.md to add the flag and examples." |
| `tasks` | `[]` | Extracted from checkbox patterns, TODO: markers, and numbered action-verb lists |
| `keyDecisions` | `[]` | Extracted from assistant "I'll...", "Let's...", "The best approach is..." patterns |
| `nextSteps` | `[]` | Extracted from "next step", "then we should", "remaining tasks" patterns |
| `tags` | `[]` | Technology tags from file extensions + message content + `no-ai-summary` |

### Config flag scope

`config.autoSave.generateSummary` **no longer gates AI usage during import or the `summarize` command** — it remains relevant only for auto-save hooks (`src/hooks/snapshot.ts`, `src/hooks/session-end.ts`, `src/hooks/periodic-save.ts`).

### Import behavior change

The `--no-ai` flag on `cc-sessions import` forces rule-based only. Without it, the full provider chain runs regardless of `config.autoSave.generateSummary`.

### Orchestrator (`src/parser/summarizer.ts`)

The existing `generateSummary(parsed: ParsedSession, config: SummaryConfig)` signature gains an optional third parameter:

```typescript
export async function generateSummary(
  parsed: ParsedSession,
  config: SummaryConfig,   // same type as today — call sites pass config.summaries
  skipAI = false,
): Promise<SessionSummary> {
  if (!skipAI) {
    const ccCli = await tryClaudeCli(parsed);
    if (ccCli) return ccCli;

    if (process.env.ANTHROPIC_API_KEY) {
      const api = await tryAnthropicApi(parsed, config);
      if (api) return api;
    }
  }

  return ruleBasedSummary(parsed);  // always succeeds, tags no-ai-summary
}
```

Existing call sites (`src/importer/index.ts` line 237, `src/hooks/snapshot.ts`) both already pass `config.summaries` as the second argument — the signature change is backward compatible.

### Files to create / modify

| File | Change |
|------|--------|
| `src/parser/providers/claude-cli.ts` | New — CC CLI provider |
| `src/parser/providers/anthropic-api.ts` | New — Anthropic SDK provider (moved from summarizer) |
| `src/parser/providers/rule-based.ts` | New — improved rule-based provider (always tags `no-ai-summary`) |
| `src/parser/summarizer.ts` | Rewrite as thin orchestrator |
| `src/importer/index.ts` | Remove duplicate `createFallbackSummary()`, call `generateSummary(parsed, config.summaries, skipAI)` directly; remove `config.autoSave.generateSummary` gate |
| `src/hooks/snapshot.ts` | Remove duplicate `fallbackSummary()`, call `generateSummary(parsed, config.summaries, skipAI)` — **keep** the `config.autoSave.generateSummary` gate (snapshot.ts is an auto-save hook) |
| `src/cli.ts` | Add `save`, `summarize`, and `on-clear` sub-commands |
| `hooks/hooks.json` | Add `matcher: "clear"` `SessionStart` entry for `post-clear.js` (30s timeout) |

---

## Section 2 — `cc-sessions summarize` CLI Command

### Purpose

Regenerate summaries for sessions that were imported or saved before AI was available, or with `--no-ai`.

### Usage

```bash
cc-sessions summarize [session-id]   # regenerate one specific session
cc-sessions summarize                # regenerate sessions tagged no-ai-summary (default)
cc-sessions summarize --all          # force-regenerate every session
cc-sessions summarize --no-ai        # rule-based only
cc-sessions summarize --limit <n>    # cap sessions processed (default: 50)
```

### Algorithm

1. Load sessions from DB:
   - With `[session-id]`: load that one session
   - Default (no args): sessions where `tags` contains `no-ai-summary`
   - With `--all`: all sessions
2. For each session:
   a. Check `session.logFile` exists — if not, skip with warning (preserve existing summary)
   b. Parse log file with `parseLogFile(session.logFile)`
   c. Run provider chain via `generateSummary(parsed, config.summaries, skipAI)`
   d. Update session record in-place: same `id`, overwrite `summary`, `description`, `tasks`, `keyDecisions`, `nextSteps`, `blockers`, `tags`
   e. The `no-ai-summary` tag is removed automatically if AI succeeded (the returned `SessionSummary.tags` will not contain it); it is preserved if rule-based was still used
3. Report results

### Output

```
Scanning for sessions to summarize...
Found 47 sessions with rule-based summaries.

[  1/47] MnemeBrain: Implemented JWT authentication...    ✅ CC CLI
[  2/47] cc-sessions: Updated import docs...              ✅ API
[  3/47] Taskaroo: Refactored mobile navigation...        ✅ rule-based
[  4/47] VlamGuard: Log file not found, skipping          ⚠️  skipped

Done. 44 updated, 3 skipped.
```

### Files to create / modify

| File | Change |
|------|--------|
| `src/cli.ts` | Add `summarize` command |
| `tests/cli/summarize.test.ts` | New — CLI option parsing and regeneration pipeline |

---

## Section 3 — `/sessions:import` Slash Command Skill

Skill file at `~/.claude/skills/sessions-import.md` (global, not tracked in repo).

### Behaviour

When user runs `/sessions:import`:

1. Claude runs `cc-sessions import --limit 9999`
2. The full provider chain runs on every session (CC CLI → API → rule-based)
3. Claude shows full output including the count of imported sessions
4. After completion, Claude displays the 5 most recent session summaries so the user can verify quality

### Skill content

```markdown
---
name: sessions-import
description: Import all Claude Code CLI sessions from ~/.claude/projects/ into the cc-sessions database with AI-generated summaries. Use when the user wants to import their session history.
---

Run this command in the terminal to import all sessions:

```bash
cc-sessions import --limit 9999
```

Show the full output to the user. After it completes, run:

```bash
cc-sessions list --limit 5
```

Show those 5 sessions to the user so they can verify the summaries look meaningful. If many sessions show "no-ai-summary" tags, suggest running `cc-sessions summarize` to regenerate them with AI.
```

### Also document in `docs/commands.md`

Add `/sessions:import` to the slash commands section.

---

## Section 4 — `/sessions:clear` Slash Command Skill

Skill file at `~/.claude/skills/sessions-clear.md` (global, not tracked in repo).

### Behaviour

When user runs `/sessions:clear`:

1. Claude runs `cc-sessions save` to snapshot the current session with a full AI summary
2. **On success (✅):** Reports the session ID saved, then runs `/clear`
3. **On failure (⚠️):** Warns the user the save failed, asks if they still want to run `/clear`

### `cc-sessions save` command

The `save` command is added to `src/cli.ts` as part of this spec (not the snapshot spec). It snapshots the most recently active session log — same behaviour as described in the snapshot/resume spec's Section 2. The two specs are additive; if the snapshot spec lands first, Section 4 of this spec inherits the `save` command without conflict.

### Relationship to the `SessionStart/clear` hook (Section 6)

Section 6 adds automatic saving via a `SessionStart` hook that fires after every `/clear`. `/sessions:clear` is the proactive alternative: it saves *before* clearing and gives the user confirmation. Both coexist — if both run, `saveSnapshot()` upserts by `claudeSessionId` so no duplicate is created.

### Skill content

```markdown
---
name: sessions-clear
description: Save the current session with a summary, then clear context. Use instead of /clear when you want to preserve the session before clearing.
---

First, save the current session by running this in the terminal:

```bash
cc-sessions save
```

If it prints `✅ Session saved: <id>`, report the session ID to the user, then run `/clear`.

If it prints `⚠️ No session log found`, warn the user: "Session could not be saved. This may be because the session is very new or no changes have been made. Do you still want to clear context?"

Wait for user confirmation before running `/clear` if the save failed.
```

### Also document in `docs/commands.md`

Add `/sessions:clear` to the slash commands section.

---

## Section 5 — CI GitHub Workflow

New file `.github/workflows/ci.yml`.

### Trigger

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
```

### Jobs

#### `build-and-test`

Matrix: Node.js 18, 20, 22.

Steps:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` with matrix Node version
3. `npm ci`
4. `npm run build` — TypeScript compile; if this fails, test step is skipped
5. `npm test -- --coverage` — Jest with coverage
6. Upload coverage summary to job summary (no external service)

#### `lint`

Runs on Node 20 only, in parallel with `build-and-test`.

Steps:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` (Node 20)
3. `npm ci`
4. `npm run lint`

### No secrets required

Tests use `better-sqlite3` with temp directories. The CC CLI and Anthropic API providers are skipped in tests via `skipAI = true` — no `ANTHROPIC_API_KEY` needed in CI.

The existing `release-npm.yml` (triggered on `v*` tags) is unchanged.

### File to create

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | New — CI workflow for PRs |

---

## Data Flow

```
User runs /sessions:import or cc-sessions import --limit 9999
  → importFromGlobalStore()
    → for each JSONL file:
        → parseLogFile() → ParsedSession
        → generateSummary(parsed, config.summaries, skipAI=false)
            1. tryClaudeCli(parsed)
               → spawns: claude -p "..." --output-format json
               → unwraps envelope: JSON.parse(response.result)
               → returns SessionSummary | null
            2. tryAnthropicApi(parsed, config)   [only if ANTHROPIC_API_KEY set]
               → returns SessionSummary | null
            3. ruleBasedSummary(parsed)           [always succeeds]
               → appends no-ai-summary to SessionSummary.tags
               → returns SessionSummary
        → store.save(sessionMemory)

User runs cc-sessions summarize
  → load sessions tagged no-ai-summary
    → for each session:
        → parseLogFile(session.logFile)
        → generateSummary(parsed, config.summaries, skipAI=false)
        → store.update(session.id, newSummary)
        → no-ai-summary tag absent if AI succeeded (tag is set by provider, not caller)

User runs /sessions:clear
  → cc-sessions save (with full provider chain, tag: snapshot)
    → findCurrentSessionLog() → logPath → generateSummary() → store.save()
    → success: report ID, then run /clear
    → failure: warn user, ask for confirmation
  → /clear fires → SessionStart hook (matcher: "clear") also runs
      → findPreviousSessionLog() finds the same JSONL
      → saveSnapshot() upserts (same claudeSessionId → same DB row, no duplicate)

User types /clear directly (without /sessions:clear)
  → SessionStart hook fires (matcher: "clear")
      → payload.transcript_path → projectDir
      → findPreviousSessionLog(projectDir, transcript_path) → clearedLogPath
      → saveSnapshot(clearedLogPath, store, config, 'pre-clear')
      → session saved with pre-clear tag and full provider-chain summary

PR opened on GitHub
  → ci.yml triggers
    → build-and-test (Node 18, 20, 22 matrix) — npm ci, build, test --coverage
    → lint (Node 20) — npm ci, lint
```

---

## Files to Create / Modify — Full List

| File | Change |
|------|--------|
| `src/parser/providers/claude-cli.ts` | New — CC CLI provider with envelope unwrapping |
| `src/parser/providers/anthropic-api.ts` | New — Anthropic SDK provider (moved from summarizer) |
| `src/parser/providers/rule-based.ts` | New — improved provider; always appends `no-ai-summary` to tags |
| `src/parser/summarizer.ts` | Rewrite as thin orchestrator; `generateSummary` gains optional `skipAI` param |
| `src/importer/index.ts` | Remove duplicate `createFallbackSummary()`; drop `config.autoSave.generateSummary` gate; call `generateSummary(parsed, config.summaries, skipAI)` |
| `src/hooks/snapshot.ts` | Remove duplicate `fallbackSummary()`; call `generateSummary(parsed, config.summaries, skipAI)` — keep `config.autoSave.generateSummary` gate |
| `src/cli.ts` | Add `save` command; add `summarize` command |
| `~/.claude/skills/sessions-import.md` | New (global, not in repo) |
| `~/.claude/skills/sessions-clear.md` | New (global, not in repo) |
| `docs/commands.md` | Document `summarize`, `save`, `on-clear`, `/sessions:import`, `/sessions:clear`, `SessionStart/clear` hook setup |
| `.github/workflows/ci.yml` | New |
| `tests/parser/providers/claude-cli.test.ts` | New |
| `tests/parser/providers/anthropic-api.test.ts` | New |
| `tests/parser/providers/rule-based.test.ts` | New |
| `tests/parser/summarizer.test.ts` | New |
| `tests/cli/summarize.test.ts` | New — CLI option parsing and regeneration pipeline |
| `tests/hooks/snapshot.test.ts` | Update — cover provider-chain path and `no-ai-summary` tag propagation |
| `src/hooks/post-clear.ts` | New — `SessionStart` handler for `/clear` (CLI entry: `on-clear`) |
| `src/hooks/utils.ts` | Add `findPreviousSessionLog(projectDir, excludePath, maxAgeMinutes)` with path.resolve, empty-file, max-age guards |
| `hooks/hooks.json` | Add `matcher: "clear"` `SessionStart` entry for `post-clear.js` |
| `src/server/ui.ts` | Add `pre-clear` tag badge alongside `pre-compact` and `snapshot` |
| `tests/hooks/post-clear.test.ts` | New — unit tests for post-clear hook |
| `tests/hooks/utils.test.ts` | New or update — cover `findPreviousSessionLog` edge cases |

---

## Section 6 — `SessionStart` Hook for `/clear` Auto-save

### Problem

When a user types `/clear` in Claude Code CLI, context is wiped immediately. Unless the user remembers to run `/sessions:clear` first, the session is lost with no summary.

### Hook discovery

`/clear` does **not** fire `UserPromptSubmit` — it is processed client-side before any hook. Instead, `/clear` causes Claude Code to start a fresh session, which fires `SessionStart`. This fires **after** the clear, but the previous session's JSONL file remains on disk and is still parseable.

### Matcher for `/clear`

Claude Code evaluates the `matcher` field in the hook registration before dispatching. Based on Claude Code hook documentation, the correct matcher string for sessions started by `/clear` is `"clear"`. This is a registration-side filter — the handler never receives the matcher value directly.

Because matcher behavior is verified at registration time rather than runtime, **`post-clear.ts` must also be defensive**: it adds a maximum-age guard (only process the previous JSONL if its mtime is within the last 60 minutes) to avoid accidentally re-saving an old unrelated session if the hook fires unexpectedly.

The existing matcherless `SessionStart` entry (from `hooks/hooks.json`, which shows last session summary on startup) fires independently and also runs on `/clear` events — this is intentional: the user sees the summary of the cleared session AND it is saved automatically.

### Payload shape (`SessionStart`)

```json
{
  "hook_event_name": "SessionStart",
  "session_id": "<new-uuid>",
  "transcript_path": "/Users/.../.claude/projects/<encoded-path>/<new-uuid>.jsonl",
  "cwd": "/Users/.../project",
  "permission_mode": "default"
}
```

`transcript_path` points to the **new** (post-clear) session's JSONL, which is empty or just created.

### Finding the cleared session

```
projectDir = path.dirname(path.resolve(payload.transcript_path))
allJsonl   = glob("*.jsonl", projectDir)
             .map(p => path.resolve(p))
             .filter(p => p !== path.resolve(payload.transcript_path))  // symlink-safe
             .filter(p => stat(p).size > 0)                              // skip empty files
             .filter(p => now - stat(p).mtime < 60 minutes)             // max-age guard
             .sortByMtimeDesc()
cleared    = allJsonl[0]
```

`path.resolve()` is applied to both sides before comparing to handle symlink path differences. If no matching JSONL is found, exit 0 silently.

### New file: `src/hooks/post-clear.ts`

```
try:
  1. Read and parse stdin → payload
  2. Guard: hook_event_name !== 'SessionStart' → exit 0
  3. Guard: payload.transcript_path absent → exit 0
  4. projectDir = path.dirname(path.resolve(payload.transcript_path))
  5. config = await loadConfig()
  6. clearedLogPath = findPreviousSessionLog(projectDir, payload.transcript_path)
     // uses path.resolve, empty-file guard, 60-min max-age guard
  7. If not found → debug log → exit 0
  8. store = new SessionStore()
  9. try {
       // Always bypass config.autoSave.generateSummary gate for /clear saves —
       // full provider chain (CC CLI → API → rule-based) is always used.
       // saveSnapshot calls generateSummary(parsed, config.summaries, false) internally.
       await saveSnapshot(clearedLogPath, store, config, 'pre-clear')
       if (CC_MEMORY_DEBUG) stderr.write('cc-sessions: Snapshot saved (pre-clear)\n')
     } finally {
       store.close()
     }
catch (err):
  debug log → always exit 0   ← never interrupt the user
```

> **`config.autoSave.generateSummary` gate**: `post-clear.ts` always passes `skipAI=false` to `saveSnapshot` (by ensuring `config.autoSave.generateSummary` is treated as `true` for this path), so the full provider chain always runs when the user clears context. This requires `saveSnapshot` to accept a `forceAI` parameter, or for `post-clear.ts` to call `generateSummary` directly rather than via the `snapshot.ts` wrapper's config gate. The implementer should choose the cleaner approach.

**`findPreviousSessionLog(projectDir, excludePath, maxAgeMinutes = 60)`** — new helper in `src/hooks/utils.ts`:

1. `glob("*.jsonl", projectDir)` → resolve all with `path.resolve()`
2. Filter out `path.resolve(excludePath)`
3. Filter out files with `stat(p).size === 0`
4. Filter out files where `now - stat(p).mtime > maxAgeMinutes * 60 * 1000`
5. Sort by mtime descending
6. Return first match, or `null` if none

### Hook registration

Added to `hooks/hooks.json` (plugin mode) and documented for `~/.claude/settings.json` (standalone mode):

**`hooks/hooks.json` update** — add new entry alongside the existing matcherless `SessionStart`:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/session-start.js", "timeout": 10 }]
      },
      {
        "matcher": "clear",
        "hooks": [{ "type": "command", "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/post-clear.js", "timeout": 30 }]
      }
    ]
  }
}
```

Both entries fire for `/clear` events independently: the first shows last session summary, the second saves the cleared session.

**Standalone `~/.claude/settings.json` addition** (documented in `docs/commands.md`):
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

### New CLI sub-command: `cc-sessions on-clear`

Added to `src/cli.ts`. Reads stdin JSON, calls the post-clear hook handler. Always exits 0. Named `on-clear` (action-event form) rather than `post-clear` to be consistent with `save`, `notify`, `import`, `summarize` naming.

### Tag

Sessions saved by this hook are tagged `pre-clear` (distinct from `pre-compact` and `snapshot`). The UI tag badge:

| Tag value | Badge text |
|-----------|------------|
| `"pre-clear"` | `🗑️ pre-clear` |

This badge is added alongside the existing `pre-compact` and `snapshot` badge logic in `src/server/ui.ts`.

### Combined-tag scenario

When the user runs `/sessions:clear` (Section 4), `cc-sessions save` runs first (tag: `snapshot`), then `/clear` fires the `SessionStart` hook (tag: `pre-clear`). The upsert merges tags: the session ends up with both `["snapshot", "pre-clear"]` tags. Both badges are shown in the UI. This is correct and expected.

### Interaction with `/sessions:clear` skill

| Scenario | What happens |
|----------|-------------|
| User types `/clear` directly | `on-clear` hook fires, saves previous session with `pre-clear` tag automatically |
| User types `/sessions:clear` | `cc-sessions save` runs (`snapshot` tag) → `/clear` fires → hook fires → upsert adds `pre-clear` → final tags: `["snapshot", "pre-clear"]` |

### Files to create / modify

| File | Change |
|------|--------|
| `src/hooks/post-clear.ts` | New — `SessionStart` handler for `/clear` |
| `src/hooks/utils.ts` | Add `findPreviousSessionLog(projectDir, excludePath, maxAgeMinutes)` with path.resolve, empty-file, and max-age guards |
| `src/cli.ts` | Add `on-clear` sub-command |
| `hooks/hooks.json` | Add `matcher: "clear"` `SessionStart` entry |
| `src/server/ui.ts` | Add `pre-clear` tag badge |
| `tests/hooks/post-clear.test.ts` | New — unit tests (max-age guard, path.resolve normalisation, empty-file skip, upsert) |
| `tests/hooks/utils.test.ts` | New or update — cover `findPreviousSessionLog` edge cases |
| `tests/hooks/snapshot.test.ts` | Update — cover combined `snapshot`+`pre-clear` tag upsert scenario |
| `docs/commands.md` | Document `on-clear`, `SessionStart/clear` hook setup and `hooks/hooks.json` change |

---

## Out of Scope

- Streaming summaries in the UI
- Summary quality scoring / A-B comparison
- Webhook notifications when summaries are regenerated
- Per-project summary model override (already in `ProjectOverride` type but not wired up)
