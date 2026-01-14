/**
 * Session Store - SQLite-based storage for session memories
 *
 * Provides CRUD operations for SessionMemory objects with FTS5 search support.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { SessionMemory, SearchResult, SearchMatch, StorageStats, Task } from '../types';

const DB_DIR = path.join(os.homedir(), '.cc-sessions');
const DB_PATH = path.join(DB_DIR, 'index.db');

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.initialize();
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    this.db.exec(`
      -- Main sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        claude_session_id TEXT,
        project_path TEXT NOT NULL,
        project_name TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        summary TEXT,
        description TEXT,
        tasks_json TEXT DEFAULT '[]',
        tasks_completed INTEGER DEFAULT 0,
        tasks_pending INTEGER DEFAULT 0,
        files_created_json TEXT DEFAULT '[]',
        files_modified_json TEXT DEFAULT '[]',
        files_deleted_json TEXT DEFAULT '[]',
        last_user_message TEXT,
        last_assistant_message TEXT,
        next_steps_json TEXT DEFAULT '[]',
        key_decisions_json TEXT DEFAULT '[]',
        blockers_json TEXT DEFAULT '[]',
        tokens_used INTEGER DEFAULT 0,
        messages_count INTEGER DEFAULT 0,
        tool_calls_count INTEGER DEFAULT 0,
        tags_json TEXT DEFAULT '[]',
        archived INTEGER DEFAULT 0,
        archived_at INTEGER,
        synced INTEGER DEFAULT 0,
        synced_at INTEGER,
        log_file TEXT,
        log_file_archived TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
      CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived);
      CREATE INDEX IF NOT EXISTS idx_sessions_synced ON sessions(synced);

      -- Full-text search virtual table
      CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
        id,
        summary,
        description,
        tasks_text,
        files_text,
        last_user_message,
        last_assistant_message,
        tags_text,
        content='sessions',
        content_rowid='rowid'
      );

      -- Trigger to keep FTS in sync on INSERT
      CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
        INSERT INTO sessions_fts(
          rowid, id, summary, description, tasks_text, files_text,
          last_user_message, last_assistant_message, tags_text
        )
        VALUES (
          new.rowid,
          new.id,
          new.summary,
          new.description,
          new.tasks_json,
          new.files_created_json || ' ' || new.files_modified_json,
          new.last_user_message,
          new.last_assistant_message,
          new.tags_json
        );
      END;

      -- Trigger to keep FTS in sync on DELETE
      CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
        INSERT INTO sessions_fts(sessions_fts, rowid, id, summary, description, tasks_text, files_text, last_user_message, last_assistant_message, tags_text)
        VALUES('delete', old.rowid, old.id, old.summary, old.description, old.tasks_json, old.files_created_json || ' ' || old.files_modified_json, old.last_user_message, old.last_assistant_message, old.tags_json);
      END;

      -- Trigger to keep FTS in sync on UPDATE
      CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
        INSERT INTO sessions_fts(sessions_fts, rowid, id, summary, description, tasks_text, files_text, last_user_message, last_assistant_message, tags_text)
        VALUES('delete', old.rowid, old.id, old.summary, old.description, old.tasks_json, old.files_created_json || ' ' || old.files_modified_json, old.last_user_message, old.last_assistant_message, old.tags_json);
        INSERT INTO sessions_fts(rowid, id, summary, description, tasks_text, files_text, last_user_message, last_assistant_message, tags_text)
        VALUES (new.rowid, new.id, new.summary, new.description, new.tasks_json, new.files_created_json || ' ' || new.files_modified_json, new.last_user_message, new.last_assistant_message, new.tags_json);
      END;
    `);
  }

  /**
   * Save a session memory to the database
   */
  save(session: SessionMemory): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (
        id, claude_session_id, project_path, project_name,
        started_at, ended_at, duration,
        summary, description,
        tasks_json, tasks_completed, tasks_pending,
        files_created_json, files_modified_json, files_deleted_json,
        last_user_message, last_assistant_message,
        next_steps_json, key_decisions_json, blockers_json,
        tokens_used, messages_count, tool_calls_count,
        tags_json, archived, archived_at, synced, synced_at,
        log_file, log_file_archived,
        updated_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?
      )
    `);

    stmt.run(
      session.id,
      session.claudeSessionId,
      session.projectPath,
      session.projectName,
      session.startedAt.getTime(),
      session.endedAt.getTime(),
      session.duration,
      session.summary,
      session.description,
      JSON.stringify(session.tasks),
      session.tasksCompleted,
      session.tasksPending,
      JSON.stringify(session.filesCreated),
      JSON.stringify(session.filesModified),
      JSON.stringify(session.filesDeleted),
      session.lastUserMessage,
      session.lastAssistantMessage,
      JSON.stringify(session.nextSteps),
      JSON.stringify(session.keyDecisions),
      JSON.stringify(session.blockers),
      session.tokensUsed,
      session.messagesCount,
      session.toolCallsCount,
      JSON.stringify(session.tags),
      session.archived ? 1 : 0,
      session.archivedAt?.getTime() || null,
      session.synced ? 1 : 0,
      session.syncedAt?.getTime() || null,
      session.logFile,
      session.logFileArchived || null,
      Date.now()
    );
  }

  /**
   * Get a session by ID
   */
  getById(id: string): SessionMemory | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToSession(row) : null;
  }

  /**
   * Get the last session for a project
   */
  getLastForProject(projectPath: string): SessionMemory | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE project_path = ?
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const row = stmt.get(projectPath) as Record<string, unknown> | undefined;
    return row ? this.rowToSession(row) : null;
  }

  /**
   * Get recent sessions
   */
  getRecent(limit: number = 10, projectPath?: string): SessionMemory[] {
    let sql = `SELECT * FROM sessions WHERE archived = 0`;
    const params: unknown[] = [];

    if (projectPath) {
      sql += ` AND project_path = ?`;
      params.push(projectPath);
    }

    sql += ` ORDER BY started_at DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map(row => this.rowToSession(row));
  }

  /**
   * Get all sessions (including archived)
   */
  getAll(includeArchived: boolean = false): SessionMemory[] {
    let sql = `SELECT * FROM sessions`;
    if (!includeArchived) {
      sql += ` WHERE archived = 0`;
    }
    sql += ` ORDER BY started_at DESC`;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map(row => this.rowToSession(row));
  }

  /**
   * Get archived sessions
   */
  getArchived(): SessionMemory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE archived = 1
      ORDER BY archived_at DESC
    `);
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map(row => this.rowToSession(row));
  }

  /**
   * Get unsynced sessions
   */
  getUnsyncedSessions(): SessionMemory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE synced = 0
      ORDER BY started_at ASC
    `);
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map(row => this.rowToSession(row));
  }

  /**
   * Search sessions using full-text search
   */
  search(query: string, limit: number = 20): SearchResult[] {
    // Escape special FTS characters
    const escapedQuery = query.replace(/['"]/g, '');

    const stmt = this.db.prepare(`
      SELECT
        s.*,
        highlight(sessions_fts, 1, '<mark>', '</mark>') as summary_hl,
        highlight(sessions_fts, 2, '<mark>', '</mark>') as description_hl,
        bm25(sessions_fts) as score
      FROM sessions_fts
      JOIN sessions s ON sessions_fts.id = s.id
      WHERE sessions_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `);

    try {
      const rows = stmt.all(`"${escapedQuery}"*`, limit) as Array<Record<string, unknown>>;
      return rows.map(row => this.rowToSearchResult(row));
    } catch (error) {
      // Fallback to simple LIKE search if FTS fails
      return this.simplSearch(query, limit);
    }
  }

  /**
   * Simple search fallback using LIKE
   */
  private simplSearch(query: string, limit: number): SearchResult[] {
    const pattern = `%${query}%`;
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE summary LIKE ? OR description LIKE ? OR last_user_message LIKE ?
      ORDER BY started_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(pattern, pattern, pattern, limit) as Record<string, unknown>[];
    return rows.map(row => ({
      session: this.rowToSession(row),
      score: 1,
      matches: [{
        field: 'summary',
        text: String(row.summary || ''),
        highlight: String(row.summary || '')
      }]
    }));
  }

  /**
   * Archive old sessions
   */
  archiveOld(olderThanDays: number): number {
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET archived = 1, archived_at = ?
      WHERE started_at < ? AND archived = 0
    `);
    const result = stmt.run(Date.now(), cutoff);
    return result.changes;
  }

  /**
   * Delete old sessions
   */
  deleteOld(olderThanDays: number): number {
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare(`DELETE FROM sessions WHERE started_at < ?`);
    const result = stmt.run(cutoff);
    return result.changes;
  }

  /**
   * Update archive path for a session
   */
  updateArchivePath(id: string, archivePath: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET log_file_archived = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(archivePath, Date.now(), id);
  }

  /**
   * Mark a session as synced
   */
  markSynced(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET synced = 1, synced_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), Date.now(), id);
  }

  /**
   * Delete a session by ID
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Get storage statistics
   */
  getStats(): StorageStats {
    const countStmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN archived = 0 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) as archived,
        MIN(started_at) as oldest,
        MAX(started_at) as newest
      FROM sessions
    `);

    const row = countStmt.get() as Record<string, unknown>;

    // Calculate database size
    const dbSize = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;

    return {
      totalSessions: Number(row.total) || 0,
      activeSessions: Number(row.active) || 0,
      archivedSessions: Number(row.archived) || 0,
      storageUsedBytes: dbSize,
      oldestSession: row.oldest ? new Date(Number(row.oldest)) : undefined,
      newestSession: row.newest ? new Date(Number(row.newest)) : undefined
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Convert a database row to a SessionMemory object
   */
  private rowToSession(row: Record<string, unknown>): SessionMemory {
    return {
      id: String(row.id),
      claudeSessionId: String(row.claude_session_id || ''),
      projectPath: String(row.project_path),
      projectName: String(row.project_name),
      startedAt: new Date(Number(row.started_at)),
      endedAt: new Date(Number(row.ended_at)),
      duration: Number(row.duration),
      summary: String(row.summary || ''),
      description: String(row.description || ''),
      tasks: this.parseJson<Task>(row.tasks_json),
      tasksCompleted: Number(row.tasks_completed),
      tasksPending: Number(row.tasks_pending),
      filesCreated: this.parseJson<string>(row.files_created_json),
      filesModified: this.parseJson<string>(row.files_modified_json),
      filesDeleted: this.parseJson<string>(row.files_deleted_json),
      lastUserMessage: String(row.last_user_message || ''),
      lastAssistantMessage: String(row.last_assistant_message || ''),
      nextSteps: this.parseJson<string>(row.next_steps_json),
      keyDecisions: this.parseJson<string>(row.key_decisions_json),
      blockers: this.parseJson<string>(row.blockers_json),
      tokensUsed: Number(row.tokens_used),
      messagesCount: Number(row.messages_count),
      toolCallsCount: Number(row.tool_calls_count),
      tags: this.parseJson<string>(row.tags_json),
      archived: row.archived === 1,
      archivedAt: row.archived_at ? new Date(Number(row.archived_at)) : undefined,
      synced: row.synced === 1,
      syncedAt: row.synced_at ? new Date(Number(row.synced_at)) : undefined,
      logFile: String(row.log_file || ''),
      logFileArchived: row.log_file_archived ? String(row.log_file_archived) : undefined
    };
  }

  /**
   * Convert a search result row to SearchResult
   */
  private rowToSearchResult(row: Record<string, unknown>): SearchResult {
    const matches: SearchMatch[] = [];

    if (row.summary_hl) {
      matches.push({
        field: 'summary',
        text: String(row.summary || ''),
        highlight: String(row.summary_hl)
      });
    }

    if (row.description_hl) {
      matches.push({
        field: 'description',
        text: String(row.description || ''),
        highlight: String(row.description_hl)
      });
    }

    return {
      session: this.rowToSession(row),
      score: Math.abs(Number(row.score) || 0),
      matches
    };
  }

  /**
   * Safely parse JSON from database
   */
  private parseJson<T>(value: unknown): T[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  }
}

/**
 * Get the default database path
 */
export function getDefaultDbPath(): string {
  return DB_PATH;
}
