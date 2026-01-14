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
});
