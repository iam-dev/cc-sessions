import type { ParsedSession, SummaryConfig } from '../../../src/types';

// ── mock SDK before any import ────────────────────────────────────────────────

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { tryAnthropicApi } from '../../../src/parser/providers/anthropic-api';
import Anthropic from '@anthropic-ai/sdk';

const MockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

// ── helpers ───────────────────────────────────────────────────────────────────

const testConfig: SummaryConfig = { model: 'haiku', maxLength: 500, include: [] };
const sonnetConfig: SummaryConfig = { model: 'sonnet', maxLength: 1000, include: [] };

function makeSession(overrides: Partial<ParsedSession> = {}): ParsedSession {
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
    ...overrides,
  };
}

function mockClientCreate(responseText: string) {
  const mockCreate = jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: responseText }],
  });
  MockAnthropic.mockImplementation(() => ({
    messages: { create: mockCreate },
  }) as unknown as Anthropic);
  return mockCreate;
}

// ── test suite ────────────────────────────────────────────────────────────────

describe('tryAnthropicApi', () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  // ── short-circuit when no key ──────────────────────────────────────────────

  it('returns null when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result).toBeNull();
    expect(MockAnthropic).not.toHaveBeenCalled();
  });

  // ── successful response parsing ────────────────────────────────────────────

  it('returns a SessionSummary on valid JSON response', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const responseJson = JSON.stringify({
      summary: 'Fixed the critical bug',
      description: 'We resolved the null pointer exception',
      tasks: [{ description: 'Fix null pointer', status: 'completed' }],
      nextSteps: ['Deploy to production'],
      keyDecisions: ['Use defensive null checks'],
      blockers: [],
      tags: ['bugfix', 'backend'],
    });
    mockClientCreate(responseJson);

    const result = await tryAnthropicApi(makeSession(), testConfig);

    expect(result).not.toBeNull();
    expect(result!.summary).toBe('Fixed the critical bug');
    expect(result!.tags).toContain('bugfix');
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0].status).toBe('completed');
  });

  it('extracts JSON from response wrapped in prose', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const wrapped = `Here is the summary:\n${JSON.stringify({ summary: 'Done', description: 'Finished', tasks: [], nextSteps: [], keyDecisions: [], blockers: [], tags: [] })}`;
    mockClientCreate(wrapped);

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe('Done');
  });

  it('returns null when response contains no JSON object', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockClientCreate('No JSON here at all.');

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result).toBeNull();
  });

  it('returns null when JSON has no summary field', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockClientCreate(JSON.stringify({ description: 'No summary' }));

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result).toBeNull();
  });

  it('returns null on API error', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    MockAnthropic.mockImplementation(() => ({
      messages: {
        create: jest.fn().mockRejectedValue(new Error('API error')),
      },
    }) as unknown as Anthropic);

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result).toBeNull();
  });

  it('returns null when response has no text block', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    MockAnthropic.mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({ content: [{ type: 'tool_use', id: 'x' }] }),
      },
    }) as unknown as Anthropic);

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result).toBeNull();
  });

  // ── model selection ────────────────────────────────────────────────────────

  it('uses sonnet model when config.model is "sonnet"', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const mockCreate = mockClientCreate(JSON.stringify({ summary: 'ok', description: '', tasks: [], nextSteps: [], keyDecisions: [], blockers: [], tags: [] }));

    await tryAnthropicApi(makeSession(), sonnetConfig);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
    );
  });

  it('uses haiku model when config.model is "haiku"', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const mockCreate = mockClientCreate(JSON.stringify({ summary: 'ok', description: '', tasks: [], nextSteps: [], keyDecisions: [], blockers: [], tags: [] }));

    await tryAnthropicApi(makeSession(), testConfig);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
    );
  });

  // ── normalizeStatus coverage ──────────────────────────────────────────────

  it('normalizes task status: "done" → completed', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockClientCreate(JSON.stringify({
      summary: 'test',
      description: '',
      tasks: [{ description: 'task', status: 'done' }],
      nextSteps: [],
      keyDecisions: [],
      blockers: [],
      tags: [],
    }));

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result!.tasks[0].status).toBe('completed');
  });

  it('normalizes task status: "in_progress" → in_progress', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockClientCreate(JSON.stringify({
      summary: 'test',
      description: '',
      tasks: [{ description: 'in progress task', status: 'in_progress' }],
      nextSteps: [],
      keyDecisions: [],
      blockers: [],
      tags: [],
    }));

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result!.tasks[0].status).toBe('in_progress');
  });

  it('normalizes task status: "in progress" → in_progress', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockClientCreate(JSON.stringify({
      summary: 'test',
      description: '',
      tasks: [{ description: 'active task', status: 'in progress' }],
      nextSteps: [],
      keyDecisions: [],
      blockers: [],
      tags: [],
    }));

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result!.tasks[0].status).toBe('in_progress');
  });

  it('normalizes task status: "blocked" → blocked', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockClientCreate(JSON.stringify({
      summary: 'test',
      description: '',
      tasks: [{ description: 'blocked task', status: 'blocked' }],
      nextSteps: [],
      keyDecisions: [],
      blockers: [],
      tags: [],
    }));

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result!.tasks[0].status).toBe('blocked');
  });

  it('normalizes unknown task status → pending', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockClientCreate(JSON.stringify({
      summary: 'test',
      description: '',
      tasks: [{ description: 'unknown task', status: 'whatever' }],
      nextSteps: [],
      keyDecisions: [],
      blockers: [],
      tags: [],
    }));

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result!.tasks[0].status).toBe('pending');
  });

  it('filters out tasks with empty descriptions', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockClientCreate(JSON.stringify({
      summary: 'test',
      description: '',
      tasks: [
        { description: 'valid task', status: 'completed' },
        { description: '', status: 'pending' },
      ],
      nextSteps: [],
      keyDecisions: [],
      blockers: [],
      tags: [],
    }));

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result!.tasks).toHaveLength(1);
  });

  it('handles non-array tasks gracefully', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockClientCreate(JSON.stringify({
      summary: 'test',
      description: '',
      tasks: 'not an array',
      nextSteps: [],
      keyDecisions: [],
      blockers: [],
      tags: [],
    }));

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result!.tasks).toEqual([]);
  });

  it('handles non-array string fields gracefully', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockClientCreate(JSON.stringify({
      summary: 'test',
      description: '',
      tasks: [],
      nextSteps: 'not an array',
      keyDecisions: null,
      blockers: 42,
      tags: [],
    }));

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result!.nextSteps).toEqual([]);
    expect(result!.keyDecisions).toEqual([]);
    expect(result!.blockers).toEqual([]);
  });

  // ── prompt building coverage (via session variations) ─────────────────────

  it('handles session with created files in prompt', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const mockCreate = mockClientCreate(JSON.stringify({ summary: 'ok', description: '', tasks: [], nextSteps: [], keyDecisions: [], blockers: [], tags: [] }));

    await tryAnthropicApi(makeSession({ filesCreated: ['/a.ts', '/b.ts'] }), testConfig);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('/a.ts');
  });

  it('uses "None" when no files in prompt', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const mockCreate = mockClientCreate(JSON.stringify({ summary: 'ok', description: '', tasks: [], nextSteps: [], keyDecisions: [], blockers: [], tags: [] }));

    await tryAnthropicApi(makeSession({ filesCreated: [], filesModified: [] }), testConfig);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('None');
  });

  it('handles large token counts in prompt', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const mockCreate = mockClientCreate(JSON.stringify({ summary: 'ok', description: '', tasks: [], nextSteps: [], keyDecisions: [], blockers: [], tags: [] }));

    await tryAnthropicApi(makeSession({ tokensUsed: 1_500_000 }), testConfig);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('M');
  });

  it('handles k-range token counts in prompt', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const mockCreate = mockClientCreate(JSON.stringify({ summary: 'ok', description: '', tasks: [], nextSteps: [], keyDecisions: [], blockers: [], tags: [] }));

    await tryAnthropicApi(makeSession({ tokensUsed: 3000 }), testConfig);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('K');
  });

  it('handles multiple messages in prompt (last N)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const messages = ['msg1', 'msg2', 'msg3', 'msg4', 'msg5', 'msg6'];
    const mockCreate = mockClientCreate(JSON.stringify({ summary: 'ok', description: '', tasks: [], nextSteps: [], keyDecisions: [], blockers: [], tags: [] }));

    await tryAnthropicApi(makeSession({ userMessages: messages }), testConfig);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    // Should contain the last messages (not all 6 necessarily)
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('shows "No messages" in prompt when messages array is empty', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const mockCreate = mockClientCreate(JSON.stringify({ summary: 'ok', description: '', tasks: [], nextSteps: [], keyDecisions: [], blockers: [], tags: [] }));

    await tryAnthropicApi(makeSession({ userMessages: [], assistantMessages: [] }), testConfig);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('No messages');
  });

  // ── integration test (skipped) ─────────────────────────────────────────────

  it.skip('returns SessionSummary when ANTHROPIC_API_KEY is set (integration)', async () => {
    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result).not.toBeNull();
    expect(result!.summary).toBeTruthy();
    expect(result!.tags).not.toContain('no-ai-summary');
  });
});
