/**
 * Retention Manager for cc-sessions
 *
 * Handles session archival, compression, and cleanup based on retention policies.
 * Also manages overriding Claude's default 30-day log retention.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import type { RetentionConfig, CleanupReport, SessionMemory } from '../types';
import { SessionStore } from './sessions';

const ARCHIVE_DIR = path.join(os.homedir(), '.cc-sessions', 'archive');
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

export class RetentionManager {
  private store: SessionStore;
  private config: RetentionConfig;

  constructor(store: SessionStore, config: RetentionConfig) {
    this.store = store;
    this.config = config;

    // Ensure archive directory exists
    if (!fs.existsSync(ARCHIVE_DIR)) {
      fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    }

    // Override Claude's retention if configured
    if (config.overrideClaudeRetention) {
      this.overrideClaudeRetention();
    }
  }

  /**
   * Parse retention string to number of days
   */
  parseDays(retention: string): number {
    if (retention === 'forever') return Infinity;

    const match = retention.match(/^(\d+)(d|m|y)$/);
    if (!match) return 30; // Default to 30 days

    const [, numStr, unit] = match;
    const num = parseInt(numStr, 10);

    switch (unit) {
      case 'd': return num;
      case 'm': return num * 30;
      case 'y': return num * 365;
      default: return 30;
    }
  }

  /**
   * Run cleanup based on retention configuration
   */
  async runCleanup(): Promise<CleanupReport> {
    const report: CleanupReport = {
      sessionsArchived: 0,
      sessionsDeleted: 0,
      bytesFreed: 0,
      logFilesBackedUp: 0
    };

    const fullDays = this.parseDays(this.config.fullSessions);
    const archiveDays = this.parseDays(this.config.archives);

    // Step 1: Archive sessions older than fullSessions retention
    if (fullDays !== Infinity) {
      report.sessionsArchived = this.store.archiveOld(fullDays);
    }

    // Step 2: Compress log files for archived sessions
    const archivedSessions = this.store.getArchived();
    for (const session of archivedSessions) {
      if (session.logFile && !session.logFileArchived) {
        const archived = await this.compressLogFile(session);
        if (archived) {
          report.logFilesBackedUp++;
        }
      }
    }

    // Step 3: Delete sessions beyond archive retention
    if (archiveDays !== Infinity) {
      const beforeCount = this.store.getStats().totalSessions;
      report.sessionsDeleted = this.store.deleteOld(archiveDays);
      const afterCount = this.store.getStats().totalSessions;

      // Estimate bytes freed (rough estimate)
      if (report.sessionsDeleted > 0) {
        report.bytesFreed = (beforeCount - afterCount) * 5000; // ~5KB per session
      }
    }

    // Step 4: Check storage limits and trim if needed
    const stats = this.store.getStats();
    const maxBytes = this.config.maxStorageGb * 1e9;

    if (stats.storageUsedBytes > maxBytes) {
      const trimReport = await this.trimToStorageLimit(maxBytes);
      report.sessionsDeleted += trimReport.deleted;
      report.bytesFreed += trimReport.bytesFreed;
    }

    return report;
  }

  /**
   * Compress a log file to the archive directory
   */
  async compressLogFile(session: SessionMemory): Promise<string | null> {
    if (!session.logFile || !fs.existsSync(session.logFile)) {
      return null;
    }

    try {
      const archivePath = path.join(ARCHIVE_DIR, `${session.id}.jsonl.gz`);

      const content = fs.readFileSync(session.logFile);
      const compressed = zlib.gzipSync(content, { level: 9 });

      fs.writeFileSync(archivePath, compressed);

      // Update session with archive path
      this.store.updateArchivePath(session.id, archivePath);

      return archivePath;
    } catch (error) {
      console.error(`Failed to compress log file for session ${session.id}:`, error);
      return null;
    }
  }

  /**
   * Decompress an archived log file
   */
  decompressLogFile(archivePath: string): string | null {
    if (!fs.existsSync(archivePath)) {
      return null;
    }

    try {
      const compressed = fs.readFileSync(archivePath);
      const content = zlib.gunzipSync(compressed);
      return content.toString('utf-8');
    } catch (error) {
      console.error(`Failed to decompress log file ${archivePath}:`, error);
      return null;
    }
  }

  /**
   * Override Claude's default 30-day log retention
   */
  overrideClaudeRetention(): boolean {
    try {
      let settings: Record<string, unknown> = {};

      if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
        const content = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
        settings = JSON.parse(content);
      } else {
        // Ensure directory exists
        const dir = path.dirname(CLAUDE_SETTINGS_PATH);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      // Set retention to ~100 years (essentially forever)
      // Claude Code accepts logRetentionDays setting
      settings.logRetentionDays = 36500;

      fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');

      return true;
    } catch (error) {
      console.error('Failed to override Claude retention settings:', error);
      return false;
    }
  }

  /**
   * Check if Claude's retention has been overridden
   */
  isClaudeRetentionOverridden(): boolean {
    try {
      if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
        return false;
      }

      const content = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
      const settings = JSON.parse(content);

      return settings.logRetentionDays && settings.logRetentionDays > 365;
    } catch {
      return false;
    }
  }

  /**
   * Calculate total storage used by cc-sessions
   */
  calculateStorageUsed(): number {
    const memoryDir = path.join(os.homedir(), '.cc-sessions');
    return this.getDirSize(memoryDir);
  }

  /**
   * Get the size of a directory recursively
   */
  private getDirSize(dir: string): number {
    if (!fs.existsSync(dir)) return 0;

    let size = 0;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          size += this.getDirSize(fullPath);
        } else {
          try {
            size += fs.statSync(fullPath).size;
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Return what we have so far
    }

    return size;
  }

  /**
   * Trim storage to fit within limit
   */
  private async trimToStorageLimit(maxBytes: number): Promise<{ deleted: number; bytesFreed: number }> {
    const result = { deleted: 0, bytesFreed: 0 };

    // Get all sessions ordered by date (oldest first)
    const sessions = this.store.getAll(true).sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
    );

    let currentSize = this.calculateStorageUsed();

    for (const session of sessions) {
      if (currentSize <= maxBytes) break;

      // Delete archived log file if exists
      if (session.logFileArchived && fs.existsSync(session.logFileArchived)) {
        const fileSize = fs.statSync(session.logFileArchived).size;
        fs.unlinkSync(session.logFileArchived);
        result.bytesFreed += fileSize;
      }

      // Delete session from database
      if (this.store.delete(session.id)) {
        result.deleted++;
        result.bytesFreed += 5000; // Estimate DB space
      }

      currentSize = this.calculateStorageUsed();
    }

    return result;
  }

  /**
   * Get archive directory path
   */
  getArchiveDir(): string {
    return ARCHIVE_DIR;
  }

  /**
   * List all archived files
   */
  listArchivedFiles(): string[] {
    if (!fs.existsSync(ARCHIVE_DIR)) return [];

    return fs.readdirSync(ARCHIVE_DIR)
      .filter(f => f.endsWith('.gz'))
      .map(f => path.join(ARCHIVE_DIR, f));
  }
}
