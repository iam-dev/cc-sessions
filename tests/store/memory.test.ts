import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryStore } from '../../src/store/memory';

let tmpDir: string;
let store: MemoryStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mem-test-'));
  store = new MemoryStore(
    path.join(tmpDir, 'test.db'),
    path.join(tmpDir, 'memory-base'),
  );
  store.initialize();
});

afterEach(() => {
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('initialize', () => {
  it('creates memory_entries table', () => {
    const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_entries'"
    ).get();
    expect(row).toBeTruthy();
  });

  it('creates memory_entries_fts virtual table', () => {
    const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_entries_fts'"
    ).get();
    expect(row).toBeTruthy();
  });
});
