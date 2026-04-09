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
   * @param projectPath — absolute filesystem path of the project
   */
  syncProject(_projectPath: string): SyncMemoryResult {
    throw new Error('syncProject: not implemented');
  }

  /**
   * Return all memory entries for a project, ordered by file_path.
   */
  getByProject(_projectPath: string): MemoryEntry[] {
    throw new Error('getByProject: not implemented');
  }

  /**
   * Return a single memory entry by its stable ID.
   */
  getById(_id: string): MemoryEntry | null {
    throw new Error('getById: not implemented');
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
}

// These imports will be used by the stub implementations in later tasks.
// Reference them here to keep the file compilable under strict mode.
const _futureUse = { encodeProjectPath, encodeId, decodeId, parseFrontmatter, serializeFrontmatter };
void _futureUse;
