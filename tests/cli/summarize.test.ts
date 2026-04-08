/**
 * Tests for the summarize command logic (not the CLI entry point itself,
 * but the core pipeline: load sessions → parse log → generate summary → update)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionStore } from '../../src/store/sessions';
import { saveSnapshot } from '../../src/hooks/snapshot';
import { generateSummary } from '../../src/parser/summarizer';
import { parseLogFile } from '../../src/parser/jsonl';
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

function writeMinimalJsonl(dir: string, sessionId = 'summarize-test'): string {
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  const entries = [
    JSON.stringify({ type: 'human',     timestamp: new Date().toISOString(), message: { content: 'Fix auth bug', usage: { input_tokens: 10, output_tokens: 0 } }, cwd: dir, sessionId }),
    JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: "I'll fix the auth bug.", usage: { input_tokens: 0, output_tokens: 8 } }, cwd: dir, sessionId }),
  ];
  fs.writeFileSync(filePath, entries.join('\n') + '\n', 'utf8');
  return filePath;
}

describe('summarize pipeline', () => {
  const tmpDir = path.join(os.tmpdir(), `summarize-test-${Date.now()}`);
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

  afterEach(() => { store.close(); });
  afterAll(() => { fs.rmSync(tmpDir, { recursive: true }); });

  it('session saved with no-ai-summary tag is returned by findByTag', async () => {
    // generateSummary with skipAI=true → rule-based → tags include no-ai-summary
    await saveSnapshot(logPath, store, testConfig, 'imported');

    const tagged = store.findByTag('no-ai-summary', 50);
    expect(tagged).toHaveLength(1);
  });

  it('updating a session replaces its summary fields (same id, no duplicate)', async () => {
    await saveSnapshot(logPath, store, testConfig, 'imported');

    const [before] = store.findByTag('no-ai-summary', 50);
    expect(before).toBeDefined();

    // Simulate regeneration: parse log, generate new summary, save with same id
    const parsed  = parseLogFile(logPath);
    const newSummary = await generateSummary(parsed, testConfig.summaries, true); // skipAI=true in tests
    const updated = { ...before, summary: newSummary.summary, description: newSummary.description };
    store.save(updated);

    const all = store.getAll();
    expect(all).toHaveLength(1);             // still one record
    expect(all[0].id).toBe(before.id);       // same id
  });

  it('session with no matching logFile is skippable (logFile field accessible)', async () => {
    await saveSnapshot(logPath, store, testConfig, 'imported');

    const [session] = store.getAll();
    expect(typeof session.logFile).toBe('string');
    expect(fs.existsSync(session.logFile)).toBe(true);
  });
});
