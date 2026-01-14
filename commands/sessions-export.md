---
name: sessions:export
description: Export session to markdown or JSON format
allowed-tools: Bash, Write
---

# Export Session

Export a session memory to markdown or JSON format.

## Usage Examples

```
/sessions:export
/sessions:export mem_abc123_xyz789
/sessions:export --format json
/sessions:export --format md --output ./session-notes.md
```

## Instructions

When the user runs `/sessions:export`, execute via CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" export $ARGUMENTS
```

Arguments:
- `$1` - Session ID (optional, defaults to last session)
- `--format` - Export format: md (markdown) or json (default: md)
- `--output` - Output file path (prints to console if not specified)

## Markdown Export Format

```markdown
# Session: {summary}

**Project:** {projectPath}
**Date:** {date}
**Duration:** {duration}
**Tokens Used:** {tokensUsed}

## Summary

{description}

## Tasks

### Completed
- [x] {task 1}
- [x] {task 2}

### Pending
- [ ] {task 1}
- [ ] {task 2}

## Files Modified

### Created
- `{file1.ts}`
- `{file2.ts}`

### Modified
- `{file3.ts}`

## Key Decisions

- {decision 1}
- {decision 2}

## Suggested Next Steps

1. {step 1}
2. {step 2}

---

*Exported from cc-sessions on {exportDate}*
*Session ID: {sessionId}*
```

## JSON Export Format

```json
{
  "id": "mem_abc123_xyz789",
  "projectPath": "/Users/you/projects/myapp",
  "projectName": "myapp",
  "startedAt": "2025-01-12T15:30:00Z",
  "endedAt": "2025-01-12T16:15:00Z",
  "duration": 45,
  "summary": "Implemented user authentication system",
  "description": "Added login, registration, and password reset flows...",
  "tasks": [
    {"description": "Create login form", "status": "completed"},
    {"description": "Add form validation", "status": "pending"}
  ],
  "filesCreated": ["src/auth/Login.tsx"],
  "filesModified": ["src/App.tsx"],
  "tokensUsed": 125000,
  "tags": ["authentication", "react"]
}
```

## Success Message

When writing to file:

```
Session exported successfully!

File: {outputPath}
Format: {format}

Session: {summary}
From: {date}
```

## Error Messages

Session not found:
```
Session not found: {session_id}

Use /sessions:list to see available sessions.
```
