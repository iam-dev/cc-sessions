---
name: sessions:settings
description: Configure session memory settings
allowed-tools: Bash, Read, Write
---

# Memory Settings

View and modify cc-sessions configuration.

## Instructions

When the user runs `/sessions:settings`:

1. Run the cc-sessions settings command to display current configuration:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" settings
```

2. If the user wants to change a setting, help them edit `~/.cc-sessions/config.yml`

## Output Format

```
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION MEMORY SETTINGS                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  RETENTION                                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Full sessions:    {currentValue}                        │   │
│  │                   Options: 7d, 30d, 90d, 1y, forever    │   │
│  │ Archives:         {currentValue}                        │   │
│  │ Max storage:      {currentValue} GB                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  AUTO-SAVE                                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [x] Auto-save sessions on exit                          │   │
│  │ [x] Generate AI summaries                               │   │
│  │ [x] Extract tasks automatically                         │   │
│  │ [x] Show last session on start                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  AI SUMMARIES                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Model: {haiku/sonnet}                                   │   │
│  │        haiku: Fast, cheap (~$0.001/summary)             │   │
│  │        sonnet: Better quality (~$0.01/summary)          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  STORAGE STATUS                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Sessions saved:    {count}                              │   │
│  │ Storage used:      {usedMB} MB / {maxGB} GB             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Config file: ~/.cc-sessions/config.yml
```

## Retention Options Reference

| Option | Description | Recommended For |
|--------|-------------|-----------------|
| 7d | 7 days | Minimal storage, experiments |
| 30d | 30 days | Claude default |
| 90d | 90 days | Short-term projects |
| 180d | 6 months | Medium-term projects |
| 1y | 1 year | Most users (recommended) |
| 2y | 2 years | Long-term projects |
| 5y | 5 years | Enterprise/compliance |
| forever | Never delete | Maximum history |

## Modify Settings

To modify a setting, edit the config file directly:

```yaml
# ~/.cc-sessions/config.yml

# Keep sessions for 2 years instead of 1
retention:
  full_sessions: 2y

# Disable AI summaries to reduce API costs
auto_save:
  generate_summary: false

# Use Sonnet for better quality summaries
summaries:
  model: sonnet
```

After editing, changes take effect on next session.
