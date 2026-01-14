---
name: sessions:search
description: Search across all saved sessions
allowed-tools: Bash
---

# Search Sessions

Full-text search across all saved session memories.

## Usage Examples

```
/sessions:search authentication
/sessions:search "bug fix" --project ./myapp
/sessions:search refactor --from "last month"
```

## Instructions

When the user runs `/sessions:search <query>`, execute the search via CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" search "$ARGUMENTS"
```

Parse arguments from user input:
- `$1` - The search query (required)
- `--project` - Limit search to specific project path
- `--from` - Start date filter
- `--to` - End date filter

## Output Format

```
Search: "{query}"
Found {count} sessions:

┌─────────────────────────────────────────────────────────────────┐
│ 1. {summary}                                                    │
│    {date} - {duration} - {tokens} tokens - {project}            │
│    "...matched text with highlights..."                         │
├─────────────────────────────────────────────────────────────────┤
│ 2. {summary}                                                    │
│    {date} - {duration} - {tokens} tokens - {project}            │
│    "...matched text with highlights..."                         │
└─────────────────────────────────────────────────────────────────┘

Enter number to view details, or use /sessions:resume <id> to resume.
```

## No Results Message

```
Search: "{query}"

No sessions found matching your search.

Suggestions:
- Try broader search terms
- Check spelling
- Remove date filters to search all time
- Use /sessions:list to browse all sessions
```

## Search Tips

- Search is case-insensitive
- Partial word matches are supported
- Multiple words are treated as AND (all must match)
- Use quotes for exact phrases: "user authentication"
- Search covers: summary, description, tasks, files, messages
