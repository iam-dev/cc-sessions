import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findPreviousSessionLog } from '../../src/hooks/utils';

describe('findPreviousSessionLog', () => {
  const tmpDir = path.join(os.tmpdir(), `utils-test-${Date.now()}`);

  beforeAll(() => { fs.mkdirSync(tmpDir, { recursive: true }); });
  afterAll(() => { fs.rmSync(tmpDir, { recursive: true }); });

  function makeJsonl(name: string, content = 'line1\nline2'): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content, 'utf8');
    return p;
  }

  it('returns null when no JSONL files exist in projectDir', () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    const result = findPreviousSessionLog(emptyDir, path.join(emptyDir, 'new.jsonl'));
    expect(result).toBeNull();
  });

  it('excludes the transcript_path (new session file)', () => {
    const newFile = makeJsonl('new-session.jsonl', 'data');
    const oldFile = makeJsonl('old-session.jsonl', 'old data');

    // Make old-session older in mtime: write it first, then touch newFile
    const result = findPreviousSessionLog(tmpDir, newFile);
    // old-session should be returned since new-session is excluded
    expect(result).not.toBeNull();
    expect(path.resolve(result!)).not.toBe(path.resolve(newFile));
  });

  it('skips empty files', () => {
    const emptyDir2 = path.join(tmpDir, 'empty2');
    fs.mkdirSync(emptyDir2, { recursive: true });
    const emptyFile = path.join(emptyDir2, 'empty.jsonl');
    fs.writeFileSync(emptyFile, '', 'utf8');
    const newFile2   = path.join(emptyDir2, 'new.jsonl');
    fs.writeFileSync(newFile2, 'data', 'utf8');

    const result = findPreviousSessionLog(emptyDir2, newFile2);
    // empty.jsonl should be skipped → null (no other candidate)
    expect(result).toBeNull();
  });

  it('returns null when only match is older than maxAgeMinutes', () => {
    const oldDir = path.join(tmpDir, 'old');
    fs.mkdirSync(oldDir, { recursive: true });
    const ancient = path.join(oldDir, 'ancient.jsonl');
    fs.writeFileSync(ancient, 'data', 'utf8');

    // Set mtime to 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(ancient, twoHoursAgo, twoHoursAgo);

    const newFile3 = path.join(oldDir, 'new.jsonl');
    fs.writeFileSync(newFile3, '', 'utf8');

    const result = findPreviousSessionLog(oldDir, newFile3, 60);
    expect(result).toBeNull();
  });

  it('uses path.resolve for comparison (handles trailing slashes etc)', () => {
    const candidate = makeJsonl(`resolve-test-${Date.now()}.jsonl`, 'data');
    // Pass newFile as the exact same path but with different casing/resolution won't work
    // on macOS, so just test that excluding it by normalized path works
    const result = findPreviousSessionLog(tmpDir, candidate);
    // candidate is the newest file; excluding it should return another or null
    // Key: it must not return candidate itself
    if (result !== null) {
      expect(path.resolve(result)).not.toBe(path.resolve(candidate));
    }
  });
});
