/**
 * Tests for the session-end hook
 */
import type { Config, ParsedSession, SessionSummary } from '../../src/types';

// ── mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../src/config/loader', () => ({ loadConfig: jest.fn() }));
jest.mock('../../src/parser/jsonl', () => ({ parseLogFile: jest.fn() }));
jest.mock('../../src/parser/summarizer', () => ({ generateSummary: jest.fn() }));
jest.mock('../../src/store/sessions', () => ({ SessionStore: jest.fn() }));
jest.mock('../../src/hooks/utils', () => ({
  generateId: jest.fn().mockReturnValue('mem_test_id'),
  findCurrentSessionLog: jest.fn(),
}));
jest.mock('../../src/sync/cloud', () => ({
  CloudSync: jest.fn().mockImplementation(() => ({
    uploadSession: jest.fn().mockResolvedValue(undefined),
  })),
}));

// ── imports after mocks ───────────────────────────────────────────────────────

import sessionEndHook from '../../src/hooks/session-end';
import { loadConfig } from '../../src/config/loader';
import { parseLogFile } from '../../src/parser/jsonl';
import { generateSummary } from '../../src/parser/summarizer';
import { SessionStore } from '../../src/store/sessions';
import { findCurrentSessionLog } from '../../src/hooks/utils';

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;
const mockParseLogFile = parseLogFile as jest.MockedFunction<typeof parseLogFile>;
const mockGenerateSummary = generateSummary as jest.MockedFunction<typeof generateSummary>;
const MockSessionStore = SessionStore as jest.MockedClass<typeof SessionStore>;
const mockFindCurrentSessionLog = findCurrentSessionLog as jest.MockedFunction<typeof findCurrentSessionLog>;

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

const baseParsed: ParsedSession = {
  claudeSessionId: 'claude-xyz',
  projectPath: '/home/user/my-project',
  startTime: new Date('2025-01-15T10:00:00Z'),
  endTime: new Date('2025-01-15T11:00:00Z'),
  duration: 60,
  messagesCount: 10,
  userMessages: ['fix bug'],
  assistantMessages: ['fixed it'],
  toolCalls: [],
  filesCreated: [],
  filesModified: ['/src/fix.ts'],
  filesDeleted: [],
  tokensUsed: 5000,
  logPath: '/path/to/log.jsonl',
};

const baseSummary: SessionSummary = {
  summary: 'Fixed the bug',
  description: 'We fixed the critical bug',
  tasks: [{ id: '1', description: 'Fix bug', status: 'completed', createdAt: new Date() }],
  nextSteps: ['deploy to production'],
  keyDecisions: ['use patch v2'],
  blockers: [],
  tags: ['bugfix'],
};

function setupStoreMock() {
  const mockSave = jest.fn();
  const mockMarkSynced = jest.fn();
  const mockClose = jest.fn();
  MockSessionStore.mockImplementation(() => ({
    save: mockSave,
    markSynced: mockMarkSynced,
    close: mockClose,
  }) as unknown as SessionStore);
  return { mockSave, mockMarkSynced, mockClose };
}

const context = { sessionId: 'test-session', cwd: '/home/user/my-project' };

// ── test suite ────────────────────────────────────────────────────────────────

describe('sessionEndHook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    mockLoadConfig.mockResolvedValue(baseConfig);
    mockFindCurrentSessionLog.mockReturnValue('/path/to/log.jsonl');
    mockParseLogFile.mockReturnValue(baseParsed);
    mockGenerateSummary.mockResolvedValue(baseSummary);
    setupStoreMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns early when autoSave.enabled is false', async () => {
    mockLoadConfig.mockResolvedValue({
      ...baseConfig,
      autoSave: { ...baseConfig.autoSave, enabled: false },
    });

    await sessionEndHook(context);

    expect(MockSessionStore).not.toHaveBeenCalled();
  });

  it('returns early when autoSave.onSessionEnd is false', async () => {
    mockLoadConfig.mockResolvedValue({
      ...baseConfig,
      autoSave: { ...baseConfig.autoSave, onSessionEnd: false },
    });

    await sessionEndHook(context);

    expect(mockParseLogFile).not.toHaveBeenCalled();
  });

  it('returns early when no log file found', async () => {
    mockFindCurrentSessionLog.mockReturnValue(null);

    await sessionEndHook(context);

    expect(mockParseLogFile).not.toHaveBeenCalled();
  });

  it('returns early when parsed session has no messages', async () => {
    mockParseLogFile.mockReturnValue({ ...baseParsed, messagesCount: 0 });

    await sessionEndHook(context);

    expect(mockGenerateSummary).not.toHaveBeenCalled();
  });

  it('saves session when all conditions are met', async () => {
    const { mockSave, mockClose } = setupStoreMock();

    await sessionEndHook(context);

    expect(mockSave).toHaveBeenCalledTimes(1);
    const saved = mockSave.mock.calls[0][0];
    expect(saved.summary).toBe('Fixed the bug');
    expect(saved.tags).toContain('bugfix');
    expect(mockClose).toHaveBeenCalled();
  });

  it('uses fallback summary when generateSummary is false', async () => {
    mockLoadConfig.mockResolvedValue({
      ...baseConfig,
      autoSave: { ...baseConfig.autoSave, generateSummary: false },
    });
    const { mockSave } = setupStoreMock();

    await sessionEndHook(context);

    expect(mockGenerateSummary).not.toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();
    // Fallback summary is used - check basic structure
    const saved = mockSave.mock.calls[0][0];
    expect(typeof saved.summary).toBe('string');
  });

  it('uses fallback summary when AI summary generation fails', async () => {
    mockGenerateSummary.mockRejectedValue(new Error('API error'));
    const { mockSave } = setupStoreMock();

    await sessionEndHook(context);

    expect(mockSave).toHaveBeenCalled();
  });

  it('creates session memory with correct fields', async () => {
    const { mockSave } = setupStoreMock();

    await sessionEndHook(context);

    const saved = mockSave.mock.calls[0][0];
    expect(saved.id).toBe('mem_test_id');
    expect(saved.projectPath).toBe('/home/user/my-project');
    expect(saved.projectName).toBe('my-project');
    expect(saved.tasksCompleted).toBe(1);
    expect(saved.tasksPending).toBe(0);
    expect(saved.filesModified).toContain('/src/fix.ts');
    expect(saved.logFile).toBe('/path/to/log.jsonl');
  });

  it('handles top-level errors silently', async () => {
    mockLoadConfig.mockRejectedValue(new Error('load config failed'));

    await expect(sessionEndHook(context)).resolves.toBeUndefined();
  });

  // ── createFallbackSummary coverage ────────────────────────────────────────

  it('fallback summary mentions file count when files modified', async () => {
    mockLoadConfig.mockResolvedValue({
      ...baseConfig,
      autoSave: { ...baseConfig.autoSave, generateSummary: false },
    });
    mockParseLogFile.mockReturnValue({
      ...baseParsed,
      filesCreated: ['/new.ts'],
      filesModified: ['/mod.ts'],
    });
    const { mockSave } = setupStoreMock();

    await sessionEndHook(context);

    const saved = mockSave.mock.calls[0][0];
    expect(saved.summary).toContain('file');
  });

  it('fallback summary mentions messages when no files', async () => {
    mockLoadConfig.mockResolvedValue({
      ...baseConfig,
      autoSave: { ...baseConfig.autoSave, generateSummary: false },
    });
    mockParseLogFile.mockReturnValue({
      ...baseParsed,
      filesCreated: [],
      filesModified: [],
      messagesCount: 8,
    });
    const { mockSave } = setupStoreMock();

    await sessionEndHook(context);

    const saved = mockSave.mock.calls[0][0];
    expect(saved.summary).toContain('8 messages');
  });

  it('fallback description includes token count when tokensUsed > 0', async () => {
    mockLoadConfig.mockResolvedValue({
      ...baseConfig,
      autoSave: { ...baseConfig.autoSave, generateSummary: false },
    });
    mockParseLogFile.mockReturnValue({ ...baseParsed, tokensUsed: 3000 });
    const { mockSave } = setupStoreMock();

    await sessionEndHook(context);

    const saved = mockSave.mock.calls[0][0];
    expect(saved.description).toContain('tokens');
  });

  it('fallback description omits token count when tokensUsed is 0', async () => {
    mockLoadConfig.mockResolvedValue({
      ...baseConfig,
      autoSave: { ...baseConfig.autoSave, generateSummary: false },
    });
    mockParseLogFile.mockReturnValue({ ...baseParsed, tokensUsed: 0 });
    const { mockSave } = setupStoreMock();

    await sessionEndHook(context);

    const saved = mockSave.mock.calls[0][0];
    expect(saved.description).not.toContain('tokens');
  });

  it('handles singular file in fallback summary', async () => {
    mockLoadConfig.mockResolvedValue({
      ...baseConfig,
      autoSave: { ...baseConfig.autoSave, generateSummary: false },
    });
    mockParseLogFile.mockReturnValue({
      ...baseParsed,
      filesCreated: ['/only-one.ts'],
      filesModified: [],
    });
    const { mockSave } = setupStoreMock();

    await sessionEndHook(context);

    const saved = mockSave.mock.calls[0][0];
    expect(saved.summary).toContain('1 file');
  });

  it('triggers cloud sync when cloud.enabled and syncOnSave are true', async () => {
    mockLoadConfig.mockResolvedValue({
      ...baseConfig,
      cloud: { ...baseConfig.cloud, enabled: true, syncOnSave: true },
    });
    const { mockSave, mockMarkSynced } = setupStoreMock();

    await sessionEndHook(context);

    expect(mockSave).toHaveBeenCalled();
    expect(mockMarkSynced).toHaveBeenCalledWith('mem_test_id');
  });

  it('handles cloud sync failure silently', async () => {
    mockLoadConfig.mockResolvedValue({
      ...baseConfig,
      cloud: { ...baseConfig.cloud, enabled: true, syncOnSave: true },
    });
    const { CloudSync } = jest.requireMock('../../src/sync/cloud') as { CloudSync: jest.MockedClass<{ new(): { uploadSession: jest.Mock } }> };
    CloudSync.mockImplementationOnce(() => ({
      uploadSession: jest.fn().mockRejectedValue(new Error('sync failed')),
    }));
    const { mockSave } = setupStoreMock();

    await expect(sessionEndHook(context)).resolves.toBeUndefined();
    expect(mockSave).toHaveBeenCalled();
  });
});
