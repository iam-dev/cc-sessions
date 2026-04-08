/**
 * Unit tests for the session importer
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionStore } from '../../src/store/sessions';
import { importFromGlobalStore, importSingleFile } from '../../src/importer/index';
import type { Config } from '../../src/types';

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

/** Minimal valid Config that disables AI summaries */
const testConfig: Config = {
  version: 1,
  retention: {
    fullSessions: '90d',
    archives: '1y',
    searchIndex: '90d',
    overrideClaudeRetention: false,
    maxStorageGb: 1,
  },
  autoSave: {
    enabled: true,
    intervalMinutes: 5,
    onSessionEnd: true,
    onTerminalClose: false,
    generateSummary: false, // AI off for tests
    extractTasks: false,
  },
  summaries: { model: 'haiku', maxLength: 200, include: [] },
  search: { enabled: true, indexFields: [], fuzzyThreshold: 0.8 },
  cloud: {
    enabled: false,
    provider: 'r2',
    syncIntervalMinutes: 30,
    syncOnSave: false,
    deviceId: 'test-device',
  },
  ui: { showOnStart: false, recentCount: 5, dateFormat: 'relative', theme: 'auto' },
  projects: { overrides: {} },
};

/**
 * Build a minimal JSONL log file that the parser can read.
 */
function writeTestJsonl(
  dir: string,
  sessionId: string,
  projectPath: string,
  messages: number = 2
): string {
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  const lines: string[] = [];

  // System / cwd entry
  lines.push(
    JSON.stringify({
      type: 'system',
      timestamp: new Date('2024-06-01T10:00:00Z').toISOString(),
      cwd: projectPath,
      sessionId,
    })
  );

  // Alternate human / assistant messages
  for (let i = 0; i < messages; i++) {
    const isHuman = i % 2 === 0;
    lines.push(
      JSON.stringify({
        type: isHuman ? 'human' : 'assistant',
        timestamp: new Date('2024-06-01T10:00:00Z').toISOString(),
        content: isHuman ? `User message ${i}` : undefined,
        message: isHuman
          ? undefined
          : {
              content: `Assistant reply ${i}`,
              usage: { input_tokens: 100, output_tokens: 50 },
            },
        sessionId,
      })
    );
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('importSingleFile', () => {
  let tmpDir: string;
  let dbPath: string;
  let store: SessionStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-import-single-'));
    dbPath = path.join(tmpDir, 'test.db');
    store = new SessionStore(dbPath);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('imports a valid JSONL file and returns a SessionMemory', async () => {
    const logPath = writeTestJsonl(tmpDir, 'session-abc', '/home/user/my-project', 4);

    const result = await importSingleFile(logPath, store, testConfig, { skipAI: true });

    expect(result).not.toBe('skipped');
    expect(result).not.toBeNull();
    if (result && result !== 'skipped') {
      expect(result.claudeSessionId).toBe('session-abc');
      expect(result.projectName).toBe('my-project');
      expect(result.messagesCount).toBeGreaterThan(0);
      expect(result.tags).toContain('imported');
    }
  });

  it('saves the session to the store when dryRun is false', async () => {
    const logPath = writeTestJsonl(tmpDir, 'session-save', '/home/user/proj', 2);

    await importSingleFile(logPath, store, testConfig, { dryRun: false, skipAI: true });

    const saved = store.getByClaudeSessionId('session-save');
    expect(saved).not.toBeNull();
    expect(saved?.projectName).toBe('proj');
  });

  it('does NOT save to the store when dryRun is true', async () => {
    const logPath = writeTestJsonl(tmpDir, 'session-dry', '/home/user/proj', 2);

    await importSingleFile(logPath, store, testConfig, { dryRun: true, skipAI: true });

    const notSaved = store.getByClaudeSessionId('session-dry');
    expect(notSaved).toBeNull();
  });

  it('returns "skipped" when the session is already in the database', async () => {
    const logPath = writeTestJsonl(tmpDir, 'session-dup', '/home/user/proj', 2);

    // Import once
    await importSingleFile(logPath, store, testConfig, { skipAI: true });

    // Import again — should be skipped
    const second = await importSingleFile(logPath, store, testConfig, { skipAI: true });
    expect(second).toBe('skipped');
  });

  it('returns null for sessions with zero messages', async () => {
    const logPath = writeTestJsonl(tmpDir, 'session-empty', '/home/user/proj', 0);

    const result = await importSingleFile(logPath, store, testConfig, { skipAI: true });
    expect(result).toBeNull();
  });

  it('filters out sessions older than the since date', async () => {
    const logPath = writeTestJsonl(tmpDir, 'session-old', '/home/user/proj', 2);
    // The log timestamp is 2024-06-01; use 2025-01-01 as cutoff
    const since = new Date('2025-01-01T00:00:00Z');

    const result = await importSingleFile(logPath, store, testConfig, {
      since,
      skipAI: true,
    });

    expect(result).toBeNull();
  });

  it('includes sessions on or after the since date', async () => {
    const logPath = writeTestJsonl(tmpDir, 'session-new', '/home/user/proj', 2);
    const since = new Date('2024-01-01T00:00:00Z');

    const result = await importSingleFile(logPath, store, testConfig, {
      since,
      skipAI: true,
    });

    expect(result).not.toBeNull();
    expect(result).not.toBe('skipped');
  });

  it('throws when the JSONL file does not exist', async () => {
    await expect(
      importSingleFile('/nonexistent/path/session.jsonl', store, testConfig, { skipAI: true })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('importFromGlobalStore', () => {
  let tmpDir: string;
  let claudeProjectsDir: string;
  let dbPath: string;
  let store: SessionStore;

  /** Override HOME so findAllLogFiles() points to our fake directory */
  const originalHome = process.env.HOME;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-import-global-'));
    dbPath = path.join(tmpDir, 'test.db');
    store = new SessionStore(dbPath);

    // Create a fake ~/.claude/projects/ structure
    claudeProjectsDir = path.join(tmpDir, '.claude', 'projects');

    const projectA = path.join(claudeProjectsDir, encodeURIComponent('/home/user/project-a'));
    const projectB = path.join(claudeProjectsDir, encodeURIComponent('/home/user/project-b'));
    fs.mkdirSync(projectA, { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });

    writeTestJsonl(projectA, 'sess-a1', '/home/user/project-a', 4);
    writeTestJsonl(projectA, 'sess-a2', '/home/user/project-a', 2);
    writeTestJsonl(projectB, 'sess-b1', '/home/user/project-b', 6);

    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env.HOME = originalHome;
  });

  it('imports all sessions from all projects', async () => {
    const result = await importFromGlobalStore(store, testConfig, { skipAI: true });

    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.sessions).toHaveLength(3);
  });

  it('skips sessions already present in the database', async () => {
    // First import
    await importFromGlobalStore(store, testConfig, { skipAI: true });

    // Second import — all should be skipped
    const second = await importFromGlobalStore(store, testConfig, { skipAI: true });

    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(3);
    expect(second.sessions).toHaveLength(0);
  });

  it('respects the limit option', async () => {
    const result = await importFromGlobalStore(store, testConfig, {
      skipAI: true,
      limit: 2,
    });

    expect(result.imported).toBeLessThanOrEqual(2);
    expect(result.imported + result.skipped + result.failed).toBeLessThanOrEqual(2);
  });

  it('reports progress via onProgress callback', async () => {
    const calls: Array<{ current: number; total: number }> = [];

    await importFromGlobalStore(store, testConfig, {
      skipAI: true,
      onProgress: (current, total) => calls.push({ current, total }),
    });

    expect(calls.length).toBe(3);
    expect(calls[0].total).toBe(3);
    expect(calls[2].current).toBe(3);
  });

  it('does not persist any sessions in dry-run mode', async () => {
    const result = await importFromGlobalStore(store, testConfig, {
      skipAI: true,
      dryRun: true,
    });

    expect(result.sessions).toHaveLength(3);
    // Nothing should be in the DB
    expect(store.getStats().totalSessions).toBe(0);
  });

  it('filters sessions by project path substring', async () => {
    const result = await importFromGlobalStore(store, testConfig, {
      skipAI: true,
      projectPath: 'project-a',
    });

    expect(result.imported).toBe(2);
    for (const s of result.sessions) {
      expect(s.projectName).toBe('project-a');
    }
  });

  it('returns empty result when no log files exist', async () => {
    // Remove all log files
    fs.rmSync(claudeProjectsDir, { recursive: true, force: true });

    const result = await importFromGlobalStore(store, testConfig, { skipAI: true });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.sessions).toHaveLength(0);
  });

  it('tags imported sessions with "imported"', async () => {
    const result = await importFromGlobalStore(store, testConfig, { skipAI: true });

    for (const s of result.sessions) {
      expect(s.tags).toContain('imported');
    }
  });
});

// ---------------------------------------------------------------------------

describe('SessionStore.getByClaudeSessionId', () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-store-claude-id-'));
    store = new SessionStore(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when the claudeSessionId is not in the database', () => {
    expect(store.getByClaudeSessionId('nonexistent-id')).toBeNull();
  });

  it('returns the matching session when it exists', () => {
    const now = new Date();
    store.save({
      id: 'mem-test-1',
      claudeSessionId: 'claude-xyz',
      projectPath: '/test/project',
      projectName: 'project',
      startedAt: now,
      endedAt: now,
      duration: 5,
      summary: 'Test',
      description: '',
      tasks: [],
      tasksCompleted: 0,
      tasksPending: 0,
      filesCreated: [],
      filesModified: [],
      filesDeleted: [],
      lastUserMessage: '',
      lastAssistantMessage: '',
      nextSteps: [],
      keyDecisions: [],
      blockers: [],
      tokensUsed: 0,
      messagesCount: 1,
      toolCallsCount: 0,
      tags: [],
      archived: false,
      logFile: '/test/path.jsonl',
    });

    const found = store.getByClaudeSessionId('claude-xyz');
    expect(found).not.toBeNull();
    expect(found?.id).toBe('mem-test-1');
    expect(found?.claudeSessionId).toBe('claude-xyz');
  });
});
