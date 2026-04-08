/**
 * Shared utilities for cc-sessions hooks
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { findAllLogFiles } from '../parser/jsonl';

/**
 * Generate a unique session memory ID
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `mem_${timestamp}_${random}`;
}

/**
 * Find the log file for the current session
 */
export function findCurrentSessionLog(
  sessionId: string,
  cwd: string,
  recentThresholdMs: number = 5 * 60 * 1000
): string | null {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

  if (!fs.existsSync(claudeProjectsDir)) {
    return null;
  }

  const allLogs = findAllLogFiles();

  if (allLogs.length === 0) {
    return null;
  }

  // Sort by modification time (most recent first)
  const sortedLogs = allLogs
    .map(logPath => ({
      path: logPath,
      mtime: fs.statSync(logPath).mtime.getTime()
    }))
    .sort((a, b) => b.mtime - a.mtime);

  // First, try to find by session ID in the filename
  const bySessionId = sortedLogs.find(log =>
    path.basename(log.path, '.jsonl').includes(sessionId)
  );
  if (bySessionId) {
    return bySessionId.path;
  }

  // Next, try to find by project path
  const encodedCwd = encodeURIComponent(cwd);
  const byCwd = sortedLogs.find(log => log.path.includes(encodedCwd));
  if (byCwd) {
    return byCwd.path;
  }

  // Fall back to most recently modified log file within the threshold
  const mostRecent = sortedLogs[0];
  const cutoff = Date.now() - recentThresholdMs;

  if (mostRecent && mostRecent.mtime > cutoff) {
    return mostRecent.path;
  }

  return null;
}

/**
 * Find the most recently modified JSONL file in projectDir that:
 * - is NOT the new session's transcript_path (path.resolve comparison)
 * - is NOT empty (size > 0)
 * - has mtime within the last maxAgeMinutes minutes
 *
 * Returns null if no matching file is found.
 */
export function findPreviousSessionLog(
  projectDir: string,
  excludePath: string,
  maxAgeMinutes = 60,
): string | null {
  if (!fs.existsSync(projectDir)) return null;

  const normalizedExclude = path.resolve(excludePath);
  const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;

  const candidates: Array<{ p: string; mtime: number }> = [];

  try {
    const entries = fs.readdirSync(projectDir);
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const fullPath = path.resolve(path.join(projectDir, entry));
      if (fullPath === normalizedExclude) continue;

      const stat = fs.statSync(fullPath);
      if (stat.size === 0) continue;
      if (stat.mtime.getTime() < cutoff) continue;

      candidates.push({ p: fullPath, mtime: stat.mtime.getTime() });
    }
  } catch {
    return null;
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].p;
}
