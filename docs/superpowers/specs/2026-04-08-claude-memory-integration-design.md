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

1. **Auto-memory files** — typed `.md` files at `~/.claude/projects/<encoded-path>/memory/`. Types: `user`, `feedback`, `project`, `reference`. The special file `MEMORY.md` is the index file; it has `type = 'memory-index'` and `source = 'auto-memory'`. All auto-memory files have YAML frontmatter (`name`, `description`, `type`) followed by a markdown body. The `body` field in the DB stores **only the content after the frontmatter block** (frontmatter is stripped). When writing back to disk via `update()`, the frontmatter is prepended from the stored `name`/`description`/`type` fields so the file remains valid.
2. **CLAUDE.md** — a project-level instructions file. Checked in this priority order:
   - `<project_path>/CLAUDE.md` (highest priority)
   - `<project_path>/.claude/CLAUDE.md` (fallback)
   - If both exist, only `<project_path>/CLAUDE.md` is used; the `.claude/CLAUDE.md` entry is deleted from the DB if it previously existed.
   - If neither exists, the project has no claude-md entry.
   - The "Create CLAUDE.md" button always targets `<project_path>/CLAUDE.md`.
   - The `body` field stores the full raw file content.

**Project path encoding:** for a project at `/Users/foo/bar`, the encoded directory name is `-Users-foo-bar` (leading `/` dropped, each remaining `/` replaced with `-`). **Known limitation:** directory names containing `-` can produce collisions (e.g. `/Users/foo-bar/baz` and `/Users/foo/bar-baz` both encode to `Users-foo-bar-baz`). This matches Claude Code's own encoding and is declared out of scope for v1 — in practice the encoded directory in `~/.claude/projects/` is a given on disk and the store reads it rather than computing it independently.

```typescript
export function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(/^\//, '').replace(/\//g, '-');
}
```

**`id` encoding:** the raw key is `<project_path>` + `\x00` + `<relative_file_path>` (NUL as delimiter — NUL cannot appear in file paths, so splitting on the first NUL is always unambiguous even when `projectPath` contains colons). This string is base64url-encoded **with padding stripped** (`+`→`-`, `/`→`_`, strip trailing `=`), producing `[A-Za-z0-9_-]` characters only — safe for URL path segments.

```typescript
export function encodeId(projectPath: string, relativeFilePath: string): string {
  const raw = projectPath + '\x00' + relativeFilePath;
  return Buffer.from(raw).toString('base64url'); // Node ≥16 base64url drops padding
}

export function decodeId(id: string): { projectPath: string; relativeFilePath: string } {
  const raw = Buffer.from(id, 'base64url').toString('utf8');
  const nul = raw.indexOf('\x00');
  return { projectPath: raw.slice(0, nul), relativeFilePath: raw.slice(nul + 1) };
}
```

---

## Data Model

### `memory_entries` table

```sql
CREATE TABLE IF NOT EXISTS memory_entries (
  id           TEXT PRIMARY KEY,  -- encodeId(project_path, relative_file_path)
  project_path TEXT NOT NULL,
  source       TEXT NOT NULL,     -- 'auto-memory' | 'claude-md'
  type         TEXT NOT NULL,     -- 'user'|'feedback'|'project'|'reference'|'memory-index'|'claude-md'
  file_path    TEXT NOT NULL,     -- absolute, path.resolve()-normalized path on disk
  name         TEXT NOT NULL,     -- frontmatter 'name', or 'CLAUDE.md' for claude-md
  description  TEXT NOT NULL,     -- frontmatter 'description', or '' for claude-md
  body         TEXT NOT NULL,     -- frontmatter-stripped body (auto-memory) or full content (claude-md)
  file_mtime   INTEGER NOT NULL,  -- mtime from fs.statSync (ms)
  last_indexed_at INTEGER NOT NULL DEFAULT 0, -- timestamp after sync pass completed (ms); 0 = never synced
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_entries(project_path);
CREATE INDEX IF NOT EXISTS idx_memory_type    ON memory_entries(type);

-- Keep updated_at current on every UPDATE
CREATE TRIGGER IF NOT EXISTS memory_entries_upd_ts AFTER UPDATE ON memory_entries
WHEN old.updated_at = new.updated_at BEGIN
  UPDATE memory_entries SET updated_at = strftime('%s','now') * 1000 WHERE id = new.id;
END;
```

**`last_indexed_at` default of 0** ensures that any row with a missing value is always considered stale and will be re-synced on the next lazy-sync check.

**Trigger naming:** the `updated_at` trigger is named `memory_entries_upd_ts` to avoid any future naming conflict. The FTS triggers are named `memory_entries_ai`, `memory_entries_ad`, `memory_entries_au_fts`. All use `CREATE TRIGGER IF NOT EXISTS`. On schema migration, stale triggers with the same name are left in place (same behaviour as `SessionStore`) — this is acceptable because the trigger logic is stable.

**DB migration:** `memory_entries` is created with `CREATE TABLE IF NOT EXISTS` in `MemoryStore.initialize()`. On each startup, `initialize()` checks for missing columns via `PRAGMA table_info(memory_entries)` and runs `ALTER TABLE` as needed (same pattern as `SessionStore`'s `title` column migration).

### `memory_entries_fts` virtual table

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
  id, name, description, body,
  content='memory_entries', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memory_entries_ai AFTER INSERT ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(rowid, id, name, description, body)
  VALUES (new.rowid, new.id, new.name, new.description, new.body);
END;

CREATE TRIGGER IF NOT EXISTS memory_entries_ad AFTER DELETE ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(memory_entries_fts, rowid, id, name, description, body)
  VALUES ('delete', old.rowid, old.id, old.name, old.description, old.body);
END;

CREATE TRIGGER IF NOT EXISTS memory_entries_au_fts AFTER UPDATE ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(memory_entries_fts, rowid, id, name, description, body)
  VALUES ('delete', old.rowid, old.id, old.name, old.description, old.body);
  INSERT INTO memory_entries_fts(rowid, id, name, description, body)
  VALUES (new.rowid, new.id, new.name, new.description, new.body);
END;
```

---

## Components

### `src/store/memory.ts` — `MemoryStore` class + utilities

All methods are **synchronous** (consistent with `better-sqlite3` and `SessionStore`). Disk I/O uses synchronous Node `fs` APIs (`fs.readdirSync`, `fs.statSync`, `fs.readFileSync`, `fs.writeFileSync`). No external glob library — file listing uses `fs.readdirSync(dir).filter(f => f.endsWith('.md'))`.

**Exported utilities:** `encodeProjectPath`, `encodeId`, `decodeId` — defined in Background.

**Constructor:** accepts optional `dbPath` (default `~/.cc-sessions/index.db`). Shares the same database file as `SessionStore`. Calls `initialize()` on construction.

**Methods:**
- `initialize(): void` — creates tables, FTS virtual table, and all triggers; runs column migration check
- `syncProject(projectPath: string): SyncMemoryResult`
- `getByProject(projectPath: string): MemoryEntry[]` — ordered by `type ASC, name ASC`
- `getById(id: string): MemoryEntry | null`
- `update(id: string, body: string): void`
- `search(query: string, limit = 20): MemorySearchResult[]` — limit clamped to `[1, 200]`

#### `syncProject()` algorithm

1. Record `syncStartedAt = Date.now()`. **Cap:** if the project has more than 500 files in its memory dir (indicative of a bug or large symlinked dir), log a warning and process only the first 500 alphabetically.
2. Determine `memoryDir = path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(projectPath), 'memory')`.
3. Determine active CLAUDE.md path: check `<projectPath>/CLAUDE.md` first; if absent, check `<projectPath>/.claude/CLAUDE.md`.
4. **Collect on-disk files:** `fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'))` (empty array if dir absent/unreadable) + `[activeClaudeMdPath]` if the active CLAUDE.md exists.
5. **Compute expected IDs** for all on-disk files using `encodeId`.
6. **Fetch all DB rows** for this `project_path`.
7. **For each on-disk file, inside the loop:** if `fs.statSync(f).mtimeMs` differs from the stored `file_mtime` (or the row is absent): parse content, then immediately upsert the DB row with the new body, `file_mtime`, and `last_indexed_at = Date.now()` (stamped right after the upsert completes for that individual row). There is no separate post-loop pass — `last_indexed_at` is written per-row inside the loop so each row reflects when it was actually indexed, not when the full sync finished.
8. **Delete** DB rows whose `id` is not in the expected ID set for this `project_path`.
9. Return `{ added, updated, deleted }`.

**`last_indexed_at` semantics:** stamped per-row immediately after that row is written. A file written to disk during the sync pass will have disk mtime ≥ the `last_indexed_at` of its row (because the row was stamped after the write completed before the file was modified again). The next lazy-sync check will therefore catch it. Rows with `last_indexed_at = 0` are always considered stale.

**Lazy sync check (invoked by `GET /api/memory?project=` before returning results):**
1. Collect expected on-disk files (same logic as `syncProject()` steps 2–4).
2. For each file, compare `fs.statSync(f).mtimeMs` against the DB row's `last_indexed_at` (treat missing rows as `last_indexed_at = 0`).
3. If **any** file has `mtime > last_indexed_at`, call `syncProject()` before returning entries.
4. If all files are up-to-date (or no files exist), skip the sync and return current DB rows directly.
This means `GET /api/memory?project=` may trigger a full `syncProject()` pass — acceptable given the small size of memory dirs and the local/single-user nature of the server.

#### `update()` implementation

1. Look up entry by `id`; throw 404 if not found.
2. Resolve `file_path` with `path.resolve()`.
3. Define allowed roots (with trailing `/`):
   - `path.resolve(os.homedir(), '.claude', 'projects') + path.sep`
   - `path.resolve(entry.projectPath) + path.sep`
4. Verify resolved path starts with at least one root; throw 403 otherwise.
5. Reject `body` > 512 KB (530,000 bytes); throw 400.
6. For auto-memory: reconstruct frontmatter with YAML-safe quoting — wrap `name` and `description` in double-quotes, escaping any embedded double-quotes with `\"`:
   ```
   ---
   name: "${entry.name.replace(/"/g, '\\"')}"
   description: "${entry.description.replace(/"/g, '\\"')}"
   type: ${entry.type}
   ---

   ${body}
   ```
   `type` is a controlled enum value and requires no quoting.
7. For claude-md: write `body` directly.
8. `fs.writeFileSync(entry.filePath, content, 'utf8')`.
9. **Directly upsert** the DB row with the new `body` and updated `file_mtime` (from `fs.statSync` after write) and `last_indexed_at = Date.now()`. Do not rely on `syncProject()` to propagate this — mtime granularity on some filesystems (1-second on HFS+) may prevent `syncProject()` from detecting the change.
10. Call `syncProject(projectPath)` to clean up any other stale entries in the project (added/deleted files) — the upsert in step 9 means the current entry is already correct regardless of mtime.

#### `search()` implementation

Uses FTS5 `snippet()` function for `bodyHighlight` (not `highlight()`). Join is on `rowid`, not the `id` text column:
```sql
SELECT
  s.*,
  snippet(memory_entries_fts, 3, '<mark>', '</mark>', '…', 32) AS body_hl,
  bm25(memory_entries_fts) AS score
FROM memory_entries_fts
JOIN memory_entries s ON memory_entries_fts.rowid = s.rowid
WHERE memory_entries_fts MATCH ?
ORDER BY score
LIMIT ?
```
`snippet()` extracts a relevant excerpt (up to 32 tokens) with `<mark>…</mark>` around matches. `score = Math.abs(bm25(...))` — higher is more relevant (same convention as `SessionStore`). Falls back to `LIKE`-based search if FTS throws.

**Server startup sync:** at startup, call `syncProject()` for all distinct `project_path` values in the sessions DB. To avoid startup latency with many stale projects, cap to projects with a session in the last 90 days; older projects are synced lazily on first access.

---

### `src/types.ts` additions

```typescript
export interface MemoryEntry {
  id: string;             // encodeId(projectPath, relativeFilePath)
  projectPath: string;
  source: 'auto-memory' | 'claude-md';
  type: 'user' | 'feedback' | 'project' | 'reference' | 'memory-index' | 'claude-md';
  filePath: string;       // absolute, path.resolve()-normalized
  name: string;
  description: string;
  body: string;           // frontmatter stripped (auto-memory) or full content (claude-md)
  fileMtime: number;      // disk mtime (ms)
  lastIndexedAt: number;  // per-row timestamp after sync wrote this row (ms); 0 = never synced
  createdAt: number;
  updatedAt: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;          // Math.abs(bm25(...)) — higher = more relevant
  bodyHighlight: string;  // FTS snippet with <mark>…</mark> around matched terms
}

export interface SyncMemoryResult {
  added: number;
  updated: number;
  deleted: number;
}
```

---

## API Endpoints

All new endpoints in `src/server/index.ts`. The server instantiates one `MemoryStore` alongside `SessionStore`, sharing the same `dbPath`.

**Project validation:** for endpoints that take a `project` query parameter, validate that `projectPath` appears in `sessionStore.getProjects()` before acting. Unknown paths → HTTP 404. For `/:id` endpoints, project existence is not re-validated — if the project was deleted from the sessions DB, the entry can still be read/written (the DB row still exists). This avoids a TOCTOU race and is consistent with the existing session-id-based endpoints.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/memory?project=<path>` | All entries for a project (lazy resync) |
| `GET` | `/api/memory/search?q=<query>[&limit=N]` | Cross-project FTS (default 20, max 200) |
| `GET` | `/api/memory/:id` | Single entry by encoded ID |
| `PUT` | `/api/memory/:id` | Update body — writes disk, syncs project |
| `POST` | `/api/memory/sync?project=<path>` | Manual resync; returns `SyncMemoryResult` |
| `POST` | `/api/memory/create-claude-md?project=<path>` | Create CLAUDE.md; returns `MemoryEntry` |

### Routing

Exact routes (`/api/memory`, `/api/memory/search`, `/api/memory/sync`, `/api/memory/create-claude-md`) are matched before the dynamic `/:id` pattern. IDs are `[A-Za-z0-9_-]` only.

### PUT `/api/memory/:id`

Request body (JSON): `{ "body": string }` — no other fields accepted. Request body must be ≤ 512 KB (enforced before parsing JSON). If `Content-Length` header is absent or > 512 KB, return HTTP 400 immediately.

Responses: `200` updated `MemoryEntry` | `400` missing/invalid body or > 512 KB | `403` file outside allowed roots | `404` id not found | `500` disk write failure.

### POST `/api/memory/create-claude-md?project=<path>`

Request body: none expected; ignore any body.

**Path safety:** `projectPath` is taken from `sessionStore.getProjects()` (validated above), which stores paths that were originally supplied by the cc-sessions importer from `~/.claude/projects/`. The write target is `path.resolve(projectPath, 'CLAUDE.md')`. Before writing, verify `resolvedTarget.startsWith(path.resolve(projectPath) + path.sep)` to guard against a crafted `projectPath` that itself ends in `..` (belt-and-suspenders; `getProjects()` validation is the primary guard).

Behaviour:
- If `<project_path>/CLAUDE.md` already exists on disk (regardless of DB state): call `syncProject()` to ensure DB is current, then return `409` with the existing `MemoryEntry`
- If project directory does not exist on disk (`!fs.existsSync(projectPath)`): return `422` with message `"Project directory not found: <path>"`
- On success: `fs.writeFileSync(path.join(projectPath, 'CLAUDE.md'), '', 'utf8')`, call `syncProject()`, return `201` with new `MemoryEntry`

---

## UI Changes (`src/server/ui.ts`)

### Left sidebar

- New "Memory" nav item below Sessions
- Navigates to the **global memory view**

### Global memory view

- Search bar (queries `/api/memory/search`, debounced 300ms)
- Results: entry name + type badge, project name chip, description snippet, `bodyHighlight` rendered safely:
  - Split `bodyHighlight` on `<mark>` and `</mark>` delimiters
  - Build DOM nodes using `createElement`/`textContent` only (no `innerHTML`)
  - Matched terms wrapped in `<strong>` with accent colour styling
- Clicking a result: navigate to that project's Memory tab with the matching entry pre-expanded
- **Within-project filter:** `GET /api/memory?project=<path>` returns all entries; the client filters the displayed list client-side as the user types in a local filter input in the project Memory tab (no separate server-side per-project search endpoint needed)

### Project detail — Memory tab

New tab alongside Sessions:

**Auto-Memory section:**
- Cards for entries with `source = 'auto-memory'`, ordered by `type ASC, name ASC`
- Type badge colours: user=blue, feedback=orange, project=green, reference=purple, memory-index=grey
- Card: collapsed (2-line body preview); click expands inline `<textarea>` + Save
- Save → `PUT /api/memory/:id`; success toast or inline error

**CLAUDE.md section:**
- Entry with `source = 'claude-md'`: full-height `<textarea>` + Save (calls `PUT /api/memory/:id`)
- No claude-md entry: "Create CLAUDE.md" button → `POST /api/memory/create-claude-md?project=<path>`
  - On `201`: replace button with textarea editor pre-filled with empty content
  - On `409`: load existing entry into editor

**Sync button:**
- `POST /api/memory/sync?project=<path>` → re-fetch entries → display `"Synced: +N added, N updated, N deleted"`

---

## Error Handling

- Memory dir absent: `syncProject()` is a no-op; `getByProject()` returns `[]`
- CLAUDE.md absent: omitted; UI shows "Create CLAUDE.md"
- Malformed frontmatter: `name = <filename without .md>`, `description = ''`, `type = 'user'`; `body = full file content`
- Both CLAUDE.md paths exist: only `<project_path>/CLAUDE.md` synced; `.claude/CLAUDE.md` DB row deleted
- File path outside allowed roots: HTTP 403
- Body > 512 KB: HTTP 400
- Disk write failure: HTTP 500, DB unchanged
- Unknown `project` query param: HTTP 404
- Invalid `limit`: HTTP 400
- Server startup: if `syncProject()` throws for a project (e.g. permission error), log and continue — do not crash the server

---

## Testing

- `encodeProjectPath()`: known path/slug pairs including paths with dashes
- `encodeId()` / `decodeId()`: round-trips including paths with colons, NUL delimiter correctness, URL-safety, no padding
- Frontmatter parsing: valid (body stripped), absent (whole file as body), malformed (fallback)
- `MemoryStore.syncProject()` with temp fixtures: new files, updated files, deleted files, both CLAUDE.md paths present, empty dir, 500-file cap
- `MemoryStore.search()`: results returned, `score` higher = better, `bodyHighlight` contains `<mark>` tags
- `update()` path validation: allowed roots accepted, `..` traversal rejected, outside roots rejected
- `update()` body size: 512 KB accepted, 512 KB + 1 byte rejected
- API handlers: happy path + all documented error codes for each endpoint

---

## Out of Scope

- Deleting memory entries through the UI
- Creating new typed auto-memory entries from the UI
- Cloud sync of memory (follows existing cloud sync design if needed)
- Real-time file watching (lazy sync is sufficient for v1)
- Windows path support (cc-sessions targets macOS/Linux)
