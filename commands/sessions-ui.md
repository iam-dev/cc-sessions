---
name: sessions:ui
description: Open the sessions browser UI — a claude.ai-style project/session explorer in your browser
allowed-tools: Bash
---

# Sessions Browser UI

Open a local web UI that displays all session memories organised by project,
styled like the claude.ai Projects page.

## Usage

```
/sessions:ui
/sessions:ui --port 3457
/sessions:ui --no-open
```

## Instructions

When the user runs `/sessions:ui`, start the UI server via the CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" ui $ARGUMENTS
```

Arguments:
- `--port <number>` — Port to listen on (default: 3456)
- `--no-open`       — Print the URL but do not auto-open the browser

## What the UI provides

- **Projects view** — Grid of project cards (like claude.ai/projects)
  Each card shows: project name, last session summary, last activity time, session count.
- **Session list** — Clicking a project shows its sessions in a list view.
- **Session detail** — Full session detail: summary, tasks, files created/modified,
  key decisions, next steps, blockers, and token usage.
- **All Sessions** — Flat list of all sessions across every project.
- **Search** — Type in the sidebar to full-text-search across all sessions.
- **Filter & sort** — Filter projects by name/summary; sort by activity, name, or count.

## Output Format

```
CC Sessions UI running at http://127.0.0.1:3456
Press Ctrl+C to stop.
```

The browser opens automatically unless `--no-open` is passed.

## Stopping the server

Press `Ctrl+C` in the terminal to stop the server cleanly.
