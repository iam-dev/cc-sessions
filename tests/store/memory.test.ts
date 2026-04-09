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

describe('update', () => {
  it('writes to disk and updates db for auto-memory entry', () => {
    const projectPath = '/test/upd';
    const encoded = projectPath.replace(/^\//, '').replace(/\//g, '-');
    const memDir = path.join(tmpDir, 'memory-base', encoded, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    const filePath = path.join(memDir, 'role.md');
    fs.writeFileSync(filePath, '---\nname: "R"\ndescription: "d"\ntype: user\n---\nOld.');

    store.syncProject(projectPath);
    const entries = store.getByProject(projectPath);
    const id = entries[0].id;

    store.update(id, { name: 'New Name', description: 'New Desc', body: 'New body.' });

    const updated = store.getById(id)!;
    expect(updated.name).toBe('New Name');
    expect(updated.description).toBe('New Desc');
    expect(updated.body).toBe('New body.');

    // Verify disk was also updated
    const diskContent = fs.readFileSync(filePath, 'utf8');
    expect(diskContent).toContain('New body.');
    expect(diskContent).toContain('New Name');
  });

  it('throws if entry not found', () => {
    expect(() => store.update('bad-id', { body: 'x' })).toThrow();
  });

  it('throws for body > 512 KB', () => {
    const projectPath = '/test/big';
    const encoded = projectPath.replace(/^\//, '').replace(/\//g, '-');
    const memDir = path.join(tmpDir, 'memory-base', encoded, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    const filePath = path.join(memDir, 'big.md');
    fs.writeFileSync(filePath, '---\nname: "B"\ndescription: "d"\ntype: user\n---\nBody.');
    store.syncProject(projectPath);
    const entries = store.getByProject(projectPath);
    const id = entries[0].id;
    expect(() => store.update(id, { body: 'x'.repeat(531_000) })).toThrow(/512 KB/);
  });

  it('rejects path traversal attempts', () => {
    // Manually insert a dangerous entry
    const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
    db.prepare(`
      INSERT INTO memory_entries (id, project_path, source, type, file_path, name, description, body, file_mtime, last_indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('evil', '/safe', 'auto-memory', 'user', '/etc/passwd', 'E', 'd', 'body', 0, 0);

    expect(() => store.update('evil', { body: 'pwned' })).toThrow(/path traversal/i);
  });
});

describe('search', () => {
  beforeEach(() => {
    const projectPath = '/test/search';
    const encoded = projectPath.replace(/^\//, '').replace(/\//g, '-');
    const memDir = path.join(tmpDir, 'memory-base', encoded, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(
      path.join(memDir, 'feedback_ts.md'),
      '---\nname: "TypeScript feedback"\ndescription: "TS rules"\ntype: feedback\n---\nAlways use strict TypeScript.',
    );
    fs.writeFileSync(
      path.join(memDir, 'user_role.md'),
      '---\nname: "My Role"\ndescription: "Senior engineer"\ntype: user\n---\nI work on backend systems.',
    );
    store.syncProject(projectPath);
  });

  it('returns matching results for a query', () => {
    const results = store.search('TypeScript');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.name).toBe('TypeScript feedback');
  });

  it('returns empty array for no match', () => {
    const results = store.search('xyznonexistent');
    expect(results).toHaveLength(0);
  });

  it('returns positive scores', () => {
    const results = store.search('TypeScript');
    expect(results.every(r => r.score >= 0)).toBe(true);
  });

  it('filters by projectPath', () => {
    // Add a second project
    const p2 = '/test/search2';
    const e2 = p2.replace(/^\//, '').replace(/\//g, '-');
    const d2 = path.join(tmpDir, 'memory-base', e2, 'memory');
    fs.mkdirSync(d2, { recursive: true });
    fs.writeFileSync(
      path.join(d2, 'role.md'),
      '---\nname: "Proj2 TypeScript"\ndescription: "d"\ntype: user\n---\nOther project.',
    );
    store.syncProject(p2);

    const results = store.search('TypeScript', { projectPath: '/test/search' });
    expect(results.every(r => r.entry.projectPath === '/test/search')).toBe(true);
  });
});
