# cc-sessions

**Never lose context again.** Smart session memory with extended retention for Claude Code.

Pick up exactly where you left off - even months later.

## Features

- **Automatic Session Saving** - Sessions are saved automatically when you end a Claude Code session
- **AI-Powered Summaries** - Intelligent summaries of what you worked on, tasks completed, and next steps
- **Extended Retention** - Keep sessions for 1 year or forever (vs Claude's default 30 days)
- **Full-Text Search** - Search across all your sessions by keywords, files, or tasks
- **Smart Resume** - Resume any session with full context restoration
- **Cross-Project Memory** - Access memories from any project
- **Periodic Auto-Save** - Checkpoint saves every 5 minutes protect against data loss
- **Pre-Clear Snapshots** - Save before `/clear` with `cc-sessions save` or `/sessions:clear`; auto-snapshot on `/clear` via the SessionStart hook; auto-snapshot on compaction via the Notification hook
- **Resume in Claude Code** - Every session shows the exact `claude --resume <id>` command so you can reopen it at any point
- **Message Thread Viewer** - Click the "💬 N messages" badge in any session detail view to expand the full conversation thread inline
- **Session Health Scores** - Green/yellow/red health indicators on every session and project card, scored by blocker count and task completion; recurring blockers surfaced automatically at the project level
- **Claude Code Memory** - Browse, search, and edit Claude Code's auto-memory files and `CLAUDE.md` directly in the UI; changes write back to disk instantly
- **Cloud Sync (Pro)** - Sync sessions across devices with end-to-end encryption

## Installation

### Option 1: Install as Claude Code Plugin (Recommended)

**Via Plugin Marketplace:**

If this plugin is available in a marketplace you have configured:

```bash
/plugin install cc-sessions@marketplace-name
```

**Local Installation:**

```bash
# Clone the plugin
git clone https://github.com/iam-dev/cc-sessions.git ~/.cc-sessions-plugin

# Install dependencies and build
cd ~/.cc-sessions-plugin
npm install
npm run build

# Start Claude Code with the plugin
claude --plugin-dir ~/.cc-sessions-plugin
```

**Load automatically in all sessions:**

Add to your Claude Code settings:

```json
// ~/.claude/settings.json or .claude/settings.json (project-level)
{
  "plugins": ["~/.cc-sessions-plugin"]
}
```

### Option 2: Install as NPM Package

```bash
# Install globally for CLI commands
npm install -g @iam-dev/cc-sessions
```

This gives you access to CLI commands (`cc-sessions show`, `cc-sessions list`, etc.) but requires manual setup for hooks.

## Quick Start

After installing as a plugin, cc-sessions works automatically:

1. **Start a Claude Code session** - Work on your project as usual
2. **End the session** - Your context is automatically saved
3. **Come back later** - Run `/sessions` to see your last session

## Commands

### `/sessions`
Show summary of the last session in this project.

```
/sessions
```

### `/sessions:search <query>`
Search across all saved sessions.

```
/sessions:search authentication
/sessions:search "bug fix" --project ./myapp
/sessions:search refactor --from "last month"
```

### `/sessions:resume [session-id]`
Resume a session with full context restoration.

```
/sessions:resume
/sessions:resume mem_abc123_xyz789
```

### `/sessions:list`
Browse all saved sessions.

```
/sessions:list
/sessions:list --project ./myapp
/sessions:list --limit 20
/sessions:list --all  # Include archived
```

### `/sessions:export [session-id]`
Export session to markdown or JSON.

```
/sessions:export
/sessions:export --format json
/sessions:export --output ./notes.md
```

### `/sessions:settings`
View and configure memory settings.

```
/sessions:settings
```

### `/sessions:snapshot`
Save the current session immediately — use this before running `/clear` to preserve your context.

```
/sessions:snapshot
```

Runs `cc-sessions save` and shows the result. Requires the skill file at `~/.claude/skills/sessions-snapshot.md` (installed automatically when you run `cc-sessions save` for the first time, or manually via the hook setup below).

### `/sessions:clear`
Save the current session with a full AI summary, then clear context.

```
/sessions:clear
```

Runs `cc-sessions save`, reports the saved session ID, then runs `/clear`. If the save fails, warns the user before clearing. Use this instead of `/clear` when you want to preserve your session.

### `/sessions:import`
Import all Claude Code CLI sessions from `~/.claude/projects/` with AI-generated summaries.

```
/sessions:import
/sessions:import --limit 9999
/sessions:import --no-ai
/sessions:import --since 2025-01-01
/sessions:import --dry-run
```

Runs `cc-sessions import` with any arguments you pass. Use `--limit 9999` to import your full history.

### `/sessions:summarize`
Regenerate AI-powered summaries for sessions that only have rule-based summaries.

```
/sessions:summarize
/sessions:summarize --all
/sessions:summarize --all --limit 9999
/sessions:summarize mem_abc123_xyz789
```

Without `--all`, only sessions tagged `no-ai-summary` are processed. Use `--all` to force-regenerate every session.

## Snapshots & Resume

### Save before `/clear`

Before clearing context, snapshot the current session so you can resume it later:

```bash
cc-sessions save
```

Output:
```
✅ Session saved: abc123-def456 (pre-clear snapshot)
```

The session appears in the UI with a 📌 snapshot badge. To resume it in Claude Code:

```bash
claude --resume abc123-def456
```

The `claude --resume` command is also shown with a copy button in the session detail view of the Sessions Browser UI.

### Auto-save on `/clear`

Register the SessionStart hook to automatically save the cleared session whenever you type `/clear`:

```json
// ~/.claude/settings.json
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

Sessions saved this way are tagged `pre-clear` (🗑️ badge in the UI). This is set up automatically when using the plugin.

### Auto-snapshot on compaction

Register the Notification hook to automatically save a snapshot whenever Claude Code compacts context:

```json
// ~/.claude/settings.json
{
  "hooks": {
    "Notification": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "cc-sessions notify" }] }
    ]
  }
}
```

Auto-snapshotted sessions are tagged `pre-compact` (📸 badge in the UI). The hook always exits 0 and never interrupts your session. Enable debug output with `CC_MEMORY_DEBUG=1`.

---

## Retroactive Summary Upgrade

After importing, sessions without AI access at import time are tagged `no-ai-summary`. Upgrade them once AI is available:

```bash
cc-sessions summarize              # upgrade all no-ai-summary sessions (default)
cc-sessions summarize --all        # force-regenerate every session
cc-sessions summarize --no-ai      # rule-based only (no AI)
cc-sessions summarize --limit 20   # cap sessions processed
```

The provider chain tries in order: **CC CLI** (`claude` binary) → **Anthropic API** (`ANTHROPIC_API_KEY`) → **rule-based fallback**.

---

## Importing Existing Sessions

If you have existing Claude Code CLI sessions in `~/.claude/projects/`, import them all with:

```bash
cc-sessions import --limit 9999
```

> **Important:** The default `--limit` is 100. Always pass `--limit 9999` (or higher) to import your full history.

```bash
# Preview what would be imported (dry run)
cc-sessions import --dry-run --limit 9999

# Import only a specific project
cc-sessions import --project ./myapp --limit 9999

# Import without AI summaries (faster)
cc-sessions import --no-ai --limit 9999

# Import sessions since a date
cc-sessions import --since 2026-01-01 --limit 9999
```

Re-running import is always safe — sessions already in the database are automatically skipped.

## Claude Code Memory

cc-sessions indexes Claude Code's two built-in memory sources and makes them browsable and editable in the Sessions Browser UI.

### What gets indexed

| Source | Location | Description |
|--------|----------|-------------|
| Auto-memory | `~/.claude/projects/<encoded>/memory/*.md` | Typed entries (`user`, `feedback`, `project`, `reference`) Claude creates during sessions |
| CLAUDE.md | `<project>/CLAUDE.md` or `<project>/.claude/CLAUDE.md` | Project-level instructions file |

### Memory sidebar

Click **Memory** in the sidebar to search across all indexed memory entries from every project. Results are highlighted with the matching terms.

### Project Memory tab

Open any project and click the **Memory** tab to see:

- **Auto-memory cards** — each entry is editable inline (name, description, body); click **Save** to write back to disk
- **CLAUDE.md editor** — raw textarea for the project's CLAUDE.md; saves on click
- **Sync** — re-indexes the project's memory files on demand
- **Create CLAUDE.md** — creates a new CLAUDE.md at the project root if one doesn't exist yet

### How sync works

Memory files are synced lazily: cc-sessions compares the on-disk `mtime` against the stored value and only re-reads files that have changed. A full sync can be triggered via the Sync button or the REST API.

### REST API

```
GET  /api/memory?project=<path>           # all entries for a project
GET  /api/memory/search?q=<query>         # full-text search (all projects)
GET  /api/memory/:id                      # single entry
PUT  /api/memory/:id                      # update name / description / body
POST /api/memory/sync                     # sync a project { projectPath }
POST /api/memory/create-claude-md         # create CLAUDE.md { projectPath, content }
```

---

## Configuration

Configuration is stored in `~/.cc-sessions/config.yml`:

```yaml
# Session Memory Configuration
version: 1

retention:
  # How long to keep full session data
  # Options: 7d, 30d, 90d, 180d, 1y, 2y, 5y, forever
  full_sessions: 1y

  # How long to keep compressed archives
  archives: forever

  # Override Claude's default 30-day deletion
  override_claude_retention: true

  # Maximum storage size (GB)
  max_storage_gb: 10

auto_save:
  enabled: true
  interval_minutes: 5
  generate_summary: true
  extract_tasks: true

summaries:
  # Model for generating summaries
  # haiku: Fast, cheap (~$0.001 per summary)
  # sonnet: Better quality (~$0.01 per summary)
  model: haiku

ui:
  show_on_start: true
  recent_count: 10
```

## How It Works

### Plugin Structure

cc-sessions is a Claude Code plugin with the following structure:

```
cc-sessions/
├── .claude-plugin/
│   └── plugin.json       # Plugin manifest
├── commands/             # Slash commands (/sessions, /sessions:search, etc.)
├── hooks/
│   ├── hooks.json         # Hook configuration
│   ├── session-start.ts   # Shows last session on startup
│   ├── session-end.ts     # Saves session on exit
│   ├── periodic-save.ts   # Auto-saves every 5 minutes
│   ├── notification.ts    # Auto-snapshots on compaction (Notification hook)
│   └── snapshot.ts        # Shared saveSnapshot() helper
└── src/                  # Core implementation
```

### Session Lifecycle

1. **SessionStart Hook** — When you start Claude Code, cc-sessions shows your last session summary
2. **Periodic Save Hook** — Every 5 minutes, a checkpoint is saved to protect against data loss
3. **Notification Hook** — When Claude Code compacts context, a pre-compact snapshot is auto-saved (requires hook registration)
4. **Manual Snapshot** — Run `cc-sessions save` (or `/sessions:clear`) before `/clear` to preserve context; the SessionStart hook also auto-saves when `/clear` fires
5. **SessionEnd Hook** — When you end the session, a full summary is generated and saved
6. **Resume** — Use `claude --resume <id>` (shown in the UI) to reopen any saved session

### Data Storage

- **SQLite Database** - Sessions are stored in `~/.cc-sessions/index.db`
- **Full-Text Search** - FTS5 index for fast searching across all sessions
- **Compressed Archives** - Old sessions are compressed to save space

### Claude Log Integration

cc-sessions reads Claude Code's JSONL logs from `~/.claude/projects/` and extracts:
- User messages and assistant responses
- Tool calls (files created, modified, deleted)
- Token usage
- Session duration

## Retention Policies

| Option | Duration | Best For |
|--------|----------|----------|
| `7d` | 7 days | Experiments, temporary projects |
| `30d` | 30 days | Claude default |
| `90d` | 90 days | Short-term projects |
| `1y` | 1 year | **Recommended** for most users |
| `forever` | Never delete | Maximum history |

## Cloud Sync (Pro Feature)

Sync your sessions across devices with end-to-end encryption.

### Supported Providers

| Provider | Description |
|----------|-------------|
| **Cloudflare R2** | S3-compatible, no egress fees |
| **AWS S3** | Industry standard cloud storage |
| **Backblaze B2** | Low-cost storage option |

### Configuration

Add to your `~/.cc-sessions/config.yml`:

```yaml
cloud:
  enabled: true
  provider: r2  # or s3, b2
  bucket: my-sessions-bucket
  endpoint: https://ACCOUNT_ID.r2.cloudflarestorage.com
  access_key_id: YOUR_ACCESS_KEY
  secret_access_key: YOUR_SECRET_KEY
  encryption_key: YOUR_256_BIT_HEX_KEY  # Auto-generated if not set
  sync_on_save: true
```

### Security

- All data is encrypted client-side using **AES-256-GCM**
- Encryption key never leaves your device
- Each device gets a unique identifier for sync

See [Cloud Sync Documentation](https://iam-dev.github.io/cc-sessions/cloud-sync.html) for detailed setup instructions.

## Troubleshooting

### Sessions not being saved?

1. Check that cc-sessions plugin is loaded: ensure `--plugin-dir` is set or plugin is in settings
2. Verify the config file exists: `cat ~/.cc-sessions/config.yml`
3. Check that `auto_save.enabled` is `true`

### Search not finding results?

- Search is case-insensitive
- Try broader search terms
- Use `/sessions:list` to browse all sessions

### Storage growing too large?

1. Lower retention: `retention.full_sessions: 30d`
2. Lower max storage: `retention.max_storage_gb: 5`
3. Manually run cleanup by editing and saving config

## API Usage

You can also use cc-sessions programmatically:

```typescript
import { SessionStore, loadConfig, parseLogFile, CloudSync } from '@iam-dev/cc-sessions';

// Load config
const config = await loadConfig();

// Access sessions
const store = new SessionStore();
const lastSession = store.getLastForProject('/path/to/project');
const searchResults = store.search('authentication');

// Parse a log file
const parsed = parseLogFile('/path/to/session.jsonl');

// Cloud sync (Pro)
if (config.cloud.enabled) {
  const cloudSync = new CloudSync(config.cloud);
  await cloudSync.sync(store);
}

store.close();
```

## Development

```bash
# Clone the repo
git clone https://github.com/iam-dev/cc-sessions.git
cd cc-sessions

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint
```

## Documentation

Full documentation is available at **[iam-dev.github.io/cc-sessions](https://iam-dev.github.io/cc-sessions/)**

- [Installation Guide](https://iam-dev.github.io/cc-sessions/installation.html)
- [Command Reference](https://iam-dev.github.io/cc-sessions/commands.html)
- [Configuration](https://iam-dev.github.io/cc-sessions/configuration.html)
- [Cloud Sync Setup](https://iam-dev.github.io/cc-sessions/cloud-sync.html)
- [API Reference](https://iam-dev.github.io/cc-sessions/api.html)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) first.

## Support

- **Issues:** [GitHub Issues](https://github.com/iam-dev/cc-sessions/issues)
- **Discussions:** [GitHub Discussions](https://github.com/iam-dev/cc-sessions/discussions)

---

Made with Claude Code.
