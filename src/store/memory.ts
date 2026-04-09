/**
 * MemoryStore — SQLite-backed storage for Claude Code memory entries.
 *
 * Reads memory files from ~/.claude/projects (or a custom base directory)
 * and indexes them for fast full-text search via FTS5.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MemoryEntry, MemorySearchResult, SyncMemoryResult } from '../types';
import { encodeProjectPath, encodeId, decodeId } from './memoryUtils';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter';

// Re-export for consumers that want a single import point
export type { MemoryEntry, MemorySearchResult, SyncMemoryResult };

const DEFAULT_DB_PATH = path.join(os.homedir(), '.cc-sessions', 'index.db');
const DEFAULT_MEMORY_BASE = path.join(os.homedir(), '.claude', 'projects');

export class MemoryStore {
  /** @internal exposed for tests via type cast */
  private db: Database.Database;
  private memoryBaseDir: string;

  constructor(
    dbPath: string = DEFAULT_DB_PATH,
    memoryBaseDir: string = DEFAULT_MEMORY_BASE,
  ) {
    this.memoryBaseDir = memoryBaseDir;

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
  }

  /**
   * Create (or verify) the memory_entries schema and FTS5 virtual table.
   * Safe to call multiple times — all DDL uses IF NOT EXISTS guards.
   */
  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id              TEXT PRIMARY KEY,
        project_path    TEXT NOT NULL,
        source          TEXT NOT NULL,
        type            TEXT NOT NULL,
        file_path       TEXT NOT NULL,
        name            TEXT NOT NULL,
        description     TEXT NOT NULL,
        body            TEXT NOT NULL,
        file_mtime      INTEGER NOT NULL,
        last_indexed_at INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_entries(project_path);
      CREATE INDEX IF NOT EXISTS idx_memory_source  ON memory_entries(source);

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
        name, description, body,
        content='memory_entries',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS memory_entries_ai
        AFTER INSERT ON memory_entries BEGIN
          INSERT INTO memory_entries_fts(rowid, name, description, body)
          VALUES (new.rowid, new.name, new.description, new.body);
        END;

      CREATE TRIGGER IF NOT EXISTS memory_entries_au
        AFTER UPDATE ON memory_entries BEGIN
          INSERT INTO memory_entries_fts(memory_entries_fts, rowid, name, description, body)
          VALUES ('delete', old.rowid, old.name, old.description, old.body);
          INSERT INTO memory_entries_fts(rowid, name, description, body)
          VALUES (new.rowid, new.name, new.description, new.body);
        END;

      CREATE TRIGGER IF NOT EXISTS memory_entries_ad
        AFTER DELETE ON memory_entries BEGIN
          INSERT INTO memory_entries_fts(memory_entries_fts, rowid, name, description, body)
          VALUES ('delete', old.rowid, old.name, old.description, old.body);
        END;
    `);
  }

  /**
   * Close the underlying database connection.
   */
  close(): void {
    this.db.close();
  }

  // ----------------------------------------------------------------
  // Stub methods — implemented in later tasks
  // ----------------------------------------------------------------

  /**
   * Scan memory files for a project and upsert changed entries.
   * Reads all .md files from the project's memory directory plus any CLAUDE.md,
   * upserts changed rows, and deletes rows for files no longer present.
   * @param projectPath — absolute filesystem path of the project
   */
  syncProject(projectPath: string): SyncMemoryResult {
    const now = Date.now();
    const seenIds = new Set<string>();
    let added = 0;
    let updated = 0;

    // --- auto-memory files ---
    const memoryDir = path.join(
      this.memoryBaseDir,
      encodeProjectPath(projectPath),
      'memory',
    );

    if (fs.existsSync(memoryDir)) {
      const files = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md'));

      for (const filename of files) {
        const absoluteFilePath = path.join(memoryDir, filename);
        const relativeFilePath = path.join('memory', filename);
        const id = encodeId(projectPath, relativeFilePath);
        const mtime = fs.statSync(absoluteFilePath).mtimeMs;

        const existing = this.db
          .prepare('SELECT id, file_mtime FROM memory_entries WHERE id = ?')
          .get(id) as { id: string; file_mtime: number } | undefined;

        if (existing !== undefined && existing.file_mtime >= mtime) {
          // No change — skip
          seenIds.add(id);
          continue;
        }

        const content = fs.readFileSync(absoluteFilePath, 'utf8');
        const { name, description, type, body } = parseFrontmatter(content);

        if (existing === undefined) {
          this.db
            .prepare(
              `INSERT INTO memory_entries
                (id, project_path, source, type, file_path, name, description, body,
                 file_mtime, last_indexed_at, created_at, updated_at)
               VALUES (?, ?, 'auto-memory', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              projectPath,
              type,
              relativeFilePath,
              name,
              description,
              body,
              mtime,
              now,
              now,
              now,
            );
          added += 1;
        } else {
          this.db
            .prepare(
              `UPDATE memory_entries
               SET type = ?, name = ?, description = ?, body = ?,
                   file_mtime = ?, last_indexed_at = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(type, name, description, body, mtime, now, now, id);
          updated += 1;
        }

        seenIds.add(id);
      }
    }

    // --- CLAUDE.md ---
    const claudeMdCandidates = [
      path.join(projectPath, 'CLAUDE.md'),
      path.join(projectPath, '.claude', 'CLAUDE.md'),
    ];

    for (const claudeMdPath of claudeMdCandidates) {
      if (!fs.existsSync(claudeMdPath)) continue;

      const relativeFilePath = path.relative(projectPath, claudeMdPath);
      const id = encodeId(projectPath, relativeFilePath);
      const mtime = fs.statSync(claudeMdPath).mtimeMs;

      const existing = this.db
        .prepare('SELECT id, file_mtime FROM memory_entries WHERE id = ?')
        .get(id) as { id: string; file_mtime: number } | undefined;

      if (existing === undefined || existing.file_mtime < mtime) {
        const body = fs.readFileSync(claudeMdPath, 'utf8');
        const name = path.basename(claudeMdPath);
        const description = 'Project instructions for Claude Code';

        if (existing === undefined) {
          this.db
            .prepare(
              `INSERT INTO memory_entries
                (id, project_path, source, type, file_path, name, description, body,
                 file_mtime, last_indexed_at, created_at, updated_at)
               VALUES (?, ?, 'claude-md', 'claude-md', ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              projectPath,
              relativeFilePath,
              name,
              description,
              body,
              mtime,
              now,
              now,
              now,
            );
          added += 1;
        } else {
          this.db
            .prepare(
              `UPDATE memory_entries
               SET name = ?, description = ?, body = ?,
                   file_mtime = ?, last_indexed_at = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(name, description, body, mtime, now, now, id);
          updated += 1;
        }
      }

      seenIds.add(id);
      break; // prefer root CLAUDE.md, stop after first found
    }

    // --- delete rows for files no longer present ---
    const existing = this.db
      .prepare('SELECT id FROM memory_entries WHERE project_path = ?')
      .all(projectPath) as Array<{ id: string }>;

    let deleted = 0;
    for (const row of existing) {
      if (!seenIds.has(row.id)) {
        this.db.prepare('DELETE FROM memory_entries WHERE id = ?').run(row.id);
        deleted += 1;
      }
    }

    return { added, updated, deleted };
  }

  /**
   * Return all memory entries for a project, ordered by updated_at DESC.
   */
  getByProject(projectPath: string): MemoryEntry[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM memory_entries WHERE project_path = ? ORDER BY updated_at DESC',
      )
      .all(projectPath) as Record<string, unknown>[];
    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * Return a single memory entry by its stable ID.
   */
  getById(id: string): MemoryEntry | null {
    const row = this.db
      .prepare('SELECT * FROM memory_entries WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row !== undefined ? this.rowToEntry(row) : null;
  }

  /**
   * Overwrite the body of an existing memory entry and update its file on disk.
   */
  update(_id: string, _body: string): void {
    throw new Error('update: not implemented');
  }

  /**
   * Full-text search across all indexed memory entries.
   */
  search(_query: string, _limit?: number): MemorySearchResult[] {
    throw new Error('search: not implemented');
  }

  /** Map a raw DB row (snake_case) to a MemoryEntry (camelCase). */
  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    return {
      id: row['id'] as string,
      projectPath: row['project_path'] as string,
      source: row['source'] as MemoryEntry['source'],
      type: row['type'] as MemoryEntry['type'],
      filePath: row['file_path'] as string,
      name: row['name'] as string,
      description: row['description'] as string,
      body: row['body'] as string,
      fileMtime: row['file_mtime'] as number,
      lastIndexedAt: row['last_indexed_at'] as number,
      createdAt: row['created_at'] as number,
      updatedAt: row['updated_at'] as number,
    };
  }
}

// decodeId and serializeFrontmatter are used by later tasks (update, search).
const _futureUse = { decodeId, serializeFrontmatter };
void _futureUse;
