import { tryAnthropicApi } from '../../../src/parser/providers/anthropic-api';
import type { ParsedSession, SummaryConfig } from '../../../src/types';

const testConfig: SummaryConfig = { model: 'haiku', maxLength: 500, include: [] };

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
    logPath: '',
  };
}

describe('tryAnthropicApi', () => {
  it('returns null when ANTHROPIC_API_KEY is not set', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result).toBeNull();

    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  });

  // Integration test — skipped in CI (no real key available)
  it.skip('returns SessionSummary when ANTHROPIC_API_KEY is set', async () => {
    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result).not.toBeNull();
    expect(result!.summary).toBeTruthy();
    expect(Array.isArray(result!.tags)).toBe(true);
    expect(result!.tags).not.toContain('no-ai-summary');
  });
});
