# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
