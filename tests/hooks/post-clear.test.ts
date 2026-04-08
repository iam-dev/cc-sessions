import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handlePostClear } from '../../src/hooks/post-clear';
import { saveSnapshot } from '../../src/hooks/snapshot';
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

function writeMinimalJsonl(dir: string, sessionId = 'pc-test'): string {
  const p = path.join(dir, `${sessionId}.jsonl`);
  const entries = [
    JSON.stringify({ type: 'human',     timestamp: new Date().toISOString(), message: { content: 'Hi', usage: { input_tokens: 5, output_tokens: 0 } }, cwd: dir, sessionId }),
    JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: 'Hello', usage: { input_tokens: 0, output_tokens: 5 } }, cwd: dir, sessionId }),
  ];
  fs.writeFileSync(p, entries.join('\n') + '\n', 'utf8');
  return p;
}

describe('handlePostClear', () => {
  const tmpDir = path.join(os.tmpdir(), `post-clear-test-${Date.now()}`);
  const dbPath  = path.join(tmpDir, 'test.db');
  let store: SessionStore;

  beforeAll(() => { fs.mkdirSync(tmpDir, { recursive: true }); });

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    store = new SessionStore(dbPath);
  });

  afterEach(() => { store.close(); });
  afterAll(() => { fs.rmSync(tmpDir, { recursive: true }); });

  it('saves previous session tagged pre-clear on /clear', async () => {
    const oldPath = writeMinimalJsonl(tmpDir, 'old-session');
    const newPath = path.join(tmpDir, 'new-empty.jsonl');
    fs.writeFileSync(newPath, '', 'utf8');   // empty = the new session

    const payload = {
      hook_event_name: 'SessionStart',
      session_id: 'new-uuid',
      transcript_path: newPath,
      cwd: tmpDir,
    };

    await handlePostClear(payload, store, testConfig);

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].tags).toContain('pre-clear');
  });

  it('does nothing when hook_event_name is not SessionStart', async () => {
    const payload = { hook_event_name: 'Notification', session_id: 'x', transcript_path: '/tmp/x.jsonl', cwd: tmpDir };
    await handlePostClear(payload, store, testConfig);
    expect(store.getAll()).toHaveLength(0);
  });

  it('does nothing when transcript_path is absent', async () => {
    const payload = { hook_event_name: 'SessionStart', session_id: 'x', cwd: tmpDir };
    await handlePostClear(payload as never, store, testConfig);
    expect(store.getAll()).toHaveLength(0);
  });

  it('upserts when session was already saved by /sessions:clear (snapshot + pre-clear combined tags)', async () => {
    const oldPath = writeMinimalJsonl(tmpDir, 'upsert-test');
    const newPath = path.join(tmpDir, 'upsert-new.jsonl');
    fs.writeFileSync(newPath, '', 'utf8');

    // Simulate /sessions:clear having already saved with 'snapshot' tag
    await saveSnapshot(oldPath, store, testConfig, 'snapshot');

    const payload = {
      hook_event_name: 'SessionStart',
      session_id: 'new-uuid2',
      transcript_path: newPath,
      cwd: tmpDir,
    };

    await handlePostClear(payload, store, testConfig);

    const all = store.getAll();
    expect(all).toHaveLength(1);               // still one record (upsert)
    expect(all[0].tags).toContain('snapshot');
    expect(all[0].tags).toContain('pre-clear');
  });
});
