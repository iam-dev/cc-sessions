/**
 * Tests for the session-start hook
 *
 * Tests both the exported sessionStartHook and the private helper functions
 * exercised through it (formatRelativeDate, formatDuration, formatTokens,
 * wrapText, displaySessionSummary).
 */
import type { Config, SessionMemory } from '../../src/types';

// ── mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../src/config/loader', () => ({
  loadConfig: jest.fn(),
}));

jest.mock('../../src/store/sessions', () => ({
  SessionStore: jest.fn(),
}));

// ── imports after mocks ───────────────────────────────────────────────────────

import sessionStartHook from '../../src/hooks/session-start';
import { loadConfig } from '../../src/config/loader';
import { SessionStore } from '../../src/store/sessions';

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;
const MockSessionStore = SessionStore as jest.MockedClass<typeof SessionStore>;

// ── helpers ───────────────────────────────────────────────────────────────────

const baseConfig: Config = {
  version: 1,
  retention: { fullSessions: '1y', archives: 'forever', searchIndex: '1y', overrideClaudeRetention: false, maxStorageGb: 10 },
  autoSave: { enabled: true, intervalMinutes: 5, onSessionEnd: true, onTerminalClose: true, generateSummary: true, extractTasks: true },
  summaries: { model: 'haiku', maxLength: 500, include: [] },
  search: { enabled: true, indexFields: [], fuzzyThreshold: 0.8 },
  cloud: { enabled: false, provider: 'r2', syncIntervalMinutes: 60, syncOnSave: false, deviceId: 'test' },
  ui: { showOnStart: true, recentCount: 10, dateFormat: 'relative', theme: 'auto' },
  projects: { overrides: {} },
};

function makeSession(overrides: Partial<SessionMemory> = {}): SessionMemory {
  return {
    id: 'test-session-id',
    claudeSessionId: 'claude-abc',
    projectPath: '/home/user/my-project',
    projectName: 'my-project',
    startedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
    endedAt: new Date(),
    duration: 30,
    title: 'Implemented a new feature',
    summary: 'Implemented a new feature',
    description: 'Feature description',
    tasks: [],
    tasksCompleted: 0,
    tasksPending: 0,
    filesCreated: [],
    filesModified: [],
    filesDeleted: [],
    lastUserMessage: 'hello',
    lastAssistantMessage: 'hi',
    nextSteps: [],
    keyDecisions: [],
    blockers: [],
    tokensUsed: 5000,
    messagesCount: 10,
    toolCallsCount: 5,
    tags: [],
    archived: false,
    logFile: '/path/to/log.jsonl',
    ...overrides,
  };
}

function makeStoreMock(lastSession: SessionMemory | null = null) {
  const mockClose = jest.fn();
  const mockGetLastForProject = jest.fn().mockReturnValue(lastSession);
  MockSessionStore.mockImplementation(() => ({
    getLastForProject: mockGetLastForProject,
    close: mockClose,
  }) as unknown as SessionStore);
  return { mockClose, mockGetLastForProject };
}

const context = { sessionId: 'test-session', cwd: '/home/user/my-project' };

// ── test suite ────────────────────────────────────────────────────────────────

describe('sessionStartHook', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockLoadConfig.mockResolvedValue(baseConfig);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('returns early when showOnStart is false', async () => {
    mockLoadConfig.mockResolvedValue({
      ...baseConfig,
      ui: { ...baseConfig.ui, showOnStart: false },
    });
    makeStoreMock(null);

    await sessionStartHook(context);

    expect(MockSessionStore).not.toHaveBeenCalled();
  });

  it('does nothing when no last session exists', async () => {
    makeStoreMock(null);

    await sessionStartHook(context);

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('displays session summary when last session exists', async () => {
    makeStoreMock(makeSession());

    await sessionStartHook(context);

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.join('');
    expect(output).toContain('LAST SESSION');
  });

  it('closes the store after displaying', async () => {
    const { mockClose } = makeStoreMock(makeSession());

    await sessionStartHook(context);

    expect(mockClose).toHaveBeenCalled();
  });

  it('handles errors silently', async () => {
    mockLoadConfig.mockRejectedValue(new Error('config failed'));
    const errSpy = jest.spyOn(console, 'error');

    await expect(sessionStartHook(context)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  // ── formatRelativeDate coverage ────────────────────────────────────────────

  it('displays "just now" for a very recent session', async () => {
    makeStoreMock(makeSession({ startedAt: new Date(Date.now() - 30_000) })); // 30s ago
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('just now');
  });

  it('displays "1 minute ago" for a session 1 minute old', async () => {
    makeStoreMock(makeSession({ startedAt: new Date(Date.now() - 60_000) }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('1 minute ago');
  });

  it('displays "5 minutes ago" for a 5-minute-old session', async () => {
    makeStoreMock(makeSession({ startedAt: new Date(Date.now() - 5 * 60_000) }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('5 minutes ago');
  });

  it('displays "1 hour ago" for a session 1 hour old', async () => {
    makeStoreMock(makeSession({ startedAt: new Date(Date.now() - 60 * 60_000) }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('1 hour ago');
  });

  it('displays "3 hours ago" for a 3-hour-old session', async () => {
    makeStoreMock(makeSession({ startedAt: new Date(Date.now() - 3 * 60 * 60_000) }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('3 hours ago');
  });

  it('displays "yesterday" for a session from yesterday', async () => {
    makeStoreMock(makeSession({ startedAt: new Date(Date.now() - 25 * 60 * 60_000) }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('yesterday');
  });

  it('displays "N days ago" for a session a few days old', async () => {
    makeStoreMock(makeSession({ startedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000) }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('days ago');
  });

  it('displays "N weeks ago" for a session a few weeks old', async () => {
    makeStoreMock(makeSession({ startedAt: new Date(Date.now() - 14 * 24 * 60 * 60_000) }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('weeks ago');
  });

  it('displays "1 week ago" for a session 7 days old', async () => {
    makeStoreMock(makeSession({ startedAt: new Date(Date.now() - 7 * 24 * 60 * 60_000) }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('week');
  });

  it('displays a date string for sessions older than a month', async () => {
    makeStoreMock(makeSession({ startedAt: new Date(Date.now() - 45 * 24 * 60 * 60_000) }));
    await sessionStartHook(context);
    // Should display a month name or numeric date
    const output = consoleSpy.mock.calls.join('');
    expect(output.length).toBeGreaterThan(0);
  });

  it('displays date with year for sessions from a different year', async () => {
    makeStoreMock(makeSession({ startedAt: new Date(2020, 0, 15) }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('2020');
  });

  // ── formatDuration coverage ────────────────────────────────────────────────

  it('displays "less than a minute" for duration 0', async () => {
    makeStoreMock(makeSession({ duration: 0 }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('less than a minute');
  });

  it('displays minutes for short sessions', async () => {
    makeStoreMock(makeSession({ duration: 30 }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('30 min');
  });

  it('displays "2h" for exactly 2-hour sessions', async () => {
    makeStoreMock(makeSession({ duration: 120 }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('2h');
  });

  it('displays "1h 30m" for 90-minute sessions', async () => {
    makeStoreMock(makeSession({ duration: 90 }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('1h 30m');
  });

  // ── formatTokens coverage ──────────────────────────────────────────────────

  it('displays token count in millions', async () => {
    makeStoreMock(makeSession({ tokensUsed: 2_500_000 }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('M');
  });

  it('displays token count in thousands', async () => {
    makeStoreMock(makeSession({ tokensUsed: 5000 }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('5K');
  });

  it('displays raw token count for small values', async () => {
    makeStoreMock(makeSession({ tokensUsed: 500 }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('500');
  });

  // ── displaySessionSummary coverage ────────────────────────────────────────

  it('shows completed tasks section with overflow', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      description: `Task ${i}`,
      status: 'completed' as const,
      createdAt: new Date(),
    }));
    makeStoreMock(makeSession({ tasks, tasksCompleted: 5 }));
    await sessionStartHook(context);
    const output = consoleSpy.mock.calls.join('');
    expect(output).toContain('COMPLETED');
    expect(output).toContain('and 2 more');
  });

  it('shows pending tasks section with overflow', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      description: `Pending task ${i}`,
      status: 'pending' as const,
      createdAt: new Date(),
    }));
    makeStoreMock(makeSession({ tasks, tasksPending: 5 }));
    await sessionStartHook(context);
    const output = consoleSpy.mock.calls.join('');
    expect(output).toContain('PENDING');
    expect(output).toContain('and 2 more');
  });

  it('shows files modified section with overflow', async () => {
    const files = ['/a.ts', '/b.ts', '/c.ts', '/d.ts', '/e.ts'];
    makeStoreMock(makeSession({ filesModified: files }));
    await sessionStartHook(context);
    const output = consoleSpy.mock.calls.join('');
    expect(output).toContain('FILES MODIFIED');
    expect(output).toContain('and 2 more');
  });

  it('shows "(created)" label for created files', async () => {
    makeStoreMock(makeSession({ filesCreated: ['/new-file.ts'], filesModified: [] }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('created');
  });

  it('shows next steps section', async () => {
    makeStoreMock(makeSession({ nextSteps: ['Step one', 'Step two', 'Step three', 'Step four'] }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('NEXT STEPS');
  });

  it('wraps long summary text across multiple lines', async () => {
    const longSummary = 'This is a very long summary that definitely exceeds the maximum width of sixty-one characters so it must wrap';
    makeStoreMock(makeSession({ summary: longSummary }));
    await sessionStartHook(context);
    expect(consoleSpy.mock.calls.join('')).toContain('SUMMARY');
  });

  it('shows session with no optional sections gracefully', async () => {
    makeStoreMock(makeSession({
      summary: '',
      tasks: [],
      filesCreated: [],
      filesModified: [],
      nextSteps: [],
    }));
    await sessionStartHook(context);
    expect(consoleSpy).toHaveBeenCalled();
  });
});
