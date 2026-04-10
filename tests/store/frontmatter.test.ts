import { parseFrontmatter, serializeFrontmatter } from '../../src/store/frontmatter';

describe('parseFrontmatter', () => {
  it('parses a well-formed frontmatter block', () => {
    const md = `---\nname: My Entry\ndescription: Does something\ntype: feedback\n---\n\nBody text here.`;
    const result = parseFrontmatter(md);
    expect(result.name).toBe('My Entry');
    expect(result.description).toBe('Does something');
    expect(result.type).toBe('feedback');
    expect(result.body).toBe('Body text here.');
  });

  it('strips frontmatter from body', () => {
    const md = `---\nname: x\ndescription: y\ntype: user\n---\nLine1\nLine2`;
    const result = parseFrontmatter(md);
    expect(result.body).toBe('Line1\nLine2');
  });

  it('returns defaults when no frontmatter block exists', () => {
    const md = `Just a plain file.\nNo frontmatter.`;
    const result = parseFrontmatter(md);
    expect(result.name).toBe('');
    expect(result.description).toBe('');
    expect(result.type).toBe('');
    expect(result.body).toBe(md);
  });

  it('handles quoted values', () => {
    const md = `---\nname: "Entry with \\"quotes\\""\ndescription: plain\ntype: reference\n---\nBody`;
    const result = parseFrontmatter(md);
    expect(result.name).toBe('Entry with "quotes"');
  });
});

describe('serializeFrontmatter', () => {
  it('wraps name and description in double quotes, escaping internal quotes', () => {
    const out = serializeFrontmatter('My "Entry"', 'Desc "here"', 'feedback', 'Body text');
    expect(out).toContain('name: "My \\"Entry\\""');
    expect(out).toContain('description: "Desc \\"here\\""');
    expect(out).toContain('type: feedback');
    expect(out).toContain('Body text');
  });

  it('produces parseable output (round-trip)', () => {
    const body = 'Some body\nwith multiple lines.';
    const serialized = serializeFrontmatter('The Name', 'The Desc', 'project', body);
    const parsed = parseFrontmatter(serialized);
    expect(parsed.name).toBe('The Name');
    expect(parsed.description).toBe('The Desc');
    expect(parsed.type).toBe('project');
    expect(parsed.body).toBe(body);
  });
});
