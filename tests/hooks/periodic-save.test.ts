/**
 * Tests for the periodic-save hook
 */
import type { Config, ParsedSession } from '../../src/types';

// ── mocks ─────────────────────────────────────────────────────────────────────

jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  statSync: jest.fn(),
}));

jest.mock('../../src/config/loader', () => ({ loadConfig: jest.fn() }));
jest.mock('../../src/parser/jsonl', () => ({ parseLogFile: jest.fn() }));
jest.mock('../../src/store/sessions', () => ({ SessionStore: jest.fn() }));
jest.mock('../../src/hooks/utils', () => ({
  generateId: jest.fn().mockReturnValue('mem_checkpoint_id'),
  findCurrentSessionLog: jest.fn(),
}));

// ── imports after mocks ───────────────────────────────────────────────────────

import * as fs from 'fs';
import periodicSaveHook from '../../src/hooks/periodic-save';
import { loadConfig } from '../../src/config/loader';
import { parseLogFile } from '../../src/parser/jsonl';
import { SessionStore } from '../../src/store/sessions';
import { findCurrentSessionLog } from '../../src/hooks/utils';

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;
const mockParseLogFile = parseLogFile as jest.MockedFunction<typeof parseLogFile>;
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
  projectPath: '/home/user/project',
  startTime: new Date('2025-01-15T10:00:00Z'),
  endTime: new Date('2025-01-15T10:30:00Z'),
  duration: 30,
  messagesCount: 5,
  userMessages: ['do something'],
  assistantMessages: ['done'],
  toolCalls: [],
  filesCreated: ['/src/new.ts'],
  filesModified: [],
  filesDeleted: [],
  tokensUsed: 2000,
  logPath: '/path/to/session.jsonl',
};

function setupStoreMock(existingCheckpoint = false) {
  const mockSave = jest.fn();
  const mockClose = jest.fn();
  const mockGetRecent = jest.fn().mockReturnValue(
    existingCheckpoint
      ? [{ id: 'existing-checkpoint', claudeSessionId: 'claude-xyz', tags: ['in-progress'] }]
      : [],
  );
  MockSessionStore.mockImplementation(() => ({
    save: mockSave,
    close: mockClose,
    getRecent: mockGetRecent,
  }) as unknown as SessionStore);
  return { mockSave, mockClose, mockGetRecent };
}

const context = { sessionId: 'test-session', cwd: '/home/user/project' };

// ── test suite ────────────────────────────────────────────────────────────────

describe('periodicSaveHook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    mockLoadConfig.mockResolvedValue(baseConfig);
    mockFindCurrentSessionLog.mockReturnValue('/path/to/session.jsonl');
    mockParseLogFile.mockReturnValue(baseParsed);

    // Default: file was modified recently
    (fs.statSync as jest.Mock).mockReturnValue({
      mtime: new Date(Date.now() - 30_000), // 30 seconds ago
    } as fs.Stats);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns early when autoSave.enabled is false', async () => {
    mockLoadConfig.mockResolvedValue({
      ...baseConfig,
      autoSave: { ...baseConfig.autoSave, enabled: false },
    });

    await periodicSaveHook(context);

    expect(MockSessionStore).not.toHaveBeenCalled();
  });

  it('returns early when no log file found', async () => {
    mockFindCurrentSessionLog.mockReturnValue(null);

    await periodicSaveHook(context);

    expect(mockParseLogFile).not.toHaveBeenCalled();
  });

  it('returns early when log file was not modified recently', async () => {
    (fs.statSync as jest.Mock).mockReturnValue({
      mtime: new Date(Date.now() - 5 * 60_000), // 5 minutes ago (stale)
    } as fs.Stats);

    await periodicSaveHook(context);

    expect(mockParseLogFile).not.toHaveBeenCalled();
  });

  it('returns early when parsed session has too few messages', async () => {
    mockParseLogFile.mockReturnValue({ ...baseParsed, messagesCount: 0 });

    const { mockSave } = setupStoreMock();

    await periodicSaveHook(context);

    expect(mockSave).not.toHaveBeenCalled();
  });

  it('saves a new checkpoint when no existing checkpoint found', async () => {
    const { mockSave, mockClose } = setupStoreMock(false);

    await periodicSaveHook(context);

    expect(mockSave).toHaveBeenCalledTimes(1);
    const saved = mockSave.mock.calls[0][0];
    expect(saved.tags).toContain('checkpoint');
    expect(saved.tags).toContain('in-progress');
    expect(mockClose).toHaveBeenCalled();
  });

  it('reuses existing checkpoint id when checkpoint already exists', async () => {
    const { mockSave } = setupStoreMock(true);

    await periodicSaveHook(context);

    expect(mockSave).toHaveBeenCalled();
    const saved = mockSave.mock.calls[0][0];
    expect(saved.id).toBe('existing-checkpoint');
  });

  it('creates checkpoint memory with files modified summary', async () => {
    const { mockSave } = setupStoreMock();

    await periodicSaveHook(context);

    const saved = mockSave.mock.calls[0][0];
    expect(saved.summary).toContain('[In Progress]');
    expect(saved.summary).toContain('1 file');
  });

  it('creates checkpoint summary with message count when no files', async () => {
    mockParseLogFile.mockReturnValue({
      ...baseParsed,
      filesCreated: [],
      filesModified: [],
      messagesCount: 7,
    });
    const { mockSave } = setupStoreMock();

    await periodicSaveHook(context);

    const saved = mockSave.mock.calls[0][0];
    expect(saved.summary).toContain('7 messages');
  });

  it('checkpoint summary uses plural for multiple files', async () => {
    mockParseLogFile.mockReturnValue({
      ...baseParsed,
      filesCreated: ['/a.ts', '/b.ts'],
      filesModified: [],
    });
    const { mockSave } = setupStoreMock();

    await periodicSaveHook(context);

    const saved = mockSave.mock.calls[0][0];
    expect(saved.summary).toContain('2 files');
  });

  it('checkpoint stores correct fields', async () => {
    const { mockSave } = setupStoreMock();

    await periodicSaveHook(context);

    const saved = mockSave.mock.calls[0][0];
    expect(saved.projectPath).toBe('/home/user/project');
    expect(saved.projectName).toBe('project');
    expect(saved.claudeSessionId).toBe('claude-xyz');
    expect(saved.filesCreated).toEqual(['/src/new.ts']);
    expect(saved.archived).toBe(false);
  });

  it('handles errors silently', async () => {
    mockLoadConfig.mockRejectedValue(new Error('config error'));

    await expect(periodicSaveHook(context)).resolves.toBeUndefined();
  });

  it('logs debug info when CC_MEMORY_DEBUG is set', async () => {
    process.env.CC_MEMORY_DEBUG = 'true';
    const { mockSave } = setupStoreMock();

    await periodicSaveHook(context);

    expect(mockSave).toHaveBeenCalled();
    delete process.env.CC_MEMORY_DEBUG;
  });
});
