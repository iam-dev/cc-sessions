---
layout: default
title: Configuration
nav_order: 4
---

# Configuration

cc-sessions is configured via a YAML file at `~/.cc-sessions/config.yml`.

## Default Configuration

```yaml
# Session Memory Configuration
version: 1

retention:
  # How long to keep full session data
  # Options: 7d, 30d, 90d, 180d, 1y, 2y, 5y, forever
  full_sessions: 1y

  # How long to keep compressed archives
  archives: forever

  # How long to keep search index
  search_index: forever

  # Override Claude's default 30-day deletion
  override_claude_retention: true

  # Maximum storage size in GB
  max_storage_gb: 10

auto_save:
  # Enable automatic session saving
  enabled: true

  # Periodic save interval (minutes)
  interval_minutes: 5

  # Save on session end
  on_session_end: true

  # Save on terminal close (best effort)
  on_terminal_close: true

  # Generate AI summary
  generate_summary: true

  # Extract tasks from conversation
  extract_tasks: true

summaries:
  # Model for generating summaries
  # haiku: Fast, cheap (~$0.001 per summary)
  # sonnet: Better quality (~$0.01 per summary)
  model: haiku

  # Maximum summary length (tokens)
  max_length: 500

  # What to include in summaries
  include:
    - description
    - tasks_completed
    - tasks_pending
    - files_modified
    - next_steps
    - key_decisions
    - blockers

search:
  # Enable full-text search
  enabled: true

  # Fields to index
  index_fields:
    - summary
    - tasks
    - files
    - user_messages
    - assistant_messages

  # Fuzzy matching threshold (0-1)
  fuzzy_threshold: 0.7

cloud:
  # Enable cloud sync (Pro feature)
  enabled: false

  # Provider: r2, s3, or b2
  provider: r2

  # Bucket name
  # bucket: my-sessions-bucket

  # Credentials
  # access_key_id: YOUR_ACCESS_KEY
  # secret_access_key: YOUR_SECRET_KEY

  # Custom endpoint (for R2/B2)
  # endpoint: https://account.r2.cloudflarestorage.com

  # Region (for S3/B2)
  region: auto

  # Encryption key (auto-generated if not set)
  # encryption_key: YOUR_HEX_KEY

  # Sync interval (minutes)
  sync_interval_minutes: 30

  # Sync immediately on save
  sync_on_save: true

  # Unique device identifier
  device_id: auto

ui:
  # Show last session on startup
  show_on_start: true

  # Number of recent sessions in list
  recent_count: 10

  # Date format
  date_format: "MMM D, YYYY h:mm A"

  # Color theme: auto, dark, light
  theme: auto

projects:
  # Project-specific overrides
  overrides:
    # Example: Keep client work longer
    # /Users/you/work/client-project:
    #   retention: 2y
    #   cloud_sync: true

    # Example: Short retention for experiments
    # /Users/you/experiments:
    #   retention: 7d
    #   generate_summary: false
```

## Configuration Sections

### Retention

Controls how long sessions are kept.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `full_sessions` | string | `1y` | How long to keep full session data |
| `archives` | string | `forever` | How long to keep compressed archives |
| `search_index` | string | `forever` | How long to keep search index |
| `override_claude_retention` | boolean | `true` | Extend Claude's 30-day limit |
| `max_storage_gb` | number | `10` | Maximum storage in GB |

**Retention values:** `7d`, `14d`, `30d`, `90d`, `180d`, `1y`, `2y`, `5y`, `forever`

### Auto-Save

Controls automatic session saving.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable auto-save |
| `interval_minutes` | number | `5` | Periodic checkpoint interval |
| `on_session_end` | boolean | `true` | Save when session ends |
| `on_terminal_close` | boolean | `true` | Save on terminal close |
| `generate_summary` | boolean | `true` | Generate AI summary |
| `extract_tasks` | boolean | `true` | Extract TODO items |

### Summaries

Controls AI summary generation.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `model` | string | `haiku` | Model: `haiku` or `sonnet` |
| `max_length` | number | `500` | Max summary tokens |
| `include` | array | (see default) | What to include |

**Model comparison:**

| Model | Speed | Cost | Quality |
|-------|-------|------|---------|
| `haiku` | Fast | ~$0.001/summary | Good |
| `sonnet` | Slower | ~$0.01/summary | Better |

### Search

Controls full-text search.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable FTS search |
| `index_fields` | array | (see default) | Fields to index |
| `fuzzy_threshold` | number | `0.7` | Fuzzy match threshold |

### Cloud

See [Cloud Sync](cloud-sync.html) for detailed cloud configuration.

### UI

Controls display preferences.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `show_on_start` | boolean | `true` | Show last session on startup |
| `recent_count` | number | `10` | Sessions in list view |
| `date_format` | string | `"MMM D, YYYY h:mm A"` | Date display format |
| `theme` | string | `auto` | Theme: `auto`, `dark`, `light` |

### Projects

Override settings for specific projects.

```yaml
projects:
  overrides:
    /path/to/project:
      retention: 2y
      cloud_sync: true
      generate_summary: false
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CC_MEMORY_DEBUG` | Enable debug logging |
| `CC_SESSIONS_CONFIG` | Custom config file path |

## Examples

### Minimal Storage

```yaml
retention:
  full_sessions: 7d
  archives: 30d
  max_storage_gb: 2

auto_save:
  generate_summary: false
```

### Maximum Retention

```yaml
retention:
  full_sessions: forever
  archives: forever
  max_storage_gb: 50

summaries:
  model: sonnet
```

### Cloud-First

```yaml
cloud:
  enabled: true
  provider: r2
  bucket: my-sessions
  sync_on_save: true

retention:
  full_sessions: 30d  # Local cache only
```
