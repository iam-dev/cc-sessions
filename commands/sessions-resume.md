---
name: sessions:resume
description: Resume a session with full context restoration
allowed-tools: Bash, Read
---

# Smart Resume

Resume a previous session with AI-generated context summary.

## Usage Examples

```
/sessions:resume
/sessions:resume mem_abc123_xyz789
```

## Instructions

When the user runs `/sessions:resume [session_id]`:

1. Run the cc-sessions resume command to get session context:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" resume $ARGUMENTS
```

2. Display the session context summary
3. Use the returned context to continue the conversation

## Output Format - Confirmation

```
┌─────────────────────────────────────────────────────────────────┐
│  RESUMING SESSION                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Loading: "{summary}"                                           │
│  From: {date} at {time}                                         │
│  Project: {projectPath}                                         │
│                                                                 │
│  CONTEXT BEING RESTORED:                                        │
│                                                                 │
│  {description}                                                  │
│                                                                 │
│  Work completed:                                                │
│  - {completed task 1}                                           │
│  - {completed task 2}                                           │
│                                                                 │
│  Still pending:                                                 │
│  - {pending task 1}                                             │
│  - {pending task 2}                                             │
│                                                                 │
│  Files modified:                                                │
│  - {file1.ts}                                                   │
│  - {file2.ts}                                                   │
│                                                                 │
│  Your last message was:                                         │
│  "{lastUserMessage}"                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Ready to continue. What would you like to do next?
```

## Context Injection

After displaying the summary, use this context to continue the conversation:

```
This is a continuation of a previous session from {date}.

Project: {projectPath}
Previous work: {description}

Completed tasks:
{completedTasks}

Pending tasks:
{pendingTasks}

Files that were modified:
{filesModified}

Key decisions made:
{keyDecisions}

Suggested next steps:
{nextSteps}

The user's last message was: "{lastUserMessage}"
```

Continue from where the user left off.

## No Session Found

```
No session found to resume.

To resume a specific session:
1. Use /sessions:list to see all sessions
2. Note the session ID (e.g., mem_abc123_xyz789)
3. Run /sessions:resume <session_id>

Or use /sessions:search to find a specific session.
```

## Session Not Found by ID

```
Session not found: {session_id}

The session ID may be incorrect or the session may have been deleted.

Use /sessions:list to see available sessions.
```
