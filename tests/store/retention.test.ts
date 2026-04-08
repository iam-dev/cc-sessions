/**
 * Tests for RetentionManager
 */

jest.mock('fs', () => {
  const real = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...real,
    existsSync: jest.fn((...args: Parameters<typeof real.existsSync>) => real.existsSync(...args)),
    mkdirSync: jest.fn((...args: Parameters<typeof real.mkdirSync>) => real.mkdirSync(...args)),
    readFileSync: jest.fn((...args: Parameters<typeof real.readFileSync>) => real.readFileSync(...args)),
    writeFileSync: jest.fn((...args: Parameters<typeof real.writeFileSync>) => real.writeFileSync(...args)),
    readdirSync: jest.fn((...args: Parameters<typeof real.readdirSync>) => real.readdirSync(...args)),
    statSync: jest.fn((...args: Parameters<typeof real.statSync>) => real.statSync(...args)),
    unlinkSync: jest.fn((...args: Parameters<typeof real.unlinkSync>) => real.unlinkSync(...args)),
  };
});

import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import * as os from 'os';
import { RetentionManager } from '../../src/store/retention';
import { SessionStore } from '../../src/store/sessions';
import type { SessionMemory, RetentionConfig } from '../../src/types';

const realFs = jest.requireActual<typeof import('fs')>('fs');

const testDir = path.join(os.tmpdir(), `retention-test-${Date.now()}`);
const testDbPath = path.join(testDir, 'test.db');

const baseConfig: RetentionConfig = {
  fullSessions: '30d',
  archives: 'forever',
  searchIndex: '1y',
  overrideClaudeRetention: false,
  maxStorageGb: 10,
};

function makeSession(overrides: Partial<SessionMemory> = {}): SessionMemory {
  return {
    id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    claudeSessionId: 'claude-123',
    projectPath: '/test/project',
    projectName: 'test-project',
    startedAt: new Date(),
    endedAt: new Date(),
    duration: 30,
    summary: 'Test session',
    description: 'Test description',
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
    tokensUsed: 1000,
    messagesCount: 5,
    toolCallsCount: 2,
    tags: [],
    archived: false,
    logFile: '',
    ...overrides,
  };
}

function restoreFs() {
  (fs.existsSync as jest.Mock).mockImplementation((...args: Parameters<typeof realFs.existsSync>) => realFs.existsSync(...args));
  (fs.mkdirSync as jest.Mock).mockImplementation((...args: Parameters<typeof realFs.mkdirSync>) => realFs.mkdirSync(...args));
  (fs.readFileSync as jest.Mock).mockImplementation((...args: Parameters<typeof realFs.readFileSync>) => realFs.readFileSync(...args));
  (fs.writeFileSync as jest.Mock).mockImplementation((...args: Parameters<typeof realFs.writeFileSync>) => realFs.writeFileSync(...args));
  (fs.readdirSync as jest.Mock).mockImplementation((...args: Parameters<typeof realFs.readdirSync>) => realFs.readdirSync(...args));
  (fs.statSync as jest.Mock).mockImplementation((...args: Parameters<typeof realFs.statSync>) => realFs.statSync(...args));
  (fs.unlinkSync as jest.Mock).mockImplementation((...args: Parameters<typeof realFs.unlinkSync>) => realFs.unlinkSync(...args));
}

describe('RetentionManager', () => {
  let store: SessionStore;
  let manager: RetentionManager;

  beforeAll(() => {
    realFs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    realFs.rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    restoreFs();
    jest.clearAllMocks();
    if (realFs.existsSync(testDbPath)) realFs.unlinkSync(testDbPath);
    store = new SessionStore(testDbPath);
    manager = new RetentionManager(store, baseConfig);
  });

  afterEach(() => {
    store.close();
    restoreFs();
  });

  // ── parseDays ────────────────────────────────────────────────────────────────

  describe('parseDays', () => {
    it('returns Infinity for "forever"', () => {
      expect(manager.parseDays('forever')).toBe(Infinity);
    });

    it('parses day units', () => {
      expect(manager.parseDays('7d')).toBe(7);
      expect(manager.parseDays('30d')).toBe(30);
    });

    it('parses month units (30 days each)', () => {
      expect(manager.parseDays('1m')).toBe(30);
      expect(manager.parseDays('3m')).toBe(90);
    });

    it('parses year units (365 days each)', () => {
      expect(manager.parseDays('1y')).toBe(365);
      expect(manager.parseDays('2y')).toBe(730);
    });

    it('defaults to 30 for invalid formats', () => {
      expect(manager.parseDays('invalid')).toBe(30);
      expect(manager.parseDays('')).toBe(30);
      expect(manager.parseDays('10x')).toBe(30);
    });
  });

  // ── getArchiveDir ────────────────────────────────────────────────────────────

  describe('getArchiveDir', () => {
    it('returns a string path containing archive', () => {
      const dir = manager.getArchiveDir();
      expect(typeof dir).toBe('string');
      expect(dir).toContain('archive');
    });
  });

  // ── listArchivedFiles ────────────────────────────────────────────────────────

  describe('listArchivedFiles', () => {
    it('returns empty array when archive dir does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValueOnce(false);
      expect(manager.listArchivedFiles()).toEqual([]);
    });

    it('returns only .gz files from the archive dir', () => {
      (fs.existsSync as jest.Mock).mockReturnValueOnce(true);
      (fs.readdirSync as jest.Mock).mockReturnValueOnce(
        ['a.jsonl.gz', 'b.jsonl.gz', 'notes.txt'],
      );
      const files = manager.listArchivedFiles();
      expect(files).toHaveLength(2);
      expect(files.every(f => f.endsWith('.gz'))).toBe(true);
    });
  });

  // ── isClaudeRetentionOverridden ──────────────────────────────────────────────

  describe('isClaudeRetentionOverridden', () => {
    it('returns false when settings file does not exist', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: fs.PathLike) =>
        !p.toString().includes('settings.json'),
      );
      expect(manager.isClaudeRetentionOverridden()).toBe(false);
    });

    it('returns true when logRetentionDays > 365', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('settings.json')) return '{"logRetentionDays": 36500}';
        return realFs.readFileSync(p);
      });
      expect(manager.isClaudeRetentionOverridden()).toBe(true);
    });

    it('returns false when logRetentionDays <= 365', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('settings.json')) return '{"logRetentionDays": 30}';
        return realFs.readFileSync(p);
      });
      expect(manager.isClaudeRetentionOverridden()).toBe(false);
    });

    it('returns false when settings JSON is invalid', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('settings.json')) return 'not-valid-json{';
        return realFs.readFileSync(p);
      });
      expect(manager.isClaudeRetentionOverridden()).toBe(false);
    });
  });

  // ── overrideClaudeRetention ──────────────────────────────────────────────────

  describe('overrideClaudeRetention', () => {
    it('returns true and writes settings when .claude dir does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.mkdirSync as jest.Mock).mockReturnValue(undefined as never);
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      expect(manager.overrideClaudeRetention()).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
      const written = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls[0][1] as string);
      expect(written.logRetentionDays).toBe(36500);
    });

    it('merges logRetentionDays into existing settings', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('settings.json')) return '{"otherKey": true}';
        return realFs.readFileSync(p);
      });
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      expect(manager.overrideClaudeRetention()).toBe(true);
      const written = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls[0][1] as string);
      expect(written.otherKey).toBe(true);
      expect(written.logRetentionDays).toBe(36500);
    });

    it('returns false when write throws', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.mkdirSync as jest.Mock).mockReturnValue(undefined as never);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('disk full');
      });
      expect(manager.overrideClaudeRetention()).toBe(false);
    });
  });

  describe('constructor with overrideClaudeRetention: true', () => {
    it('calls overrideClaudeRetention during construction', () => {
      const cfg: RetentionConfig = { ...baseConfig, overrideClaudeRetention: true };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('settings.json')) return '{}';
        return realFs.readFileSync(p);
      });
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      new RetentionManager(store, cfg);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  // ── compressLogFile ──────────────────────────────────────────────────────────

  describe('compressLogFile', () => {
    it('returns null when session has no logFile', async () => {
      const session = makeSession({ logFile: '' });
      expect(await manager.compressLogFile(session)).toBeNull();
    });

    it('returns null when logFile does not exist on disk', async () => {
      const session = makeSession({ logFile: '/definitely/does/not/exist.jsonl' });
      expect(await manager.compressLogFile(session)).toBeNull();
    });

    it('compresses an existing log file and returns the archive path', async () => {
      const logPath = path.join(testDir, `compress-${Date.now()}.jsonl`);
      realFs.writeFileSync(logPath, 'some jsonl content\n');

      const updateSpy = jest.spyOn(store, 'updateArchivePath').mockReturnValue();

      const session = makeSession({ id: 'compress-sess', logFile: logPath });
      const result = await manager.compressLogFile(session);

      expect(result).not.toBeNull();
      expect(result).toContain('compress-sess');
      expect(result).toContain('.gz');
      expect(updateSpy).toHaveBeenCalledWith('compress-sess', result);

      realFs.unlinkSync(logPath);
      if (result && realFs.existsSync(result)) realFs.unlinkSync(result);
    });

    it('returns null when reading/compressing fails', async () => {
      const logPath = '/fake/path.jsonl';
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('I/O error');
      });
      expect(await manager.compressLogFile(makeSession({ logFile: logPath }))).toBeNull();
    });
  });

  // ── decompressLogFile ────────────────────────────────────────────────────────

  describe('decompressLogFile', () => {
    it('returns null when archive does not exist', () => {
      expect(manager.decompressLogFile('/no/such/archive.gz')).toBeNull();
    });

    it('decompresses a gzip file and returns the original text', () => {
      const archivePath = path.join(testDir, `decomp-${Date.now()}.gz`);
      const original = 'hello world\nline two\n';
      realFs.writeFileSync(archivePath, zlib.gzipSync(Buffer.from(original)));

      const result = manager.decompressLogFile(archivePath);
      expect(result).toBe(original);

      realFs.unlinkSync(archivePath);
    });

    it('returns null when decompression fails', () => {
      const archivePath = path.join(testDir, `bad-${Date.now()}.gz`);
      realFs.writeFileSync(archivePath, Buffer.from('this is not gzip'));

      expect(manager.decompressLogFile(archivePath)).toBeNull();

      realFs.unlinkSync(archivePath);
    });
  });

  // ── calculateStorageUsed ─────────────────────────────────────────────────────

  describe('calculateStorageUsed', () => {
    it('returns a non-negative number', () => {
      const size = manager.calculateStorageUsed();
      expect(typeof size).toBe('number');
      expect(size).toBeGreaterThanOrEqual(0);
    });
  });

  // ── runCleanup ───────────────────────────────────────────────────────────────

  describe('runCleanup', () => {
    it('archives sessions older than fullSessions period', async () => {
      store.save(makeSession({
        id: 'old-session',
        startedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      }));

      const report = await manager.runCleanup();
      expect(report.sessionsArchived).toBe(1);
      expect(report.logFilesBackedUp).toBe(0); // no logFile on disk
    });

    it('does not call archiveOld when fullSessions is "forever"', async () => {
      const m = new RetentionManager(store, { ...baseConfig, fullSessions: 'forever' });
      const spy = jest.spyOn(store, 'archiveOld');
      await m.runCleanup();
      expect(spy).not.toHaveBeenCalled();
    });

    it('deletes sessions beyond archives retention', async () => {
      const m = new RetentionManager(store, {
        ...baseConfig,
        fullSessions: '1d',
        archives: '1d',
      });
      store.save(makeSession({
        id: 'very-old',
        startedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      }));

      const report = await m.runCleanup();
      expect(report.sessionsDeleted).toBe(1);
      expect(report.bytesFreed).toBeGreaterThan(0);
    });

    it('does not call deleteOld when archives is "forever"', async () => {
      const spy = jest.spyOn(store, 'deleteOld');
      await manager.runCleanup();
      expect(spy).not.toHaveBeenCalled();
    });

    it('returns all-zero report when nothing is old', async () => {
      const report = await manager.runCleanup();
      expect(report.sessionsArchived).toBe(0);
      expect(report.sessionsDeleted).toBe(0);
      expect(report.bytesFreed).toBe(0);
      expect(report.logFilesBackedUp).toBe(0);
    });

    it('trims sessions when storage exceeds maxStorageGb', async () => {
      // Use a tiny maxStorageGb so that even an empty DB exceeds the limit
      const tinyManager = new RetentionManager(store, {
        ...baseConfig,
        maxStorageGb: 0.000000001, // ~1 byte limit
      });

      store.save(makeSession({ id: 'trim-me-1' }));
      store.save(makeSession({ id: 'trim-me-2' }));

      // Make calculateStorageUsed return a large value so trimming is triggered
      const calcSpy = jest.spyOn(tinyManager as unknown as { calculateStorageUsed: () => number }, 'calculateStorageUsed')
        .mockReturnValueOnce(1e10) // initial call: huge storage
        .mockReturnValue(0);       // subsequent calls: already freed

      const report = await tinyManager.runCleanup();
      expect(report.sessionsDeleted).toBeGreaterThan(0);
      expect(report.bytesFreed).toBeGreaterThan(0);

      calcSpy.mockRestore();
    });

    it('trims archived log file when it exists during storage trim', async () => {
      const tinyManager = new RetentionManager(store, {
        ...baseConfig,
        maxStorageGb: 0.000000001,
      });

      // Create a real archive file for the session
      const archivePath = path.join(testDir, 'test-archive.gz');
      realFs.writeFileSync(archivePath, 'fake gz data');

      store.save(makeSession({
        id: 'with-archive',
        logFileArchived: archivePath,
      }));

      const calcSpy = jest.spyOn(tinyManager as unknown as { calculateStorageUsed: () => number }, 'calculateStorageUsed')
        .mockReturnValueOnce(1e10)
        .mockReturnValue(0);

      const report = await tinyManager.runCleanup();
      expect(report.bytesFreed).toBeGreaterThan(0);

      calcSpy.mockRestore();
    });
  });
});
