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
| `src/cli.ts` | Add `save` command (required by `/sessions:clear` skill) and `summarize` command |

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

### Why not intercept `/clear` directly

`/clear` is a Claude Code built-in command that cannot be intercepted by a hook or skill. `/sessions:clear` is the user-facing alternative that combines save + clear in one step.

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
  → cc-sessions save
    → findCurrentSessionLog() → logPath
    → generateSummary() full chain
    → store.save(sessionMemory)
    → success: report ID, run /clear
    → failure: warn user, ask for confirmation

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
| `docs/commands.md` | Document `summarize`, `save`, `/sessions:import`, `/sessions:clear` |
| `.github/workflows/ci.yml` | New |
| `tests/parser/providers/claude-cli.test.ts` | New |
| `tests/parser/providers/anthropic-api.test.ts` | New |
| `tests/parser/providers/rule-based.test.ts` | New |
| `tests/parser/summarizer.test.ts` | New |
| `tests/cli/summarize.test.ts` | New — CLI option parsing and regeneration pipeline |
| `tests/hooks/snapshot.test.ts` | Update — cover provider-chain path and `no-ai-summary` tag propagation |

---

## Out of Scope

- Streaming summaries in the UI
- Summary quality scoring / A-B comparison
- Webhook notifications when summaries are regenerated
- Per-project summary model override (already in `ProjectOverride` type but not wired up)
