/**
 * Encode a project path the same way Claude Code does:
 * strip leading '/', replace remaining '/' with '-'.
 */
export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/^\//, '').replace(/\//g, '-');
}

/**
 * Build a stable, URL-safe ID for a memory entry.
 * Format: base64url("<projectPath>\x00<relativeFilePath>")
 * The NUL delimiter lets decodeId split unambiguously even when paths contain colons.
 */
export function encodeId(projectPath: string, relativeFilePath: string): string {
  const raw = `${projectPath}\x00${relativeFilePath}`;
  return Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface DecodedId {
  projectPath: string;
  relativeFilePath: string;
}

/**
 * Decode an ID produced by encodeId.
 * Throws if the payload has no NUL delimiter.
 */
export function decodeId(id: string): DecodedId {
  // Restore base64 padding
  const padded = id.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  const b64 = padded + '='.repeat(pad);
  const raw = Buffer.from(b64, 'base64').toString('utf8');
  const nul = raw.indexOf('\x00');
  if (nul === -1) throw new Error(`Invalid memory entry id: ${id}`);
  return {
    projectPath: raw.slice(0, nul),
    relativeFilePath: raw.slice(nul + 1),
  };
}
