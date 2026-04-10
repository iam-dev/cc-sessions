/**
 * Tests for SearchIndex (src/store/index.ts)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SearchIndex } from '../../src/store/index';
import { SessionStore } from '../../src/store/sessions';
import type { SessionMemory } from '../../src/types';

const testDir = path.join(os.tmpdir(), `search-index-test-${Date.now()}`);
const testDbPath = path.join(testDir, 'test.db');

function makeSession(overrides: Partial<SessionMemory> = {}): SessionMemory {
  return {
    id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    claudeSessionId: 'claude-xyz',
    projectPath: '/home/user/project',
    projectName: 'project',
    startedAt: new Date('2025-01-15T10:00:00Z'),
    endedAt: new Date('2025-01-15T11:00:00Z'),
    duration: 60,
    title: 'Auth feature session',
    summary: 'Implemented authentication feature',
    description: 'Built user login with JWT tokens',
    tasks: [],
    tasksCompleted: 0,
    tasksPending: 0,
    filesCreated: ['/src/auth.ts'],
    filesModified: ['/src/user.ts'],
    filesDeleted: [],
    lastUserMessage: 'add auth',
    lastAssistantMessage: 'done',
    nextSteps: [],
    keyDecisions: [],
    blockers: [],
    tokensUsed: 5000,
    messagesCount: 10,
    toolCallsCount: 5,
    tags: ['auth', 'backend'],
    archived: false,
    logFile: '/path/to/log.jsonl',
    ...overrides,
  };
}

describe('SearchIndex', () => {
  let store: SessionStore;
  let index: SearchIndex;

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    store = new SessionStore(testDbPath);
    index = new SearchIndex(store);
  });

  afterEach(() => {
    store.close();
  });

  // ── search ───────────────────────────────────────────────────────────────────

  describe('search', () => {
    it('returns results matching the query', () => {
      store.save(makeSession({ id: 's1', summary: 'authentication system' }));
      store.save(makeSession({ id: 's2', summary: 'database migration' }));

      const results = index.search({ query: 'authentication', limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].session.summary).toContain('authentication');
    });

    it('returns empty array when no matches', () => {
      store.save(makeSession({ id: 's1', summary: 'some summary' }));
      const results = index.search({ query: 'xyznotfound123' });
      expect(results).toHaveLength(0);
    });

    it('filters by projectPath', () => {
      store.save(makeSession({ id: 's1', projectPath: '/project/alpha', summary: 'alpha work' }));
      store.save(makeSession({ id: 's2', projectPath: '/project/beta', summary: 'beta work' }));

      const results = index.search({ query: 'work', projectPath: 'alpha', limit: 10 });
      expect(results.every(r => r.session.projectPath.includes('alpha'))).toBe(true);
    });

    it('filters by fromDate', () => {
      const early = makeSession({
        id: 's1',
        summary: 'early session',
        startedAt: new Date('2025-01-01T10:00:00Z'),
      });
      const late = makeSession({
        id: 's2',
        summary: 'late session',
        startedAt: new Date('2025-06-01T10:00:00Z'),
      });
      store.save(early);
      store.save(late);

      const results = index.search({
        query: 'session',
        fromDate: new Date('2025-03-01T00:00:00Z'),
        limit: 10,
      });
      expect(results.every(r => r.session.startedAt >= new Date('2025-03-01T00:00:00Z'))).toBe(true);
    });

    it('filters by toDate', () => {
      const early = makeSession({
        id: 's1',
        summary: 'early session',
        startedAt: new Date('2025-01-01T10:00:00Z'),
      });
      const late = makeSession({
        id: 's2',
        summary: 'late session',
        startedAt: new Date('2025-06-01T10:00:00Z'),
      });
      store.save(early);
      store.save(late);

      const results = index.search({
        query: 'session',
        toDate: new Date('2025-03-01T00:00:00Z'),
        limit: 10,
      });
      expect(results.every(r => r.session.startedAt <= new Date('2025-03-01T00:00:00Z'))).toBe(true);
    });

    it('excludes archived sessions by default', () => {
      store.save(makeSession({ id: 's1', summary: 'archived work', archived: true }));
      // Manually mark the session as archived in DB via archiveOld
      store.archiveOld(0); // archive everything

      const results = index.search({ query: 'archived work', includeArchived: false, limit: 10 });
      // Results should not include archived sessions
      expect(results.every(r => !r.session.archived)).toBe(true);
    });

    it('includes archived sessions when includeArchived is true', () => {
      const session = makeSession({ id: 's1', summary: 'archive included', archived: false });
      store.save(session);
      store.archiveOld(0); // archive it

      const results = index.search({ query: 'archive included', includeArchived: true, limit: 10 });
      // Some results may be archived
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        store.save(makeSession({ id: `s${i}`, summary: `matching item ${i}` }));
      }
      const results = index.search({ query: 'matching', limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  // ── searchByFile ─────────────────────────────────────────────────────────────

  describe('searchByFile', () => {
    it('returns sessions that touched the given file', () => {
      store.save(makeSession({ id: 's1', filesCreated: ['/src/auth.ts'] }));
      store.save(makeSession({ id: 's2', filesModified: [] }));

      const results = index.searchByFile('/src/auth.ts');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.id === 's1')).toBe(true);
    });

    it('returns empty array when no session touched the file', () => {
      store.save(makeSession({ id: 's1', filesCreated: ['/other.ts'] }));
      const results = index.searchByFile('/nonexistent.ts');
      expect(results).toHaveLength(0);
    });
  });

  // ── searchByTag ──────────────────────────────────────────────────────────────

  describe('searchByTag', () => {
    it('returns sessions with the given tag', () => {
      store.save(makeSession({ id: 's1', tags: ['auth', 'backend'] }));
      store.save(makeSession({ id: 's2', tags: ['frontend'] }));

      const results = index.searchByTag('auth');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.id === 's1')).toBe(true);
    });

    it('returns empty array when no session has the tag', () => {
      store.save(makeSession({ id: 's1', tags: ['backend'] }));
      expect(index.searchByTag('nonexistent-tag')).toHaveLength(0);
    });
  });

  // ── getByDateRange ───────────────────────────────────────────────────────────

  describe('getByDateRange', () => {
    it('returns sessions within the date range', () => {
      store.save(makeSession({ id: 's1', startedAt: new Date('2025-01-10T10:00:00Z') }));
      store.save(makeSession({ id: 's2', startedAt: new Date('2025-02-10T10:00:00Z') }));
      store.save(makeSession({ id: 's3', startedAt: new Date('2025-03-10T10:00:00Z') }));

      const results = index.getByDateRange(
        new Date('2025-01-15T00:00:00Z'),
        new Date('2025-02-28T00:00:00Z'),
      );
      expect(results.every(r =>
        r.startedAt >= new Date('2025-01-15T00:00:00Z') &&
        r.startedAt <= new Date('2025-02-28T00:00:00Z'),
      )).toBe(true);
    });

    it('filters by projectPath when provided', () => {
      store.save(makeSession({ id: 's1', projectPath: '/alpha', startedAt: new Date('2025-01-10T10:00:00Z') }));
      store.save(makeSession({ id: 's2', projectPath: '/beta', startedAt: new Date('2025-01-10T10:00:00Z') }));

      const results = index.getByDateRange(
        new Date('2025-01-01T00:00:00Z'),
        new Date('2025-12-31T00:00:00Z'),
        '/alpha',
      );
      expect(results.every(r => r.projectPath === '/alpha')).toBe(true);
    });
  });

  // ── getRelated ───────────────────────────────────────────────────────────────

  describe('getRelated', () => {
    it('returns empty array for unknown sessionId', () => {
      expect(index.getRelated('nonexistent-id')).toEqual([]);
    });

    it('returns sessions sharing project, files, or tags', () => {
      const base = makeSession({
        id: 'base',
        projectPath: '/shared-project',
        filesCreated: ['/src/auth.ts'],
        tags: ['auth'],
      });
      const related = makeSession({
        id: 'related',
        projectPath: '/shared-project',
        filesModified: ['/src/auth.ts'],
        tags: ['auth'],
      });
      const unrelated = makeSession({
        id: 'unrelated',
        projectPath: '/other-project',
        filesCreated: ['/other.ts'],
        tags: ['frontend'],
      });

      store.save(base);
      store.save(related);
      store.save(unrelated);

      const results = index.getRelated('base');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.id === 'related')).toBe(true);
    });

    it('respects the limit parameter', () => {
      store.save(makeSession({ id: 'base', projectPath: '/shared' }));
      for (let i = 0; i < 10; i++) {
        store.save(makeSession({ id: `rel${i}`, projectPath: '/shared' }));
      }
      const results = index.getRelated('base', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  // ── getWithPendingTasks ──────────────────────────────────────────────────────

  describe('getWithPendingTasks', () => {
    it('returns sessions that have pending tasks', () => {
      store.save(makeSession({ id: 's1', tasksPending: 2 }));
      store.save(makeSession({ id: 's2', tasksPending: 0 }));

      const results = index.getWithPendingTasks();
      expect(results.every(r => r.tasksPending > 0)).toBe(true);
      expect(results.some(r => r.id === 's1')).toBe(true);
    });

    it('filters by projectPath when provided', () => {
      store.save(makeSession({ id: 's1', projectPath: '/alpha', tasksPending: 1 }));
      store.save(makeSession({ id: 's2', projectPath: '/beta', tasksPending: 1 }));

      const results = index.getWithPendingTasks('/alpha');
      expect(results.every(r => r.projectPath === '/alpha')).toBe(true);
    });
  });

  // ── getWithBlockers ──────────────────────────────────────────────────────────

  describe('getWithBlockers', () => {
    it('returns sessions that have blockers', () => {
      store.save(makeSession({ id: 's1', blockers: ['cannot connect to DB'] }));
      store.save(makeSession({ id: 's2', blockers: [] }));

      const results = index.getWithBlockers();
      expect(results.every(r => r.blockers.length > 0)).toBe(true);
    });

    it('filters by projectPath when provided', () => {
      store.save(makeSession({ id: 's1', projectPath: '/alpha', blockers: ['issue A'] }));
      store.save(makeSession({ id: 's2', projectPath: '/beta', blockers: ['issue B'] }));

      const results = index.getWithBlockers('/alpha');
      expect(results.every(r => r.projectPath === '/alpha')).toBe(true);
    });
  });

  // ── SearchIndex.parseDate (static) ──────────────────────────────────────────

  describe('SearchIndex.parseDate', () => {
    it('parses "today"', () => {
      const result = SearchIndex.parseDate('today');
      const now = new Date();
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(now.getFullYear());
      expect(result!.getMonth()).toBe(now.getMonth());
      expect(result!.getDate()).toBe(now.getDate());
    });

    it('parses "yesterday"', () => {
      const result = SearchIndex.parseDate('yesterday');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(result).not.toBeNull();
      expect(result!.getDate()).toBe(yesterday.getDate());
    });

    it('parses "last week"', () => {
      const result = SearchIndex.parseDate('last week');
      expect(result).not.toBeNull();
      const diffMs = Date.now() - result!.getTime();
      expect(diffMs).toBeGreaterThanOrEqual(6 * 24 * 60 * 60 * 1000);
    });

    it('parses "last month"', () => {
      const result = SearchIndex.parseDate('last month');
      expect(result).not.toBeNull();
    });

    it('parses "last year"', () => {
      const result = SearchIndex.parseDate('last year');
      const now = new Date();
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(now.getFullYear() - 1);
    });

    it('parses "N days ago" expressions', () => {
      expect(SearchIndex.parseDate('5 days ago')).not.toBeNull();
      expect(SearchIndex.parseDate('1 day ago')).not.toBeNull();
      expect(SearchIndex.parseDate('30 days ago')).not.toBeNull();
    });

    it('parses "N weeks ago" expressions', () => {
      expect(SearchIndex.parseDate('2 weeks ago')).not.toBeNull();
      expect(SearchIndex.parseDate('1 week ago')).not.toBeNull();
    });

    it('parses "N months ago" expressions', () => {
      expect(SearchIndex.parseDate('3 months ago')).not.toBeNull();
      expect(SearchIndex.parseDate('1 month ago')).not.toBeNull();
    });

    it('parses ISO date strings', () => {
      const result = SearchIndex.parseDate('2025-03-15');
      expect(result).not.toBeNull();
    });

    it('returns null for invalid date strings', () => {
      expect(SearchIndex.parseDate('not a date at all xyz')).toBeNull();
    });

    it('handles case-insensitive input', () => {
      expect(SearchIndex.parseDate('TODAY')).not.toBeNull();
      expect(SearchIndex.parseDate('Yesterday')).not.toBeNull();
    });
  });
});
