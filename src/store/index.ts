/**
 * Search Index for cc-sessions
 *
 * Provides advanced search functionality on top of the SQLite FTS5 store.
 */

import type { SearchResult, SearchOptions, SessionMemory } from '../types';
import { SessionStore } from './sessions';

export class SearchIndex {
  private store: SessionStore;

  constructor(store: SessionStore) {
    this.store = store;
  }

  /**
   * Search sessions with advanced options
   */
  search(options: SearchOptions): SearchResult[] {
    const { query, projectPath, fromDate, toDate, limit = 20, includeArchived = false } = options;

    // Start with basic FTS search
    let results = this.store.search(query, limit * 2); // Get more for filtering

    // Apply filters
    results = results.filter(result => {
      const session = result.session;

      // Filter by project
      if (projectPath && !session.projectPath.includes(projectPath)) {
        return false;
      }

      // Filter by date range
      if (fromDate && session.startedAt < fromDate) {
        return false;
      }
      if (toDate && session.startedAt > toDate) {
        return false;
      }

      // Filter archived
      if (!includeArchived && session.archived) {
        return false;
      }

      return true;
    });

    // Re-rank and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Search by file path - find all sessions that touched a specific file
   */
  searchByFile(filePath: string, limit: number = 20): SessionMemory[] {
    // Get all sessions and filter by file
    const sessions = this.store.getAll(true);

    return sessions
      .filter(session => {
        const allFiles = [
          ...session.filesCreated,
          ...session.filesModified,
          ...session.filesDeleted
        ];
        return allFiles.some(f => f.includes(filePath));
      })
      .slice(0, limit);
  }

  /**
   * Search by tag
   */
  searchByTag(tag: string, limit: number = 20): SessionMemory[] {
    const sessions = this.store.getAll(false);

    return sessions
      .filter(session =>
        session.tags.some(t => t.toLowerCase() === tag.toLowerCase())
      )
      .slice(0, limit);
  }

  /**
   * Get sessions within a date range
   */
  getByDateRange(fromDate: Date, toDate: Date, projectPath?: string): SessionMemory[] {
    const sessions = projectPath
      ? this.store.getRecent(1000, projectPath)
      : this.store.getAll(false);

    return sessions.filter(session =>
      session.startedAt >= fromDate && session.startedAt <= toDate
    );
  }

  /**
   * Get related sessions - sessions that worked on similar files or topics
   */
  getRelated(sessionId: string, limit: number = 5): SessionMemory[] {
    const session = this.store.getById(sessionId);
    if (!session) return [];

    const allFiles = [...session.filesCreated, ...session.filesModified];
    const tags = session.tags;

    // Score other sessions by similarity
    const sessions = this.store.getAll(false).filter(s => s.id !== sessionId);

    const scored = sessions.map(s => {
      let score = 0;

      // Same project gets a boost
      if (s.projectPath === session.projectPath) {
        score += 5;
      }

      // Count shared files
      const sFiles = [...s.filesCreated, ...s.filesModified];
      for (const file of allFiles) {
        if (sFiles.includes(file)) {
          score += 3;
        }
      }

      // Count shared tags
      for (const tag of tags) {
        if (s.tags.includes(tag)) {
          score += 2;
        }
      }

      return { session: s, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.session);
  }

  /**
   * Get sessions with pending tasks
   */
  getWithPendingTasks(projectPath?: string): SessionMemory[] {
    const sessions = projectPath
      ? this.store.getRecent(100, projectPath)
      : this.store.getAll(false);

    return sessions.filter(session => session.tasksPending > 0);
  }

  /**
   * Get sessions with blockers
   */
  getWithBlockers(projectPath?: string): SessionMemory[] {
    const sessions = projectPath
      ? this.store.getRecent(100, projectPath)
      : this.store.getAll(false);

    return sessions.filter(session => session.blockers.length > 0);
  }

  /**
   * Parse natural language date strings
   */
  static parseDate(dateStr: string): Date | null {
    const now = new Date();

    // Handle relative dates
    const lower = dateStr.toLowerCase().trim();

    if (lower === 'today') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    if (lower === 'yesterday') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      d.setDate(d.getDate() - 1);
      return d;
    }

    if (lower === 'last week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    }

    if (lower === 'last month') {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return d;
    }

    if (lower === 'last year') {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      return d;
    }

    // Try parsing as a number of days ago
    const daysAgoMatch = lower.match(/(\d+)\s*days?\s*ago/);
    if (daysAgoMatch) {
      const d = new Date(now);
      d.setDate(d.getDate() - parseInt(daysAgoMatch[1], 10));
      return d;
    }

    // Try parsing as a number of weeks ago
    const weeksAgoMatch = lower.match(/(\d+)\s*weeks?\s*ago/);
    if (weeksAgoMatch) {
      const d = new Date(now);
      d.setDate(d.getDate() - parseInt(weeksAgoMatch[1], 10) * 7);
      return d;
    }

    // Try parsing as a number of months ago
    const monthsAgoMatch = lower.match(/(\d+)\s*months?\s*ago/);
    if (monthsAgoMatch) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - parseInt(monthsAgoMatch[1], 10));
      return d;
    }

    // Try parsing as ISO date or common formats
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    return null;
  }
}
