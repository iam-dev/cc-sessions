---
layout: default
title: Installation
nav_order: 2
---

# Installation

## Option 1: Install as Claude Code Plugin (Recommended)

### Local Installation

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

### Load Automatically in All Sessions

Add to your Claude Code settings file:

**Global settings** (`~/.claude/settings.json`):
```json
{
  "plugins": ["~/.cc-sessions-plugin"]
}
```

**Project-level settings** (`.claude/settings.json` in your project):
```json
{
  "plugins": ["~/.cc-sessions-plugin"]
}
```

## Option 2: Install as NPM Package

```bash
# Install globally
npm install -g @iam-dev/cc-sessions
```

This gives you access to CLI commands but requires manual setup for hooks.

### CLI Usage

```bash
# Show last session
cc-sessions show

# List all sessions
cc-sessions list

# Search sessions
cc-sessions search "authentication"

# Export a session
cc-sessions export <session-id> --format md
```

## Verify Installation

After installation, start a new Claude Code session and you should see:

```
cc-sessions: Plugin loaded
```

Run `/sessions` to verify the plugin is working:

```
/sessions
```

If no previous sessions exist, you'll see a message indicating that. After your first session ends, the memory will be saved automatically.

## Requirements

- **Node.js** 18.0.0 or higher
- **Claude Code** CLI installed
- **npm** or **yarn** package manager

## Troubleshooting

### Plugin not loading?

1. Check the plugin path is correct:
   ```bash
   ls ~/.cc-sessions-plugin/dist/index.js
   ```

2. Verify the build succeeded:
   ```bash
   cd ~/.cc-sessions-plugin && npm run build
   ```

3. Check Claude Code is using the plugin:
   ```bash
   claude --plugin-dir ~/.cc-sessions-plugin --help
   ```

### Sessions not being saved?

1. Check that auto-save is enabled:
   ```bash
   cat ~/.cc-sessions/config.yml | grep enabled
   ```

2. Verify the config file exists:
   ```bash
   ls -la ~/.cc-sessions/config.yml
   ```

3. Check for errors in the session end hook:
   ```bash
   CC_MEMORY_DEBUG=true claude --plugin-dir ~/.cc-sessions-plugin
   ```

### Database errors?

1. Check database exists:
   ```bash
   ls -la ~/.cc-sessions/index.db
   ```

2. Verify SQLite is working:
   ```bash
   sqlite3 ~/.cc-sessions/index.db "SELECT COUNT(*) FROM sessions;"
   ```

## Updating

To update to the latest version:

```bash
cd ~/.cc-sessions-plugin
git pull
npm install
npm run build
```

## Uninstalling

1. Remove the plugin directory:
   ```bash
   rm -rf ~/.cc-sessions-plugin
   ```

2. Remove from Claude Code settings (if added)

3. Optionally remove saved data:
   ```bash
   rm -rf ~/.cc-sessions
   ```
