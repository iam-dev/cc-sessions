jest.mock('fs', () => {
  const real = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...real,
    existsSync: jest.fn((...args: Parameters<typeof real.existsSync>) => real.existsSync(...args)),
    statSync: jest.fn((...args: Parameters<typeof real.statSync>) => real.statSync(...args)),
    readdirSync: jest.fn((...args: Parameters<typeof real.readdirSync>) => real.readdirSync(...args)),
  };
});

jest.mock('../../src/parser/jsonl', () => ({
  findAllLogFiles: jest.fn(),
  parseLogFile: jest.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findPreviousSessionLog, findCurrentSessionLog, generateId } from '../../src/hooks/utils';
import { findAllLogFiles } from '../../src/parser/jsonl';

const realFs = jest.requireActual<typeof import('fs')>('fs');
const mockFindAllLogFiles = findAllLogFiles as jest.MockedFunction<typeof findAllLogFiles>;

function restoreFs() {
  (fs.existsSync as jest.Mock).mockImplementation((...args: Parameters<typeof realFs.existsSync>) => realFs.existsSync(...args));
  (fs.statSync as jest.Mock).mockImplementation((...args: Parameters<typeof realFs.statSync>) => realFs.statSync(...args));
  (fs.readdirSync as jest.Mock).mockImplementation((...args: Parameters<typeof realFs.readdirSync>) => realFs.readdirSync(...args));
}

describe('generateId', () => {
  it('returns a string starting with mem_', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.startsWith('mem_')).toBe(true);
  });

  it('returns unique values on successive calls', () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateId()));
    expect(ids.size).toBe(10);
  });
});

describe('findCurrentSessionLog', () => {
  beforeEach(() => {
    restoreFs();
    jest.clearAllMocks();
  });

  afterEach(() => {
    restoreFs();
  });

  it('returns null when claude projects dir does not exist', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const result = findCurrentSessionLog('session-id', '/cwd');
    expect(result).toBeNull();
  });

  it('returns null when findAllLogFiles returns empty array', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    mockFindAllLogFiles.mockReturnValue([]);

    const result = findCurrentSessionLog('session-id', '/cwd');
    expect(result).toBeNull();
  });

  it('finds log by sessionId in filename', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const logPath = '/home/.claude/projects/proj/abc-session-id.jsonl';
    mockFindAllLogFiles.mockReturnValue([logPath]);
    (fs.statSync as jest.Mock).mockReturnValue({ mtime: new Date(Date.now() - 1000) });

    const result = findCurrentSessionLog('session-id', '/cwd');
    expect(result).toBe(logPath);
  });

  it('finds log by encoded cwd when sessionId does not match', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const cwd = '/my/project';
    const encoded = encodeURIComponent(cwd);
    const logPath = `/home/.claude/projects/${encoded}/session.jsonl`;
    mockFindAllLogFiles.mockReturnValue([logPath]);
    (fs.statSync as jest.Mock).mockReturnValue({ mtime: new Date(Date.now() - 1000) });

    const result = findCurrentSessionLog('other-id', cwd);
    expect(result).toBe(logPath);
  });

  it('falls back to most recent log when within threshold', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const logPath = '/home/.claude/projects/proj/session.jsonl';
    mockFindAllLogFiles.mockReturnValue([logPath]);
    // Recent: 10 seconds ago
    (fs.statSync as jest.Mock).mockReturnValue({ mtime: new Date(Date.now() - 10_000) });

    const result = findCurrentSessionLog('unknown-session', '/other/cwd');
    expect(result).toBe(logPath);
  });

  it('returns null when most recent log is older than threshold', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const logPath = '/home/.claude/projects/proj/session.jsonl';
    mockFindAllLogFiles.mockReturnValue([logPath]);
    // Very old: 10 minutes ago (threshold is 5 min by default)
    (fs.statSync as jest.Mock).mockReturnValue({ mtime: new Date(Date.now() - 10 * 60_000) });

    const result = findCurrentSessionLog('unknown-session', '/other/cwd');
    expect(result).toBeNull();
  });

  it('returns most recent of multiple logs when sorting', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const oldLog = '/home/.claude/projects/proj/old.jsonl';
    const newLog = '/home/.claude/projects/proj/new.jsonl';
    mockFindAllLogFiles.mockReturnValue([oldLog, newLog]);
    (fs.statSync as jest.Mock)
      .mockReturnValueOnce({ mtime: new Date(Date.now() - 60_000) }) // old
      .mockReturnValueOnce({ mtime: new Date(Date.now() - 1_000) }); // new

    // Neither matches sessionId or cwd, falls back to most recent
    const result = findCurrentSessionLog('unknown', '/unrelated');
    expect(result).toBe(newLog);
  });
});

describe('findPreviousSessionLog', () => {
  const tmpDir = path.join(os.tmpdir(), `utils-test-${Date.now()}`);

  beforeAll(() => { realFs.mkdirSync(tmpDir, { recursive: true }); });
  afterAll(() => { realFs.rmSync(tmpDir, { recursive: true }); });

  beforeEach(() => { restoreFs(); });
  afterEach(() => { restoreFs(); });

  function makeJsonl(name: string, content = 'line1\nline2'): string {
    const p = path.join(tmpDir, name);
    realFs.writeFileSync(p, content, 'utf8');
    return p;
  }

  it('returns null when no JSONL files exist in projectDir', () => {
    const emptyDir = path.join(tmpDir, 'empty');
    realFs.mkdirSync(emptyDir, { recursive: true });
    const result = findPreviousSessionLog(emptyDir, path.join(emptyDir, 'new.jsonl'));
    expect(result).toBeNull();
  });

  it('excludes the transcript_path (new session file)', () => {
    const newFile = makeJsonl('new-session.jsonl', 'data');
    makeJsonl('old-session.jsonl', 'old data');

    const result = findPreviousSessionLog(tmpDir, newFile);
    expect(result).not.toBeNull();
    expect(path.resolve(result!)).not.toBe(path.resolve(newFile));
  });

  it('skips empty files', () => {
    const emptyDir2 = path.join(tmpDir, 'empty2');
    realFs.mkdirSync(emptyDir2, { recursive: true });
    const emptyFile = path.join(emptyDir2, 'empty.jsonl');
    realFs.writeFileSync(emptyFile, '', 'utf8');
    const newFile2 = path.join(emptyDir2, 'new.jsonl');
    realFs.writeFileSync(newFile2, 'data', 'utf8');

    const result = findPreviousSessionLog(emptyDir2, newFile2);
    expect(result).toBeNull();
  });

  it('returns null when only match is older than maxAgeMinutes', () => {
    const oldDir = path.join(tmpDir, 'old');
    realFs.mkdirSync(oldDir, { recursive: true });
    const ancient = path.join(oldDir, 'ancient.jsonl');
    realFs.writeFileSync(ancient, 'data', 'utf8');

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    realFs.utimesSync(ancient, twoHoursAgo, twoHoursAgo);

    const newFile3 = path.join(oldDir, 'new.jsonl');
    realFs.writeFileSync(newFile3, '', 'utf8');

    const result = findPreviousSessionLog(oldDir, newFile3, 60);
    expect(result).toBeNull();
  });

  it('returns null when projectDir does not exist', () => {
    const result = findPreviousSessionLog('/no/such/dir', '/no/such/dir/new.jsonl');
    expect(result).toBeNull();
  });

  it('returns null when readdirSync throws', () => {
    (fs.readdirSync as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Permission denied');
    });
    const result = findPreviousSessionLog(tmpDir, path.join(tmpDir, 'new.jsonl'));
    expect(result).toBeNull();
  });
});
