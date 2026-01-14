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
│   ├── hooks.json        # Hook configuration
│   ├── session-start.ts  # Shows last session on startup
│   └── session-end.ts    # Saves session on exit
└── src/                  # Core implementation
```

### Session Lifecycle

1. **SessionStart Hook** - When you start Claude Code, cc-sessions shows your last session summary
2. **SessionEnd Hook** - When you end the session, a full summary is generated and saved

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
import { SessionStore, loadConfig, parseLogFile } from '@iam-dev/cc-sessions';

// Load config
const config = await loadConfig();

// Access sessions
const store = new SessionStore();
const lastSession = store.getLastForProject('/path/to/project');
const searchResults = store.search('authentication');

// Parse a log file
const parsed = parseLogFile('/path/to/session.jsonl');

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

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) first.

## Support

- **Issues:** [GitHub Issues](https://github.com/iam-dev/cc-sessions/issues)
- **Discussions:** [GitHub Discussions](https://github.com/iam-dev/cc-sessions/discussions)

---

Made with Claude Code.
