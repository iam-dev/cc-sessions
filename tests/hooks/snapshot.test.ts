/**
 * Tests for saveSnapshot() helper
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionStore } from '../../src/store/sessions';
import { saveSnapshot } from '../../src/hooks/snapshot';
import type { Config } from '../../src/types';

// Minimal config — AI summary disabled so no network calls in tests
const testConfig: Config = {
  version: 1,
  retention: { fullSessions: '1y', archives: 'forever', searchIndex: '1y', overrideClaudeRetention: false, maxStorageGb: 10 },
  autoSave: { enabled: true, intervalMinutes: 5, onSessionEnd: true, onTerminalClose: true, generateSummary: false, extractTasks: false },
  summaries: { model: 'haiku', maxLength: 500, include: [] },
  search: { enabled: true, indexFields: [], fuzzyThreshold: 0.8 },
  cloud: { enabled: false, provider: 'r2', syncIntervalMinutes: 60, syncOnSave: false, deviceId: 'test' },
  ui: { showOnStart: false, recentCount: 10, dateFormat: 'relative', theme: 'dark' },
  projects: { overrides: {} },
};

// Path to a real JSONL fixture — we create a minimal valid one
function writeMinimalJsonl(dir: string): string {
  const filePath = path.join(dir, 'abc123.jsonl');
  const entries = [
    JSON.stringify({
      type: 'human',
      timestamp: new Date().toISOString(),
      message: { content: 'Hello', usage: { input_tokens: 10, output_tokens: 0 } },
      cwd: dir,
      sessionId: 'abc123',
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: { content: 'Hi there', usage: { input_tokens: 0, output_tokens: 5 } },
      cwd: dir,
      sessionId: 'abc123',
    }),
  ];
  fs.writeFileSync(filePath, entries.join('\n') + '\n', 'utf8');
  return filePath;
}

describe('saveSnapshot', () => {
  const tmpDir = path.join(os.tmpdir(), `snapshot-test-${Date.now()}`);
  const dbPath  = path.join(tmpDir, 'test.db');
  let store: SessionStore;
  let logPath: string;

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    logPath = writeMinimalJsonl(tmpDir);
  });

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    store = new SessionStore(dbPath);
  });

  afterEach(() => {
    store.close();
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('saves a new session with the given tag', async () => {
    await saveSnapshot(logPath, store, testConfig, 'snapshot');

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].tags).toContain('snapshot');
  });

  it('upserts an existing session — does not create duplicate', async () => {
    await saveSnapshot(logPath, store, testConfig, 'snapshot');
    await saveSnapshot(logPath, store, testConfig, 'pre-compact');

    const all = store.getAll();
    expect(all).toHaveLength(1);           // still just one record
    expect(all[0].tags).toContain('pre-compact');
    expect(all[0].tags).toContain('snapshot');   // ← first tag must survive second save
  });

  it('preserves claudeSessionId on the saved record', async () => {
    await saveSnapshot(logPath, store, testConfig, 'snapshot');

    const all = store.getAll();
    expect(all[0].claudeSessionId).toBeTruthy();
  });

  it('does nothing for an empty JSONL file', async () => {
    const emptyPath = path.join(tmpDir, 'empty.jsonl');
    fs.writeFileSync(emptyPath, '', 'utf8');

    await saveSnapshot(emptyPath, store, testConfig, 'snapshot');

    expect(store.getAll()).toHaveLength(0);
  });

  it('result has no-ai-summary tag when skipAI is used (via config gate=false)', async () => {
    // testConfig has generateSummary: false, so it falls through to rule-based
    await saveSnapshot(logPath, store, testConfig, 'snapshot');

    const all = store.getAll();
    expect(all[0].tags).toContain('no-ai-summary');
  });

  it('combined tags preserved on upsert: snapshot then pre-clear', async () => {
    await saveSnapshot(logPath, store, testConfig, 'snapshot');
    await saveSnapshot(logPath, store, testConfig, 'pre-clear');

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].tags).toContain('snapshot');
    expect(all[0].tags).toContain('pre-clear');
  });
});
