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
- **Cloud Sync** - Sync sessions across devices with end-to-end encryption (Pro)

## Quick Start

```bash
# Clone and install
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

## Commands Overview

| Command | Description |
|---------|-------------|
| `/sessions` | Show last session summary |
| `/sessions:search <query>` | Search across all sessions |
| `/sessions:resume [id]` | Resume a session with context |
| `/sessions:list` | Browse all saved sessions |
| `/sessions:export` | Export to markdown/JSON |
| `/sessions:settings` | Configure memory settings |

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
- [Changelog](https://github.com/iam-dev/cc-sessions/blob/main/CHANGELOG.md)

## License

MIT License - see [LICENSE](https://github.com/iam-dev/cc-sessions/blob/main/LICENSE) for details.
