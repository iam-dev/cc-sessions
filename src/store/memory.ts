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
import { encodeProjectPath, encodeId } from './memoryUtils';
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
      CREATE INDEX IF NOT EXISTS idx_memory_type    ON memory_entries(type);

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
        id, name, description, body,
        content='memory_entries',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS memory_entries_ai
        AFTER INSERT ON memory_entries BEGIN
          INSERT INTO memory_entries_fts(rowid, id, name, description, body)
          VALUES (new.rowid, new.id, new.name, new.description, new.body);
        END;

      CREATE TRIGGER IF NOT EXISTS memory_entries_au_fts
        AFTER UPDATE ON memory_entries BEGIN
          INSERT INTO memory_entries_fts(memory_entries_fts, rowid, id, name, description, body)
          VALUES ('delete', old.rowid, old.id, old.name, old.description, old.body);
          INSERT INTO memory_entries_fts(rowid, id, name, description, body)
          VALUES (new.rowid, new.id, new.name, new.description, new.body);
        END;

      CREATE TRIGGER IF NOT EXISTS memory_entries_ad
        AFTER DELETE ON memory_entries BEGIN
          INSERT INTO memory_entries_fts(memory_entries_fts, rowid, id, name, description, body)
          VALUES ('delete', old.rowid, old.id, old.name, old.description, old.body);
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
              absoluteFilePath,
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
        const description = '';

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
              claudeMdPath,
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
        'SELECT * FROM memory_entries WHERE project_path = ? ORDER BY type ASC, name ASC',
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
   * Update name, description, and/or body of an existing memory entry.
   * Writes the change to disk, then syncs the DB row.
   * Throws if the entry does not exist or if a path traversal is detected.
   */
  update(
    id: string,
    fields: Partial<Pick<MemoryEntry, 'name' | 'description' | 'body'>>,
  ): MemoryEntry {
    const entry = this.getById(id);
    if (entry === null) {
      throw new Error(`Memory entry not found: ${id}`);
    }

    // Resolve the absolute file path safely
    const absoluteFilePath = path.isAbsolute(entry.filePath)
      ? entry.filePath
      : entry.source === 'auto-memory'
        ? path.join(
            this.memoryBaseDir,
            encodeProjectPath(entry.projectPath),
            entry.filePath,
          )
        : path.join(entry.projectPath, entry.filePath);

    const resolved = path.resolve(absoluteFilePath);
    const safeRoots = [this.memoryBaseDir, entry.projectPath];
    const isSafe = safeRoots.some((root) =>
      resolved.startsWith(root + path.sep),
    );
    if (!isSafe) {
      throw new Error(
        `Path traversal detected: ${resolved} is outside allowed directories`,
      );
    }

    const newName = fields.name ?? entry.name;
    const newDesc = fields.description ?? entry.description;
    const newBody = fields.body ?? entry.body;

    const MAX_BODY_BYTES = 530_000; // 512 KB
    if (Buffer.byteLength(newBody, 'utf8') > MAX_BODY_BYTES) {
      throw new Error(`Body exceeds maximum size of 512 KB`);
    }

    if (entry.source === 'auto-memory') {
      fs.writeFileSync(
        resolved,
        serializeFrontmatter(newName, newDesc, entry.type, newBody),
        'utf8',
      );
    } else {
      fs.writeFileSync(resolved, newBody, 'utf8');
    }

    const stat = fs.statSync(resolved);
    const newMtime = stat.mtimeMs;
    const now = Date.now();

    this.db
      .prepare(
        `UPDATE memory_entries
         SET name = ?, description = ?, body = ?,
             file_mtime = ?, last_indexed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(newName, newDesc, newBody, newMtime, now, now, id);

    return this.getById(id)!;
  }

  /**
   * Full-text search across all indexed memory entries using FTS5.
   * Uses prefix matching and BM25 ranking (lower score = better match).
   * @param query — search terms; prefix-matched automatically
   * @param options.projectPath — restrict results to a single project
   * @param options.limit — max results to return (default 20)
   */
  search(
    query: string,
    options: { projectPath?: string; limit?: number } = {},
  ): MemorySearchResult[] {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 200));

    try {
      let sql = `
        SELECT s.*, snippet(memory_entries_fts, 3, '<mark>', '</mark>', '…', 32) AS body_hl,
               bm25(memory_entries_fts) AS score
        FROM memory_entries_fts
        JOIN memory_entries s ON memory_entries_fts.rowid = s.rowid
        WHERE memory_entries_fts MATCH ?
      `;
      const params: unknown[] = [query + '*'];

      if (options.projectPath) {
        sql += ' AND s.project_path = ?';
        params.push(options.projectPath);
      }
      sql += ' ORDER BY score LIMIT ?';
      params.push(limit);

      const rows = this.db
        .prepare(sql)
        .all(...params) as (Record<string, unknown> & { body_hl: string; score: number })[];

      return rows.map((row) => ({
        entry: this.rowToEntry(row),
        projectName: path.basename(row['project_path'] as string),
        score: Math.abs(row.score as number),
        bodyHighlight: row.body_hl as string,
      }));
    } catch {
      // FTS threw (e.g., malformed query) — fall back to LIKE-based search
      const likeQuery = `%${query}%`;
      let sql = `
        SELECT *, '' AS body_hl, 0.0 AS score
        FROM memory_entries
        WHERE (name LIKE ? OR description LIKE ? OR body LIKE ?)
      `;
      const params: unknown[] = [likeQuery, likeQuery, likeQuery];

      if (options.projectPath) {
        sql += ' AND project_path = ?';
        params.push(options.projectPath);
      }
      sql += ' ORDER BY updated_at DESC LIMIT ?';
      params.push(limit);

      const rows = this.db
        .prepare(sql)
        .all(...params) as Record<string, unknown>[];

      return rows.map((row) => ({
        entry: this.rowToEntry(row),
        projectName: path.basename(row['project_path'] as string),
        score: 0,
        bodyHighlight: '',
      }));
    }
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
