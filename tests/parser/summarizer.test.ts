import { generateSummary } from '../../src/parser/summarizer';
import type { ParsedSession, SummaryConfig } from '../../src/types';

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

describe('generateSummary', () => {
  it('returns a valid SessionSummary when skipAI=true (rule-based path)', async () => {
    const result = await generateSummary(makeSession(), testConfig, true);
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('description');
    expect(result.tags).toContain('no-ai-summary');
  });

  it('returns a valid SessionSummary with default skipAI (full chain, falls to rule-based in test env)', async () => {
    // In test env: CC CLI not available, no ANTHROPIC_API_KEY → falls through to rule-based
    delete process.env.ANTHROPIC_API_KEY;
    const result = await generateSummary(makeSession(), testConfig);
    expect(result.tags).toContain('no-ai-summary');
  });

  it('skipAI=true result tags always include no-ai-summary', async () => {
    const result = await generateSummary(makeSession(), testConfig, true);
    expect(result.tags).toContain('no-ai-summary');
  });

  it('returns summary with non-empty summary string', async () => {
    const result = await generateSummary(makeSession(), testConfig, true);
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
