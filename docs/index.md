---
layout: default
title: Home
nav_order: 1
---

# cc-sessions

**Never lose context again.** Smart session memory with extended retention for Claude Code.

Pick up exactly where you left off - even months later.

## Features

- **Automatic Session Saving** - Sessions are saved automatically when you end a Claude Code session
- **AI-Powered Summaries** - Intelligent summaries of what you worked on, tasks completed, and next steps
- **Extended Retention** - Keep sessions for 1 year or forever (vs Claude's default 30 days)
- **Full-Text Search** - Search across all your sessions by keywords, files, or tasks
- **Smart Resume** - Resume any session with full context restoration
- **Sessions Browser UI** - Visual web interface to browse projects, sessions, and session details
- **Bulk Import** - Import all your existing Claude Code CLI sessions in one command
- **Cloud Sync** - Sync sessions across devices with end-to-end encryption (Pro)

## Quick Start

```bash
# Install via npm (recommended)
npm install -g @iam-dev/cc-sessions

# Or clone and build
git clone https://github.com/iam-dev/cc-sessions.git ~/.cc-sessions-plugin
cd ~/.cc-sessions-plugin
npm install && npm run build

# Start Claude Code with the plugin
claude --plugin-dir ~/.cc-sessions-plugin
```

After installing, cc-sessions works automatically:

1. **Start a Claude Code session** - Work on your project as usual
2. **End the session** - Your context is automatically saved
3. **Come back later** - Run `/sessions` to see your last session
4. **Import past sessions** - Run `cc-sessions import` to bring in all your existing Claude Code history
5. **Browse visually** - Run `/sessions:ui` to open the web UI

## Commands Overview

| Command | Description |
|---------|-------------|
| `/sessions` | Show last session summary |
| `/sessions:search <query>` | Search across all sessions |
| `/sessions:resume [id]` | Resume a session with context |
| `/sessions:list` | Browse all saved sessions |
| `/sessions:export` | Export to markdown/JSON |
| `/sessions:settings` | Configure memory settings |
| `/sessions:ui` | Open the visual Sessions Browser UI |

### CLI Commands

| Command | Description |
|---------|-------------|
| `cc-sessions ui` | Start the web UI server |
| `cc-sessions import --limit 9999` | Bulk-import **all** existing Claude Code sessions |
| `cc-sessions show` | Show last session |
| `cc-sessions list` | List all sessions |
| `cc-sessions search <query>` | Search sessions |
| `cc-sessions export <id>` | Export a session |

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLAUDE CODE CLI                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ~/.claude/projects/**/*.jsonl     (Raw logs)                   │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                  CC-SESSIONS PLUGIN                          ││
│  │                                                              ││
│  │  SessionStart ──▶ Show last session summary                 ││
│  │  SessionEnd   ──▶ Parse logs + AI summary + Save            ││
│  │  Periodic     ──▶ Auto-save checkpoint (every 5 min)        ││
│  │                                                              ││
│  │  Storage: ~/.cc-sessions/index.db (SQLite + FTS5)           ││
│  │  Archive: ~/.cc-sessions/archive/*.gz                        ││
│  │  Cloud:   S3/R2/B2 with E2E encryption                      ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Links

- [Installation Guide](installation.html)
- [Command Reference](commands.html)
- [Configuration](configuration.html)
- [Cloud Sync (Pro)](cloud-sync.html)
- [API Reference](api.html)
- [GitHub Repository](https://github.com/iam-dev/cc-sessions)
- [npm Package](https://www.npmjs.com/package/@iam-dev/cc-sessions)
- [Changelog](https://github.com/iam-dev/cc-sessions/blob/main/CHANGELOG.md)

## License

MIT License - see [LICENSE](https://github.com/iam-dev/cc-sessions/blob/main/LICENSE) for details.
