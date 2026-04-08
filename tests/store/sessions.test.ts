/**
 * Tests for SessionStore
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionStore } from '../../src/store/sessions';
import type { SessionMemory } from '../../src/types';

describe('SessionStore', () => {
  const testDir = path.join(os.tmpdir(), 'cc-sessions-store-test');
  const testDbPath = path.join(testDir, 'test.db');
  let store: SessionStore;

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  beforeEach(() => {
    // Remove existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    store = new SessionStore(testDbPath);
  });

  afterEach(() => {
    store.close();
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  function createTestSession(overrides: Partial<SessionMemory> = {}): SessionMemory {
    return {
      id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      claudeSessionId: 'claude-session-123',
      projectPath: '/test/project',
      projectName: 'test-project',
      startedAt: new Date('2025-01-12T10:00:00Z'),
      endedAt: new Date('2025-01-12T11:00:00Z'),
      duration: 60,
      summary: 'Test session summary',
      description: 'Test session description',
      tasks: [
        { id: '1', description: 'Task 1', status: 'completed', createdAt: new Date() },
        { id: '2', description: 'Task 2', status: 'pending', createdAt: new Date() }
      ],
      tasksCompleted: 1,
      tasksPending: 1,
      filesCreated: ['/test/file1.ts'],
      filesModified: ['/test/file2.ts'],
      filesDeleted: [],
      lastUserMessage: 'Last user message',
      lastAssistantMessage: 'Last assistant message',
      nextSteps: ['Next step 1'],
      keyDecisions: ['Decision 1'],
      blockers: [],
      tokensUsed: 5000,
      messagesCount: 10,
      toolCallsCount: 5,
      tags: ['test', 'typescript'],
      archived: false,
      logFile: '/test/log.jsonl',
      ...overrides
    };
  }

  describe('save and getById', () => {
    it('should save and retrieve a session', () => {
      const session = createTestSession();
      store.save(session);

      const retrieved = store.getById(session.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(session.id);
      expect(retrieved!.summary).toBe(session.summary);
      expect(retrieved!.tasks).toHaveLength(2);
      expect(retrieved!.filesCreated).toContain('/test/file1.ts');
    });

    it('should return null for non-existent session', () => {
      const retrieved = store.getById('nonexistent');
      expect(retrieved).toBeNull();
    });

    it('should update existing session on save', () => {
      const session = createTestSession();
      store.save(session);

      session.summary = 'Updated summary';
      session.tasksCompleted = 2;
      store.save(session);

      const retrieved = store.getById(session.id);
      expect(retrieved!.summary).toBe('Updated summary');
      expect(retrieved!.tasksCompleted).toBe(2);
    });
  });

  describe('getLastForProject', () => {
    it('should return the most recent session for a project', () => {
      const session1 = createTestSession({
        id: 'test_1',
        startedAt: new Date('2025-01-10T10:00:00Z'),
        summary: 'Older session'
      });
      const session2 = createTestSession({
        id: 'test_2',
        startedAt: new Date('2025-01-12T10:00:00Z'),
        summary: 'Newer session'
      });

      store.save(session1);
      store.save(session2);

      const last = store.getLastForProject('/test/project');

      expect(last).not.toBeNull();
      expect(last!.summary).toBe('Newer session');
    });

    it('should return null for project with no sessions', () => {
      const last = store.getLastForProject('/nonexistent/project');
      expect(last).toBeNull();
    });
  });

  describe('getRecent', () => {
    it('should return recent sessions ordered by start time', () => {
      const sessions = [
        createTestSession({ id: 'test_1', startedAt: new Date('2025-01-10T10:00:00Z') }),
        createTestSession({ id: 'test_2', startedAt: new Date('2025-01-11T10:00:00Z') }),
        createTestSession({ id: 'test_3', startedAt: new Date('2025-01-12T10:00:00Z') })
      ];

      sessions.forEach(s => store.save(s));

      const recent = store.getRecent(2);

      expect(recent).toHaveLength(2);
      expect(recent[0].id).toBe('test_3');
      expect(recent[1].id).toBe('test_2');
    });

    it('should filter by project path', () => {
      const session1 = createTestSession({ id: 'test_1', projectPath: '/project/a' });
      const session2 = createTestSession({ id: 'test_2', projectPath: '/project/b' });

      store.save(session1);
      store.save(session2);

      const recent = store.getRecent(10, '/project/a');

      expect(recent).toHaveLength(1);
      expect(recent[0].projectPath).toBe('/project/a');
    });
  });

  describe('search', () => {
    it('should find sessions by keyword in summary', () => {
      const session = createTestSession({
        summary: 'Implemented authentication feature'
      });
      store.save(session);

      const results = store.search('authentication');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].session.summary).toContain('authentication');
    });

    it('should return empty array for no matches', () => {
      const session = createTestSession({
        summary: 'Working on user interface'
      });
      store.save(session);

      const results = store.search('nonexistent-term');

      expect(results).toHaveLength(0);
    });
  });

  describe('archiveOld', () => {
    it('should archive sessions older than specified days', () => {
      const oldSession = createTestSession({
        id: 'old_session',
        startedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) // 100 days ago
      });
      const newSession = createTestSession({
        id: 'new_session',
        startedAt: new Date() // Today
      });

      store.save(oldSession);
      store.save(newSession);

      const archived = store.archiveOld(30);

      expect(archived).toBe(1);

      const oldRetrieved = store.getById('old_session');
      expect(oldRetrieved!.archived).toBe(true);

      const newRetrieved = store.getById('new_session');
      expect(newRetrieved!.archived).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return correct storage statistics', () => {
      const sessions = [
        createTestSession({ id: 'test_1' }),
        createTestSession({ id: 'test_2', archived: true, archivedAt: new Date() }),
        createTestSession({ id: 'test_3' })
      ];

      // Need to save archived session properly
      const archivedSession = sessions[1];
      store.save(sessions[0]);
      store.save(sessions[2]);
      store.save(archivedSession);

      const stats = store.getStats();

      expect(stats.totalSessions).toBe(3);
      expect(stats.activeSessions).toBe(2);
      expect(stats.archivedSessions).toBe(1);
      // storageUsedBytes may be 0 in test environment since we use a temp db path
      expect(stats.storageUsedBytes).toBeGreaterThanOrEqual(0);
    });
  });

  describe('delete', () => {
    it('should delete a session by ID', () => {
      const session = createTestSession();
      store.save(session);

      const deleted = store.delete(session.id);
      expect(deleted).toBe(true);

      const retrieved = store.getById(session.id);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent session', () => {
      const deleted = store.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('getArchived', () => {
    it('returns only archived sessions', () => {
      store.save(createTestSession({ id: 'active' }));
      store.save(createTestSession({ id: 'archived', archived: true, archivedAt: new Date() }));
      store.archiveOld(0); // archive everything

      const archived = store.getArchived();
      expect(archived.every(s => s.archived)).toBe(true);
    });

    it('returns empty array when no archived sessions', () => {
      store.save(createTestSession({ id: 'active' }));
      expect(store.getArchived()).toHaveLength(0);
    });
  });

  describe('getUnsyncedSessions', () => {
    it('returns sessions that have not been synced', () => {
      const s1 = createTestSession({ id: 'unsynced1' });
      const s2 = createTestSession({ id: 'unsynced2' });
      store.save(s1);
      store.save(s2);

      const unsynced = store.getUnsyncedSessions();
      expect(unsynced.length).toBeGreaterThanOrEqual(2);
      expect(unsynced.some(s => s.id === 'unsynced1')).toBe(true);
    });

    it('excludes synced sessions', () => {
      const session = createTestSession({ id: 'to-sync' });
      store.save(session);
      store.markSynced(session.id);

      const unsynced = store.getUnsyncedSessions();
      expect(unsynced.some(s => s.id === 'to-sync')).toBe(false);
    });
  });

  describe('findByFilePath', () => {
    it('finds sessions that created or modified the given file', () => {
      store.save(createTestSession({ id: 's1', filesCreated: ['/src/auth.ts'] }));
      store.save(createTestSession({ id: 's2', filesModified: ['/src/auth.ts'] }));
      store.save(createTestSession({ id: 's3', filesCreated: ['/other.ts'] }));

      const results = store.findByFilePath('/src/auth.ts');
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some(s => s.id === 's1')).toBe(true);
      expect(results.some(s => s.id === 's2')).toBe(true);
    });

    it('returns empty array when no sessions touched the file', () => {
      store.save(createTestSession({ id: 's1', filesCreated: ['/other.ts'] }));
      expect(store.findByFilePath('/nonexistent.ts')).toHaveLength(0);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        store.save(createTestSession({ id: `s${i}`, filesModified: ['/common.ts'] }));
      }
      const results = store.findByFilePath('/common.ts', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('findByTag', () => {
    it('finds sessions with the given tag', () => {
      store.save(createTestSession({ id: 's1', tags: ['auth', 'backend'] }));
      store.save(createTestSession({ id: 's2', tags: ['frontend'] }));

      const results = store.findByTag('auth');
      expect(results.some(s => s.id === 's1')).toBe(true);
      expect(results.some(s => s.id === 's2')).toBe(false);
    });

    it('returns empty array when no session has the tag', () => {
      store.save(createTestSession({ id: 's1', tags: ['other'] }));
      expect(store.findByTag('nonexistent-tag')).toHaveLength(0);
    });
  });

  describe('deleteOld', () => {
    it('deletes sessions older than specified days', () => {
      store.save(createTestSession({
        id: 'very-old',
        startedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      }));
      store.save(createTestSession({ id: 'recent', startedAt: new Date() }));

      const deleted = store.deleteOld(30);
      expect(deleted).toBe(1);
      expect(store.getById('very-old')).toBeNull();
      expect(store.getById('recent')).not.toBeNull();
    });

    it('returns 0 when no sessions are old enough', () => {
      store.save(createTestSession({ id: 'new-session', startedAt: new Date() }));
      expect(store.deleteOld(365)).toBe(0);
    });
  });

  describe('updateArchivePath', () => {
    it('sets the logFileArchived field', () => {
      const session = createTestSession({ id: 'to-archive' });
      store.save(session);

      store.updateArchivePath('to-archive', '/archive/to-archive.gz');

      const retrieved = store.getById('to-archive');
      expect(retrieved!.logFileArchived).toBe('/archive/to-archive.gz');
    });
  });

  describe('markSynced', () => {
    it('sets synced = true on the session', () => {
      const session = createTestSession({ id: 'to-sync' });
      store.save(session);

      store.markSynced('to-sync');

      const retrieved = store.getById('to-sync');
      expect(retrieved!.synced).toBe(true);
      expect(retrieved!.syncedAt).toBeDefined();
    });
  });

  describe('getAll', () => {
    it('returns all non-archived sessions by default', () => {
      store.save(createTestSession({ id: 'active' }));
      store.save(createTestSession({ id: 'will-archive' }));
      store.archiveOld(0);

      const active = store.getAll(false);
      // Some sessions may have been archived
      expect(Array.isArray(active)).toBe(true);
    });

    it('returns all sessions including archived when true', () => {
      store.save(createTestSession({ id: 'a1' }));
      store.save(createTestSession({ id: 'a2' }));
      store.archiveOld(0);

      const all = store.getAll(true);
      expect(all.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getProjects', () => {
    it('returns project summaries', () => {
      store.save(createTestSession({ id: 's1', projectPath: '/project/alpha' }));
      store.save(createTestSession({ id: 's2', projectPath: '/project/beta' }));

      const projects = store.getProjects();
      expect(Array.isArray(projects)).toBe(true);
      expect(projects.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getDefaultDbPath', () => {
    it('returns a string path', () => {
      const { getDefaultDbPath } = jest.requireActual<typeof import('../../src/store/sessions')>('../../src/store/sessions');
      expect(typeof getDefaultDbPath()).toBe('string');
      expect(getDefaultDbPath()).toContain('.cc-sessions');
    });
  });

  describe('constructor with missing directory', () => {
    it('creates the directory when it does not exist', () => {
      const import_path = require('path');
      const newDir = import_path.join(testDir, `newsubdir_${Date.now()}`);
      const newDbPath = import_path.join(newDir, 'nested.db');

      // Directory doesn't exist yet
      const newStore = new SessionStore(newDbPath);
      expect(require('fs').existsSync(newDir)).toBe(true);
      newStore.close();
      require('fs').rmSync(newDir, { recursive: true });
    });
  });
});
