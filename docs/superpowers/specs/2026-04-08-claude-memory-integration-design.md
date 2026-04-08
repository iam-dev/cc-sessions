# Claude Code Memory Integration — Design Spec

**Date:** 2026-04-08
**Status:** Approved
**Project:** cc-sessions

---

## Overview

Integrate Claude Code's two memory sources into cc-sessions: the **auto-memory files** stored per-project at `~/.claude/projects/<encoded-path>/memory/` and **CLAUDE.md** files in project repositories. Memory entries are indexed in SQLite with FTS5 search, editable through the UI, and searchable both globally and per-project.

---

## Background

Claude Code maintains two kinds of persistent memory:

1. **Auto-memory files** — typed `.md` files at `~/.claude/projects/<encoded-path>/memory/`. Types: `user`, `feedback`, `project`, `reference`. Each file has YAML frontmatter (`name`, `description`, `type`) and a markdown body.
2. **CLAUDE.md** — a project-level instructions file at `<project_path>/CLAUDE.md` (also checked at `<project_path>/.claude/CLAUDE.md`). Contains freeform markdown; no frontmatter.

The encoded path for a project at `/Users/foo/bar` is `-Users-foo-bar` (leading `/` dropped, remaining `/` replaced with `-`).

---

## Data Model

### `memory_entries` table

```sql
CREATE TABLE memory_entries (
  id           TEXT PRIMARY KEY,  -- "<project_path>:<relative_file_path>"
  project_path TEXT NOT NULL,
  source       TEXT NOT NULL,     -- 'auto-memory' | 'claude-md'
  type         TEXT NOT NULL,     -- 'user'|'feedback'|'project'|'reference'|'claude-md'|'memory-index'
  file_path    TEXT NOT NULL,     -- absolute path on disk
  name         TEXT NOT NULL,     -- from frontmatter 'name', or filename for CLAUDE.md
  description  TEXT NOT NULL,     -- from frontmatter 'description', or '' for CLAUDE.md
  body         TEXT NOT NULL,     -- full file content (markdown)
  file_mtime   INTEGER NOT NULL,  -- last-modified timestamp from disk (ms)
  synced_at    INTEGER NOT NULL,  -- when DB row was last written (ms)
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX idx_memory_project ON memory_entries(project_path);
CREATE INDEX idx_memory_type    ON memory_entries(type);
```

### `memory_entries_fts` virtual table

```sql
CREATE VIRTUAL TABLE memory_entries_fts USING fts5(
  id,
  name,
  description,
  body,
  content='memory_entries',
  content_rowid='rowid'
);
-- INSERT/UPDATE/DELETE triggers keep FTS in sync (same pattern as sessions_fts)
```

---

## Components

### `src/store/memory.ts` — `MemoryStore` class

Responsibilities:
- `syncProject(projectPath: string): void` — scan auto-memory dir and CLAUDE.md; upsert changed rows (by mtime); delete rows for removed files
- `getByProject(projectPath: string): MemoryEntry[]` — all entries for a project, ordered by type then name
- `getById(id: string): MemoryEntry | null`
- `update(id: string, body: string): void` — write to disk, re-parse frontmatter, upsert in DB
- `search(query: string, limit?: number): MemorySearchResult[]` — FTS5 search across all projects
- Path encoding: `encodeProjectPath(projectPath: string): string` — mirrors Claude's slug logic

### `src/types.ts` additions

```typescript
export interface MemoryEntry {
  id: string;
  projectPath: string;
  source: 'auto-memory' | 'claude-md';
  type: 'user' | 'feedback' | 'project' | 'reference' | 'claude-md' | 'memory-index';
  filePath: string;
  name: string;
  description: string;
  body: string;
  fileMtime: number;
  syncedAt: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  bodyHighlight: string;
}
```

---

## API Endpoints

All endpoints added to `src/server/index.ts`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/memory?project=<path>` | All entries for a project (triggers lazy resync) |
| `GET` | `/api/memory/search?q=<query>[&limit=N]` | Cross-project FTS search |
| `GET` | `/api/memory/:id` | Single entry by ID |
| `PUT` | `/api/memory/:id` | Update entry body — writes to disk, resyncs |
| `POST` | `/api/memory/sync?project=<path>` | Manual resync for a project |

### Sync trigger rules

- **Server startup**: sync all projects currently in the sessions DB
- **Lazy on GET**: if any memory file mtime > `synced_at` for that project, resync before responding
- **After PUT**: always resync the affected project after writing to disk

### PUT `/api/memory/:id` request body

```json
{ "body": "<new markdown content>" }
```

Response: updated `MemoryEntry` object.

---

## UI Changes (`src/server/ui.ts`)

### Left sidebar

- New "Memory" nav item (below Sessions) with a brain/memory icon
- Navigates to the **global memory view**

### Global memory view

- Search bar at top (queries `/api/memory/search`, debounced 300ms)
- Results list: entry name + type badge, project name chip, description snippet, body excerpt with highlighted match
- Clicking a result navigates to that project's Memory tab with the entry pre-expanded

### Project detail — Memory tab

New tab alongside Sessions (and any future tabs):

**Auto-Memory section:**
- One card per auto-memory entry
- Card shows: type badge (colour-coded: user=blue, feedback=orange, project=green, reference=purple), name (bold), description (muted), collapsed body preview (2 lines)
- Clicking a card expands it inline with a `<textarea>` for the body and a Save button
- Save calls `PUT /api/memory/:id`; shows success toast or error

**CLAUDE.md section:**
- Full-height `<textarea>` pre-filled with CLAUDE.md body
- Save button calls `PUT /api/memory/:id` for the claude-md entry
- If CLAUDE.md does not exist for the project, shows a "Create CLAUDE.md" button that POSTs an empty body

**Sync button:**
- Top-right of Memory tab
- Calls `POST /api/memory/sync?project=<path>`, then refreshes entries
- Shows spinner while in flight

---

## Error Handling

- If `~/.claude/projects/<encoded>/memory/` does not exist for a project: return empty array, no error
- If CLAUDE.md does not exist: omit from results (UI shows "Create" affordance)
- If a memory file has malformed frontmatter: store it with `name = <filename>`, `description = ''`, `type = 'user'` as fallback
- Write failures on `PUT`: return HTTP 500 with error message; do not update DB

---

## Testing

- Unit tests for `MemoryStore.syncProject()` using a temp directory with fixture files
- Unit tests for `encodeProjectPath()` with known path/slug pairs
- Unit tests for frontmatter parsing with valid, missing, and malformed frontmatter
- Unit tests for `MemoryStore.search()` — verifies FTS results and scoring
- API handler tests for each new endpoint (happy path + error cases)
- No UI tests (UI is a single generated HTML string; changes verified manually)

---

## Out of Scope

- Deleting memory entries through the UI (managed by Claude Code itself)
- Creating new typed auto-memory entries from the UI (Claude Code handles this)
- Syncing memory to cloud (follows existing cloud sync design if needed later)
- Real-time file watching (polling/lazy sync is sufficient for v1)
