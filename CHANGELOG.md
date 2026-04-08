# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-04-08

### Added

#### Session Health Score Layer

- **`src/analysis/health.ts`** — new analysis module: `computeHealth(session)` returns a `SessionHealth` with `score: 'green' | 'yellow' | 'red'`, human-readable `reasons[]`, and `confidence: 'high' | 'medium' | 'low'`; `aggregateProjectHealth(sessions)` rolls up the last 5 sessions to a single project-level health status; `getHealthLabel(score)` returns "Healthy / Mixed / Struggling"
- **`src/analysis/patterns.ts`** — new analysis module: `getRecurringBlockers(sessions)` groups near-duplicate blocker strings using token-based Jaccard similarity (threshold 0.4) and returns the top 3 by frequency; `normalizeBlocker(text)` strips noise prefixes and punctuation before comparison
- **Health dot on session list rows** — every session card in the Sessions Browser UI now shows a coloured 8 px dot (🟢/🟡/🔴) after the timestamp with a tooltip showing the reason list
- **Health badge on session detail** — the session detail view shows a full "Healthy / Mixed / Struggling" badge below the session title
- **Project card health line** — each project card in the Projects grid now shows a health dot + label, and the top recurring blocker (if it appears ≥ 2 times) directly on the card
- **Health data in `/api/projects` response** — `handleProjects()` now augments each project with `health: ProjectHealth` and `topBlocker: {text, count} | null` computed server-side from the 5 most recent sessions
- **53 new tests** covering all scoring paths, confidence levels, completion-rate boundaries, blocker normalisation, Jaccard grouping, project aggregation, and UI presence of CSS/JS identifiers

#### Scoring Design

Health is blocker-first: blockers are a stronger signal than task completion (task extraction is regex-based and single-session only). Red requires 3+ blockers, or being blocked with no progress; yellow covers 1–2 blockers or low completion; green is the absence of both. Full rationale in `CONTRIBUTING.md`.

---

## [1.5.1] - 2026-04-08

### Added

#### Sessions Browser UI
- **Message thread viewer** — the "💬 N messages" badge in the session detail view is now clickable; clicking it expands a collapsible thread showing the full conversation between you and Claude, loaded lazily on first open
- **`GET /api/sessions/:id/messages`** — new REST endpoint that reads the session's JSONL log file and returns all human/assistant messages as `{role, text, timestamp}[]` in conversation order

---

## [1.5.0] - 2026-04-08

### Added

#### Rich Session Summaries — 3-Tier AI Provider Chain
- **CC CLI provider** — tries `claude -p "<prompt>" --output-format json` first; no API key required, uses the local Claude Code binary; unwraps the `{ result: "<JSON>" }` envelope
- **Anthropic API provider** — falls back to the Anthropic SDK if `ANTHROPIC_API_KEY` is set; supports `haiku` and `sonnet` models via config
- **Rule-based provider** — final fallback; always succeeds; extracts intent from the first user message, file extensions for tech tags; tags result with `no-ai-summary` for later upgrade
- **`cc-sessions summarize`** — new CLI command to retroactively regenerate AI summaries for sessions tagged `no-ai-summary`; supports `[session-id]`, `--all`, `--no-ai`, and `--limit <n>` flags; shows per-session provider label (`CC CLI` / `API` / `rule-based`)

#### Auto-Save on `/clear`
- **`cc-sessions on-clear`** — internal CLI entry point reading a `SessionStart` JSON payload from stdin and saving the cleared session tagged `pre-clear` with a full AI summary (`forceAI=true`)
- **SessionStart hook with `matcher: "clear"`** — registered in `hooks/hooks.json`; fires after the user types `/clear` and auto-saves the cleared session
- **`/sessions:clear` slash command skill** — saves the current session via `cc-sessions save` before running `/clear`; warns if save fails

#### Slash Commands
- **`/sessions:import` slash command** — command file at `commands/sessions-import.md`; passes `$ARGUMENTS` directly to `cc-sessions import` (e.g. `/sessions:import --limit 9999 --no-ai`); covers all import flags: `--limit`, `--no-ai`, `--since`, `--project`, `--dry-run`
- **`/sessions:summarize` slash command** — command file at `commands/sessions-summarize.md`; passes `$ARGUMENTS` directly to `cc-sessions summarize` (e.g. `/sessions:summarize --all --limit 9999`); covers `[session-id]`, `--all`, `--no-ai`, `--limit`

#### UI
- **`pre-clear` tag badge** — sessions saved before a `/clear` now show a 🗑️ `pre-clear` badge in the Sessions Browser UI

#### CI
- **GitHub Actions CI workflow** (`.github/workflows/ci.yml`) — runs `build` + `test` on Node 18/20/22 matrix and `lint` on Node 20; triggers on all PR events

### Fixed
- **`tasksPending` inconsistency** — `snapshot.ts` now counts `in_progress` and `blocked` tasks as pending (uses `!== 'completed'`), consistent with the importer and UI
- **Anthropic provider empty-summary bypass** — `parseResponse()` now returns `null` when the API response has no `summary` field, ensuring rule-based fallback fires correctly

### Technical Details
- New modules: `src/parser/providers/rule-based.ts`, `src/parser/providers/anthropic-api.ts`, `src/parser/providers/claude-cli.ts`, `src/hooks/post-clear.ts`
- `src/parser/summarizer.ts` rewritten as a 44-line thin orchestrator delegating to the three providers
- `saveSnapshot()` gains `forceAI = false` parameter; `src/importer/index.ts` drops duplicate `createFallbackSummary()`
- `findPreviousSessionLog(projectDir, excludePath, maxAgeMinutes=60)` added to `src/hooks/utils.ts`
- 28 new tests across 7 new test files; total: 181 passing, 1 skipped

---

## [1.4.0] - 2026-04-08

### Added

#### Session Snapshot & Resume
- **`cc-sessions save [claude-session-id]`** — new CLI command to snapshot the current session immediately; run before `/clear` to preserve context
- **`/sessions:snapshot` slash command** — skill file at `~/.claude/skills/sessions-snapshot.md`; instructs Claude to run `cc-sessions save` and report the result
- **`cc-sessions notify`** — internal CLI entry point for the Claude Code Notification hook; detects context compaction events and auto-snapshots the session
- **Auto-snapshot on compaction** — register the Notification hook in `~/.claude/settings.json` to automatically save a snapshot whenever Claude Code compacts context (tagged `pre-compact`)
- **Tag badges in session cards** — sessions saved before compaction show a 📸 `pre-compact` badge; manual snapshots show a 📌 `snapshot` badge in the Sessions Browser UI
- **"Resume in Claude Code" block** — each session detail view now shows the exact `claude --resume <id>` command with a one-click copy button (clipboard API with `execCommand` fallback)

#### Hooks
- **`src/hooks/snapshot.ts`** — shared `saveSnapshot()` helper used by both the Notification hook and the `save` CLI command; upserts sessions (no duplicates) and merges accumulated tags across multiple saves

### Technical Details
- Notification hook (`src/hooks/notification.ts`) respects `autoSave.enabled` config flag; all output to stderr gated by `CC_MEMORY_DEBUG`; always exits 0
- Upsert strategy: `getByClaudeSessionId()` look-up → reuse existing `id` on `INSERT OR REPLACE`; tags from multiple saves are merged via Set (no loss)
- 8 new tests: `tests/hooks/snapshot.test.ts` (4), `tests/hooks/notification.test.ts` (7 — grew from 4 during review), `tests/server/ui-badges.test.ts` (3), `tests/server/ui-resume.test.ts` (5)
- Total test count: 154

#### Hook registration

To enable auto-snapshot on compaction, add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Notification": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "cc-sessions notify" }] }
    ]
  }
}
```

---

## [1.3.1] - 2026-04-08

### Added

#### Import Command
- **`cc-sessions import`** — new CLI command to bulk-import Claude Code CLI sessions from `~/.claude/projects/` into the cc-sessions database
- **Deduplication** — sessions already in the database are automatically skipped (identified by `claudeSessionId`)
- **`--project <path>`** — filter import to sessions matching a specific project path substring
- **`--dry-run`** — preview which sessions would be imported without writing to the database
- **`--no-ai`** — skip AI summary generation and use fast rule-based summaries instead
- **`--since <date>`** — only import sessions that started on or after an ISO 8601 date
- **`--limit <n>`** — cap the number of sessions processed per run (default: 100)
- **Progress reporting** — live `[%] current/total` progress indicator during import
- **Imported tag** — all imported sessions are tagged with `"imported"` for easy filtering

#### Store
- **`SessionStore.getByClaudeSessionId(id)`** — new method to look up a session by its Claude session ID; used internally for import deduplication

### Technical Details
- New module: `src/importer/index.ts` with `importFromGlobalStore()` and `importSingleFile()` exports
- 18 new unit tests in `tests/importer/import.test.ts`
- 10 new E2E tests in `tests/e2e/cli-import.test.ts` (full CLI subprocess testing)
- Total test count: 135

---

## [1.3.0] - 2026-04-08

### Added

#### Project Summary View
- **New Project Summary view** — clicking a project card now opens a dedicated summary page instead of going straight to the sessions list
- **Aggregate stat cards** — displays Sessions, Tokens, Duration, and Tasks Done for each project at a glance
- **README section** — reads `README.md` from the project directory and renders it as formatted Markdown; auto-creates a starter `README.md` if none exists
- **Markdown rendering** — uses `marked` + `DOMPurify` (loaded from jsDelivr CDN) for safe, styled Markdown output in the dark theme
- **Recent Activity section** — shows the 5 most recent sessions directly on the summary page
- **Browse All Sessions button** — navigates from the summary view into the full sessions list for that project
- **Back-label support** — detail view back button correctly shows the project name when navigating from the summary view

#### API
- **`GET /api/projects/:path`** — new endpoint returning a project's `ProjectSummary`, `recentSessions` (last 5), and `readmeContent`

#### Data
- **`totalTasksCompleted`** added to `ProjectSummary` type and `getProjects()` SQL query (`SUM(tasks_completed)`)

---

## [1.2.1] - 2026-04-08

### Fixed

#### Code Quality & Correctness
- **LIKE wildcard escaping** — `simplSearch` fallback now escapes `%` and `_` in user queries to return accurate results
- **FTS index rebuild safety** — FTS5 content table column names now match the backing `sessions` table (fixes `rebuild` operations)
- **`getStats()` uses instance `dbPath`** — storage stats now report the correct file size when using a non-default database path
- **`loadConfig()` side-effect removed** — no longer writes a default config file on first call; callers that need persistence should call `saveConfig()` explicitly
- **`trimToStorageLimit` performance** — size is now tracked incrementally during cleanup instead of re-walking the full directory after each deletion

#### Cloud Sync
- **AWS SDK stream type** — replaced `@ts-expect-error` workaround with proper `response.Body.transformToByteArray()` call
- **Encryption key output** — key is now written to `stderr` instead of `stdout` to avoid capture in pipes and CI logs

#### Hooks
- **`SessionStore` resource leak** — both session-end and periodic-save hooks now close the store in a `try/finally` block, preventing DB connection leaks on error paths
- **Redundant module-level state removed** — `currentSessionMemoryId` in periodic-save was always `null` (hooks run as new processes); replaced with direct DB lookup

#### Tests
- **Loader test isolation** — `loadConfig` test no longer writes to the real `~/.cc-sessions/` directory
- **Cloud test safety** — device-id file is now saved and restored around each test instead of being permanently deleted

#### Refactoring
- **Shared hook utilities** — `generateId()` and `findCurrentSessionLog()` extracted to `src/hooks/utils.ts`, eliminating duplication between session-end and periodic-save hooks
- **SQL-based file/tag search** — `SearchIndex.searchByFile()` and `searchByTag()` now use targeted SQL queries instead of loading all sessions into memory

### Changed
- Version bumped to `1.1.0` in `src/index.ts`, `src/cli.ts`, and `package.json` (was incorrectly left at `1.0.0` since the v1.1.0 release)

---

## [1.2.0] - 2026-04-08

### Added

#### Sessions Browser UI
- **`/sessions:ui` slash command** — opens a local web UI at `http://127.0.0.1:3456` in your default browser
- **`cc-sessions ui` CLI command** — starts the web server with `--port` and `--no-open` flags
- **Projects page** — claude.ai-style grid of project cards showing name, last summary, last activity, and session count
- **Session list view** — clicking a project shows its sessions with summary, duration, and token usage
- **Session detail view** — full detail panel with tasks, files created/modified, key decisions, next steps, and blockers
- **All Sessions view** — flat chronological list across every project
- **Search** — live full-text search from the sidebar filters sessions across all projects
- **Filter & sort** — filter projects inline by name/summary; sort by activity, name, or session count
- **`getProjects()` store method** — SQL aggregation returning one `ProjectSummary` per project path

## [1.1.0] - 2025-01-14

### Added

#### Periodic Save Hook
- **Auto-Save Checkpoints** - Automatically saves session checkpoint every 5 minutes during active sessions
- **Session Recovery** - Protects against data loss if session ends unexpectedly
- **Configurable Interval** - Set via `auto_save.interval_minutes` in config

#### Cloud Sync (Pro Feature)
- **S3-Compatible Storage** - Sync sessions to AWS S3, Cloudflare R2, or Backblaze B2
- **End-to-End Encryption** - AES-256-GCM encryption for all cloud-stored data
- **Cross-Device Sync** - Access sessions from multiple devices with unique device IDs
- **Automatic Upload** - Optionally sync sessions on save via `cloud.sync_on_save`
- **Key Management** - Auto-generated encryption keys with fingerprint verification

### Changed
- Added `region` field to CloudConfig for S3/B2 compatibility
- Session-end hook now triggers cloud sync when enabled

### Technical Details
- New dependency: `@aws-sdk/client-s3` for cloud storage
- New modules: `src/sync/encryption.ts`, `src/sync/cloud.ts`
- Added 37 new tests for encryption and cloud sync (total: 80 tests)

---

## [1.0.0] - 2025-01-14

### Added

#### Core Features
- **Session Memory Storage** - Automatically saves Claude Code sessions to a local SQLite database
- **AI-Powered Summaries** - Generates intelligent summaries of sessions using Claude Haiku or Sonnet
- **Extended Retention** - Keep sessions for 1 year or forever (vs Claude's default 30 days)
- **Full-Text Search** - Search across all sessions using SQLite FTS5
- **Task Extraction** - Automatically extracts TODO items and tasks from conversations

#### Commands
- `/sessions` - Show summary of the last session in the current project
- `/sessions:search <query>` - Search across all saved sessions with optional filters
- `/sessions:resume [session-id]` - Resume a session with full context restoration
- `/sessions:list` - Browse all saved sessions with pagination
- `/sessions:export [session-id]` - Export session to markdown or JSON format
- `/sessions:settings` - View and configure memory settings

#### Hooks
- **SessionStart Hook** - Shows last session summary when starting Claude Code
- **SessionEnd Hook** - Automatically saves session with AI summary on exit

#### Configuration
- YAML-based configuration at `~/.cc-sessions/config.yml`
- Retention policies: 7d, 30d, 90d, 1y, 2y, 5y, or forever
- Project-specific overrides for retention and sync settings
- Configurable summary model (Haiku for speed, Sonnet for quality)

#### Storage & Retention
- **SQLite Database** - Efficient local storage with full-text search
- **Retention Manager** - Automatic archival and cleanup based on retention policy
- **Compression** - Old sessions compressed to `.gz` archives
- **Claude Retention Override** - Option to extend Claude's default 30-day log retention

#### Developer Features
- TypeScript implementation with full type definitions
- Programmatic API for accessing sessions
- CLI tool (`cc-sessions`) for command-line access
- Comprehensive test suite (43 tests)

### Technical Details

#### Dependencies
- `better-sqlite3` - SQLite database with FTS5 support
- `@anthropic-ai/sdk` - Claude API for AI summaries
- `yaml` - Configuration file parsing
- `glob` - File pattern matching
- `commander` - CLI framework

#### Data Storage
- Sessions stored in `~/.cc-sessions/index.db`
- Archives stored in `~/.cc-sessions/archive/`
- Configuration in `~/.cc-sessions/config.yml`

---

## Future Roadmap

### Planned for v1.2
- Team features with shared sessions
- Handoff notes for collaboration
- Session templates
- Advanced search filters

### Planned for v1.3
- Session analytics and insights
- Token usage tracking and budgeting
- Export to Notion/Obsidian
- Webhook integrations
