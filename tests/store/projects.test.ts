/**
 * TDD tests for SessionStore.getProjects()
 * Written BEFORE implementation — expected to fail until production code is added.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { SessionStore } from '../../src/store/sessions';
import type { SessionMemory } from '../../src/types';

function makeSession(overrides: Partial<SessionMemory> = {}): SessionMemory {
  return {
    id: `test-${Math.random().toString(36).slice(2, 10)}`,
    claudeSessionId: 'claude-test',
    projectPath: '/test/project',
    projectName: 'test-project',
    startedAt: new Date('2024-06-01T10:00:00Z'),
    endedAt: new Date('2024-06-01T10:30:00Z'),
    duration: 30,
    title: 'Test session title',
    summary: 'Test session summary',
    description: 'Test description',
    tasks: [],
    tasksCompleted: 0,
    tasksPending: 0,
    filesCreated: [],
    filesModified: [],
    filesDeleted: [],
    lastUserMessage: 'test message',
    lastAssistantMessage: 'test response',
    nextSteps: [],
    keyDecisions: [],
    blockers: [],
    tokensUsed: 1000,
    messagesCount: 10,
    toolCallsCount: 5,
    tags: [],
    archived: false,
    logFile: '/tmp/test.jsonl',
    ...overrides,
  };
}

describe('SessionStore.getProjects()', () => {
  let store: SessionStore;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sessions-projects-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    store = new SessionStore(dbPath);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  test('returns empty array when no sessions exist', () => {
    const projects = store.getProjects();
    expect(projects).toEqual([]);
  });

  test('returns one project entry for sessions sharing the same project path', () => {
    store.save(makeSession({ projectPath: '/myapp', projectName: 'myapp' }));
    store.save(makeSession({ projectPath: '/myapp', projectName: 'myapp' }));

    const projects = store.getProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0]!.projectPath).toBe('/myapp');
    expect(projects[0]!.projectName).toBe('myapp');
  });

  test('returns separate project entries for different project paths', () => {
    store.save(makeSession({ projectPath: '/app-a', projectName: 'app-a' }));
    store.save(makeSession({ projectPath: '/app-b', projectName: 'app-b' }));

    const projects = store.getProjects();

    expect(projects).toHaveLength(2);
    const paths = projects.map(p => p.projectPath);
    expect(paths).toContain('/app-a');
    expect(paths).toContain('/app-b');
  });

  test('returns correct session count per project', () => {
    store.save(makeSession({ projectPath: '/myapp', projectName: 'myapp' }));
    store.save(makeSession({ projectPath: '/myapp', projectName: 'myapp' }));
    store.save(makeSession({ projectPath: '/other', projectName: 'other' }));

    const projects = store.getProjects();
    const myapp = projects.find(p => p.projectPath === '/myapp');
    const other = projects.find(p => p.projectPath === '/other');

    expect(myapp?.sessionCount).toBe(2);
    expect(other?.sessionCount).toBe(1);
  });

  test('returns the most recent session date as lastSessionAt', () => {
    const earlier = new Date('2024-01-01T10:00:00Z');
    const later = new Date('2024-06-15T10:00:00Z');

    store.save(makeSession({ projectPath: '/myapp', startedAt: earlier, endedAt: earlier }));
    store.save(makeSession({ projectPath: '/myapp', startedAt: later, endedAt: later }));

    const projects = store.getProjects();
    const myapp = projects.find(p => p.projectPath === '/myapp');

    expect(myapp?.lastSessionAt.getTime()).toBe(later.getTime());
  });

  test('orders projects by most recent activity first', () => {
    const d1 = new Date('2024-01-01T00:00:00Z');
    const d2 = new Date('2024-06-01T00:00:00Z');

    store.save(makeSession({ projectPath: '/old', projectName: 'old', startedAt: d1, endedAt: d1 }));
    store.save(makeSession({ projectPath: '/new', projectName: 'new', startedAt: d2, endedAt: d2 }));

    const projects = store.getProjects();

    expect(projects[0]!.projectPath).toBe('/new');
    expect(projects[1]!.projectPath).toBe('/old');
  });

  test('excludes archived sessions from project counts', () => {
    store.save(makeSession({ projectPath: '/myapp', projectName: 'myapp', archived: false }));
    store.save(makeSession({ projectPath: '/myapp', projectName: 'myapp', archived: true }));

    const projects = store.getProjects();
    const myapp = projects.find(p => p.projectPath === '/myapp');

    expect(myapp?.sessionCount).toBe(1);
  });

  test('omits projects whose only sessions are archived', () => {
    store.save(makeSession({ projectPath: '/ghost', projectName: 'ghost', archived: true }));

    const projects = store.getProjects();

    expect(projects.find(p => p.projectPath === '/ghost')).toBeUndefined();
  });

  test('returns the summary from the most recent session as lastSummary', () => {
    const earlier = new Date('2024-01-01T00:00:00Z');
    const later = new Date('2024-06-01T00:00:00Z');

    store.save(makeSession({
      projectPath: '/myapp',
      startedAt: earlier,
      endedAt: earlier,
      summary: 'First session summary',
    }));
    store.save(makeSession({
      projectPath: '/myapp',
      startedAt: later,
      endedAt: later,
      summary: 'Latest session summary',
    }));

    const projects = store.getProjects();
    const myapp = projects.find(p => p.projectPath === '/myapp');

    expect(myapp?.lastSummary).toBe('Latest session summary');
  });

  test('aggregates total tokens used across all project sessions', () => {
    store.save(makeSession({ projectPath: '/myapp', tokensUsed: 1000 }));
    store.save(makeSession({ projectPath: '/myapp', tokensUsed: 2500 }));

    const projects = store.getProjects();
    const myapp = projects.find(p => p.projectPath === '/myapp');

    expect(myapp?.totalTokens).toBe(3500);
  });

  test('aggregates total duration across all project sessions', () => {
    store.save(makeSession({ projectPath: '/myapp', duration: 30 }));
    store.save(makeSession({ projectPath: '/myapp', duration: 45 }));

    const projects = store.getProjects();
    const myapp = projects.find(p => p.projectPath === '/myapp');

    expect(myapp?.totalDuration).toBe(75);
  });
});
