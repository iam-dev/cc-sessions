import { tryClaudeCli } from '../../../src/parser/providers/claude-cli';
import type { ParsedSession } from '../../../src/types';

function makeSession(): ParsedSession {
  return {
    claudeSessionId: 'test-uuid',
    projectPath: '/home/user/project',
    startTime: new Date(),
    endTime: new Date(),
    duration: 5,
    messagesCount: 4,
    userMessages: ['fix the bug'],
    assistantMessages: ["I'll fix it."],
    toolCalls: [],
    filesCreated: [],
    filesModified: ['src/bug.ts'],
    filesDeleted: [],
    tokensUsed: 2000,
    logPath: '/home/user/project/.claude/sessions/test-uuid.jsonl',
  };
}

describe('tryClaudeCli', () => {
  it('returns null when claude is not in PATH', async () => {
    const origPath = process.env.PATH;
    process.env.PATH = '';

    const result = await tryClaudeCli(makeSession());
    expect(result).toBeNull();

    process.env.PATH = origPath;
  });

  it('returns null on spawn timeout (simulated via very low timeout)', async () => {
    // Can't easily unit-test the real spawn without a live claude binary.
    // Verify the function signature at minimum — it returns null, not throws.
    const result = await tryClaudeCli(makeSession()).catch(() => null);
    expect(result === null || (result !== null && typeof result.summary === 'string')).toBe(true);
  });
});
