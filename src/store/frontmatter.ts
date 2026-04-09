export interface ParsedFrontmatter {
  name: string;
  description: string;
  type: string;
  body: string;
}

/**
 * Parse YAML-lite frontmatter from a markdown file.
 * Supports only the three scalar keys used by Claude Code memory:
 * name, description, type.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { name: '', description: '', type: '', body: content };
  }

  const yamlBlock = fmMatch[1];
  const body = fmMatch[2].trimStart();

  function extractValue(key: string): string {
    const re = new RegExp(`^${key}:\\s*(.*)$`, 'm');
    const m = yamlBlock.match(re);
    if (!m) return '';
    const raw = m[1].trim();
    // Handle double-quoted string with escaped internal quotes
    if (raw.startsWith('"') && raw.endsWith('"')) {
      return raw.slice(1, -1).replace(/\\"/g, '"');
    }
    return raw;
  }

  return {
    name: extractValue('name'),
    description: extractValue('description'),
    type: extractValue('type'),
    body,
  };
}

/**
 * Serialize memory entry fields back to a markdown file with frontmatter.
 * name and description are always double-quoted to be YAML-safe.
 */
export function serializeFrontmatter(
  name: string,
  description: string,
  type: string,
  body: string,
): string {
  const q = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;
  return `---\nname: ${q(name)}\ndescription: ${q(description)}\ntype: ${type}\n---\n\n${body}`;
}
