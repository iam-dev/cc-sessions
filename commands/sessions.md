---
name: sessions
description: Show summary of the last session in this project
allowed-tools: Bash, Read
---

# Session Memory

Display the last session summary for the current working directory.

## Instructions

When the user runs `/sessions`, use the cc-sessions CLI to retrieve and display the last session:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" show
```

## Output Format

Display the session information in this format:

```
┌─────────────────────────────────────────────────────────────────┐
│  LAST SESSION                                                   │
├─────────────────────────────────────────────────────────────────┤
│  Project:   {projectName}                                       │
│  When:      {relativeTime} ({duration})                         │
│  Tokens:    {tokensUsed}                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SUMMARY                                                        │
│  {summary text, wrapped to fit}                                 │
│                                                                 │
│  COMPLETED                                                      │
│  - {completed task 1}                                           │
│  - {completed task 2}                                           │
│                                                                 │
│  PENDING                                                        │
│  - {pending task 1}                                             │
│  - {pending task 2}                                             │
│                                                                 │
│  FILES MODIFIED                                                 │
│  - {file1.ts} (created)                                         │
│  - {file2.ts} (modified)                                        │
│                                                                 │
│  SUGGESTED NEXT STEPS                                           │
│  1. {next step 1}                                               │
│  2. {next step 2}                                               │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [/sessions:resume] Resume    [/sessions:search] Search         │
└─────────────────────────────────────────────────────────────────┘
```

## No Session Found Message

If no sessions exist for the current project:

```
No session memory found for this project.

Recent sessions from other projects:
- myapp: Implemented user authentication (2 hours ago)
- api: Fixed database connection pooling (yesterday)
- docs: Updated API documentation (3 days ago)

Use /sessions:list to browse all sessions.
```

## Empty State

If no sessions exist at all:

```
No session memories found.

Session memories are automatically saved when you end a Claude Code session.
Start working on a project and your context will be preserved.

Configure settings with /sessions:settings
```
