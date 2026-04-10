import { encodeProjectPath, encodeId, decodeId } from '../../src/store/memoryUtils';

describe('encodeProjectPath', () => {
  it('drops leading slash and replaces slashes with hyphens', () => {
    expect(encodeProjectPath('/Users/foo/bar')).toBe('Users-foo-bar');
  });

  it('handles paths with no leading slash', () => {
    expect(encodeProjectPath('Users/foo/bar')).toBe('Users-foo-bar');
  });
});

describe('encodeId / decodeId', () => {
  it('round-trips a simple entry', () => {
    const id = encodeId('/Users/foo/bar', 'memory/user_role.md');
    const { projectPath, relativeFilePath } = decodeId(id);
    expect(projectPath).toBe('/Users/foo/bar');
    expect(relativeFilePath).toBe('memory/user_role.md');
  });

  it('round-trips a path containing colons', () => {
    const id = encodeId('/Users/foo:bar', 'memory/feedback.md');
    const { projectPath, relativeFilePath } = decodeId(id);
    expect(projectPath).toBe('/Users/foo:bar');
    expect(relativeFilePath).toBe('memory/feedback.md');
  });

  it('round-trips CLAUDE.md entry', () => {
    const id = encodeId('/Users/foo/proj', 'CLAUDE.md');
    const { projectPath, relativeFilePath } = decodeId(id);
    expect(projectPath).toBe('/Users/foo/proj');
    expect(relativeFilePath).toBe('CLAUDE.md');
  });
});
