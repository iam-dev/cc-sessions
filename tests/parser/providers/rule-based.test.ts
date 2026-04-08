import { ruleBasedSummary } from '../../../src/parser/providers/rule-based';
import type { ParsedSession } from '../../../src/types';

function makeSession(overrides: Partial<ParsedSession> = {}): ParsedSession {
  return {
    claudeSessionId: 'test-uuid',
    projectPath: '/Users/alice/projects/myapp',
    startTime: new Date(),
    endTime: new Date(),
    duration: 8,
    messagesCount: 10,
    userMessages: ['Add authentication', 'looks good'],
    assistantMessages: ["I'll implement JWT auth. Let's start with the middleware."],
    toolCalls: [],
    filesCreated: [],
    filesModified: ['src/auth.ts', 'src/middleware.ts'],
    filesDeleted: [],
    tokensUsed: 5000,
    logPath: '',
    ...overrides,
  };
}

describe('ruleBasedSummary', () => {
  it('derives summary from first user message + modified files', () => {
    const result = ruleBasedSummary(makeSession());
    expect(result.summary).toContain('myapp');
    expect(result.summary.length).toBeGreaterThan(10);
  });

  it('appends no-ai-summary tag', () => {
    const result = ruleBasedSummary(makeSession());
    expect(result.tags).toContain('no-ai-summary');
  });

  it('extracts technology tags from file extensions', () => {
    const result = ruleBasedSummary(makeSession({ filesModified: ['app.ts', 'styles.css'] }));
    expect(result.tags).toContain('no-ai-summary');
    expect(result.tags).toContain('typescript');
  });

  it('always succeeds — returns valid SessionSummary shape', () => {
    const result = ruleBasedSummary(makeSession({ userMessages: [], assistantMessages: [] }));
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('description');
    expect(Array.isArray(result.tasks)).toBe(true);
    expect(Array.isArray(result.nextSteps)).toBe(true);
    expect(Array.isArray(result.keyDecisions)).toBe(true);
    expect(Array.isArray(result.blockers)).toBe(true);
    expect(Array.isArray(result.tags)).toBe(true);
    expect(result.tags).toContain('no-ai-summary');
  });

  it('extracts tasks from checkbox patterns in assistant messages', () => {
    const result = ruleBasedSummary(makeSession({
      assistantMessages: ['- [x] Implement JWT\n- [ ] Add tests'],
    }));
    expect(result.tasks.length).toBeGreaterThan(0);
  });

  it('description includes first user message intent', () => {
    const result = ruleBasedSummary(makeSession({ userMessages: ['Refactor the database layer'] }));
    expect(result.description).toContain('Refactor the database layer');
  });
});
