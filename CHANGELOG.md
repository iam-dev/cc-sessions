# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
