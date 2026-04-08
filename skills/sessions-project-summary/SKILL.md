---
name: sessions-project-summary
description: Generate a high-level project summary by analyzing all saved sessions for the current project. Use when the user wants an overview of work done across multiple sessions.
allowed-tools: Bash
---

Fetch all sessions for the current project:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" list --limit 9999
```

Then, using the session data returned, write a project summary covering:

## Project Summary Format

```
PROJECT SUMMARY: {projectName}
═══════════════════════════════════════════════════════════════

OVERVIEW
{2-3 sentence description of what this project is and what has been built}

WORK COMPLETED
- {major feature or milestone 1}
- {major feature or milestone 2}
- {major feature or milestone 3}

IN PROGRESS / PENDING
- {unfinished task 1}
- {unfinished task 2}

KEY DECISIONS
- {architectural or design decision 1}
- {architectural or design decision 2}

FILES MOST TOUCHED
- {file1} — {reason}
- {file2} — {reason}

SESSIONS
  Total: {count} sessions
  First: {date of first session}
  Latest: {date of most recent session}
  Total tokens: {sum}

SUGGESTED NEXT STEPS
1. {next step 1}
2. {next step 2}
═══════════════════════════════════════════════════════════════
```

Synthesize the summary yourself from the session data — do not just list sessions. Group related work, identify patterns, and surface what matters most.
