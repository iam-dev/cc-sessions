import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryStore } from '../../src/store/memory';
import { encodeId } from '../../src/store/memoryUtils';

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

describe('syncProject', () => {
  it('indexes auto-memory files', () => {
    const projectPath = '/test/proj';
    const encoded = projectPath.replace(/^\//, '').replace(/\//g, '-');
    const memDir = path.join(tmpDir, 'memory-base', encoded, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(
      path.join(memDir, 'user_role.md'),
      '---\nname: "My Role"\ndescription: "I am a dev"\ntype: user\n---\n\nBody here.',
    );

    const result = store.syncProject(projectPath);
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.deleted).toBe(0);

    const entries = store.getByProject(projectPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('My Role');
    expect(entries[0].source).toBe('auto-memory');
    expect(entries[0].type).toBe('user');
  });

  it('indexes CLAUDE.md at project root', () => {
    const projectPath = path.join(tmpDir, 'my-project');
    fs.mkdirSync(projectPath, { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'CLAUDE.md'), '# Instructions\n\nDo stuff.');

    const result = store.syncProject(projectPath);
    expect(result.added).toBe(1);

    const entries = store.getByProject(projectPath);
    expect(entries[0].source).toBe('claude-md');
    expect(entries[0].type).toBe('claude-md');
    expect(entries[0].name).toBe('CLAUDE.md');
  });

  it('updates changed files on second sync', () => {
    const projectPath = '/test/proj2';
    const encoded = projectPath.replace(/^\//, '').replace(/\//g, '-');
    const memDir = path.join(tmpDir, 'memory-base', encoded, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    const filePath = path.join(memDir, 'feedback_test.md');
    fs.writeFileSync(filePath, '---\nname: "F1"\ndescription: "d"\ntype: feedback\n---\nOld body.');

    store.syncProject(projectPath);

    // Force mtime to be newer by setting file's mtime 2 seconds ahead
    const newMtime = Date.now() + 2000;
    fs.utimesSync(filePath, newMtime / 1000, newMtime / 1000);
    fs.writeFileSync(filePath, '---\nname: "F1"\ndescription: "d"\ntype: feedback\n---\nNew body.');
    fs.utimesSync(filePath, newMtime / 1000, newMtime / 1000);

    const result = store.syncProject(projectPath);
    expect(result.updated).toBe(1);

    const entries = store.getByProject(projectPath);
    expect(entries[0].body).toBe('New body.');
  });

  it('deletes removed files on sync', () => {
    const projectPath = '/test/proj3';
    const encoded = projectPath.replace(/^\//, '').replace(/\//g, '-');
    const memDir = path.join(tmpDir, 'memory-base', encoded, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    const filePath = path.join(memDir, 'to_delete.md');
    fs.writeFileSync(filePath, '---\nname: "D"\ndescription: "d"\ntype: user\n---\nBody.');

    store.syncProject(projectPath);
    expect(store.getByProject(projectPath)).toHaveLength(1);

    fs.unlinkSync(filePath);
    store.syncProject(projectPath);
    expect(store.getByProject(projectPath)).toHaveLength(0);
  });

  it('skips files that have not changed', () => {
    const projectPath = '/test/proj4';
    const encoded = projectPath.replace(/^\//, '').replace(/\//g, '-');
    const memDir = path.join(tmpDir, 'memory-base', encoded, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(
      path.join(memDir, 'ref.md'),
      '---\nname: "R"\ndescription: "d"\ntype: reference\n---\nBody.',
    );

    store.syncProject(projectPath);
    const result2 = store.syncProject(projectPath);
    expect(result2.added).toBe(0);
    expect(result2.updated).toBe(0);
    expect(result2.deleted).toBe(0);
  });
});

describe('getById', () => {
  it('returns the entry by id', () => {
    const projectPath = '/test/gb';
    const encoded = projectPath.replace(/^\//, '').replace(/\//g, '-');
    const memDir = path.join(tmpDir, 'memory-base', encoded, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(
      path.join(memDir, 'role.md'),
      '---\nname: "Role"\ndescription: "d"\ntype: user\n---\nBody.',
    );
    store.syncProject(projectPath);

    const entries = store.getByProject(projectPath);
    const found = store.getById(entries[0].id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Role');
  });

  it('returns null for unknown id', () => {
    expect(store.getById('nonexistent')).toBeNull();
  });
});
