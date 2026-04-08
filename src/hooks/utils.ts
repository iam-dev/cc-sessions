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
