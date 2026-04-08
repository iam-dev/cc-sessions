/**
 * Tests for the Notification hook handler
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleNotification } from '../../src/hooks/notification';
import { SessionStore } from '../../src/store/sessions';
import type { Config } from '../../src/types';

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

function writeMinimalJsonl(dir: string, sessionId = 'test-session-id'): string {
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  const entries = [
    JSON.stringify({ type: 'human',     timestamp: new Date().toISOString(), message: { content: 'Hi', usage: { input_tokens: 5, output_tokens: 0 } }, cwd: dir, sessionId }),
    JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: 'Hello', usage: { input_tokens: 0, output_tokens: 5 } }, cwd: dir, sessionId }),
  ];
  fs.writeFileSync(filePath, entries.join('\n') + '\n', 'utf8');
  return filePath;
}

describe('handleNotification', () => {
  const tmpDir = path.join(os.tmpdir(), `notif-test-${Date.now()}`);
  const dbPath  = path.join(tmpDir, 'test.db');
  let store: SessionStore;

  beforeAll(() => { fs.mkdirSync(tmpDir, { recursive: true }); });

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    store = new SessionStore(dbPath);
  });

  afterEach(() => { store.close(); });

  afterAll(() => { fs.rmSync(tmpDir, { recursive: true }); });

  it('saves session tagged pre-compact when message contains "compact"', async () => {
    writeMinimalJsonl(tmpDir, 'test-session-id');

    const payload = {
      hook_event_name: 'Notification',
      session_id: 'test-session-id',
      cwd: tmpDir,
      params: { message: 'Context was compacted. Previous conversation history is summarized.' },
    };

    await handleNotification(payload, store, testConfig);

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].tags).toContain('pre-compact');
  });

  it('does nothing when message does not contain "compact"', async () => {
    writeMinimalJsonl(tmpDir, 'other-session');

    const payload = {
      hook_event_name: 'Notification',
      session_id: 'other-session',
      cwd: tmpDir,
      params: { message: 'Some other notification message' },
    };

    await handleNotification(payload, store, testConfig);

    expect(store.getAll()).toHaveLength(0);
  });

  it('does nothing when hook_event_name is not Notification', async () => {
    const payload = {
      hook_event_name: 'Stop',
      session_id: 'x',
      cwd: tmpDir,
      params: { message: 'compacted' },
    };

    await handleNotification(payload, store, testConfig);

    expect(store.getAll()).toHaveLength(0);
  });

  it('does nothing when params.message is absent', async () => {
    const payload = {
      hook_event_name: 'Notification',
      session_id: 'x',
      cwd: tmpDir,
      params: {},
    };

    await handleNotification(payload as never, store, testConfig);

    expect(store.getAll()).toHaveLength(0);
  });
});
