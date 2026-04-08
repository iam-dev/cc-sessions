/**
 * Tests for src/analysis/health.ts
 */

import {
  computeHealth,
  getHealthLabel,
  aggregateProjectHealth,
} from '../../src/analysis/health';
import type { SessionMemory } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionMemory> = {}): SessionMemory {
  return {
    id: 'test-id',
    claudeSessionId: 'claude-session-test',
    projectPath: '/test/project',
    projectName: 'test-project',
    startedAt: new Date('2025-01-12T10:00:00Z'),
    endedAt: new Date('2025-01-12T11:00:00Z'),
    duration: 60,
    summary: '',
    description: '',
    tasks: [],
    tasksCompleted: 0,
    tasksPending: 0,
    filesCreated: [],
    filesModified: [],
    filesDeleted: [],
    lastUserMessage: '',
    lastAssistantMessage: '',
    nextSteps: [],
    keyDecisions: [],
    blockers: [],
    tokensUsed: 0,
    messagesCount: 0,
    toolCallsCount: 0,
    tags: [],
    archived: false,
    logFile: '/test/log.jsonl',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeHealth
// ---------------------------------------------------------------------------

describe('computeHealth', () => {
  describe('green cases', () => {
    it('returns green with confidence=low when 0 blockers and 0 tasks', () => {
      const result = computeHealth(makeSession());
      expect(result.score).toBe('green');
      expect(result.confidence).toBe('low');
      expect(result.reasons).toContain('no blockers');
    });

    it('returns green with confidence=medium when 0 blockers and all tasks done', () => {
      const result = computeHealth(
        makeSession({ tasksCompleted: 4, tasksPending: 0, blockers: [] })
      );
      expect(result.score).toBe('green');
      expect(result.confidence).toBe('medium');
      expect(result.reasons).toContain('no blockers');
      expect(result.reasons).toContain('4/4 tasks done');
    });

    it('returns green at >= 0.67 completion (3/4 = 75%)', () => {
      const result = computeHealth(
        makeSession({ tasksCompleted: 3, tasksPending: 1, blockers: [] })
      );
      expect(result.score).toBe('green');
      expect(result.reasons).toContain('3/4 tasks done');
    });

    it('returns green at 67/100 completion (0.67 exactly meets threshold)', () => {
      // 67/100 = 0.67 exactly, which is NOT < 0.67, so the yellow condition is false
      const result = computeHealth(
        makeSession({ tasksCompleted: 67, tasksPending: 33, blockers: [] })
      );
      expect(result.score).toBe('green');
      expect(result.reasons).toContain('67/100 tasks done');
    });

    it('returns green when 0 blockers and 0 tasks total (exploratory)', () => {
      const result = computeHealth(
        makeSession({ tasksCompleted: 0, tasksPending: 0, blockers: [], nextSteps: [] })
      );
      expect(result.score).toBe('green');
      expect(result.confidence).toBe('low');
    });
  });

  describe('yellow cases', () => {
    it('returns yellow when exactly 1 blocker', () => {
      const result = computeHealth(makeSession({ blockers: ['auth broken'] }));
      expect(result.score).toBe('yellow');
      expect(result.reasons).toContain('1 blocker');
    });

    it('returns yellow when exactly 2 blockers', () => {
      const result = computeHealth(
        makeSession({ blockers: ['auth broken', 'db down'] })
      );
      expect(result.score).toBe('yellow');
      expect(result.reasons).toContain('2 blockers');
    });

    it('returns yellow when tasks exist and completion rate < 0.67', () => {
      // 1/5 = 20%
      const result = computeHealth(
        makeSession({ tasksCompleted: 1, tasksPending: 4, blockers: [] })
      );
      expect(result.score).toBe('yellow');
      expect(result.reasons).toContain('20% tasks done');
    });

    it('returns yellow when next steps exist, no blockers, and 0/5 tasks completed', () => {
      const result = computeHealth(
        makeSession({
          tasksCompleted: 0,
          tasksPending: 5,
          blockers: [],
          nextSteps: ['deploy to staging'],
        })
      );
      expect(result.score).toBe('yellow');
      expect(result.reasons).toContain('work in progress');
    });

    it('returns yellow at 2/3 completion (0.6667 < 0.67 threshold)', () => {
      // 2/3 ≈ 0.6667, which is strictly less than 0.67, so it does not meet the green threshold
      const result = computeHealth(
        makeSession({ tasksCompleted: 2, tasksPending: 1, blockers: [] })
      );
      expect(result.score).toBe('yellow');
      expect(result.reasons).toContain('67% tasks done');
    });

    it('uses blocker reason over completion rate reason when both apply', () => {
      // 1 blocker + low completion: blocker reason takes priority
      const result = computeHealth(
        makeSession({ tasksCompleted: 1, tasksPending: 4, blockers: ['db down'] })
      );
      expect(result.score).toBe('yellow');
      expect(result.reasons).toContain('1 blocker');
      expect(result.reasons).not.toContain('20% tasks done');
    });
  });

  describe('red cases', () => {
    it('returns red when 3 blockers', () => {
      const result = computeHealth(
        makeSession({ blockers: ['a', 'b', 'c'] })
      );
      expect(result.score).toBe('red');
      expect(result.reasons).toContain('3 blockers');
    });

    it('returns red with confidence=high when 3+ blockers and tasks exist', () => {
      const result = computeHealth(
        makeSession({ blockers: ['a', 'b', 'c'], tasksCompleted: 2, tasksPending: 1 })
      );
      expect(result.score).toBe('red');
      expect(result.confidence).toBe('high');
    });

    it('returns red when 1 blocker, 0 tasks completed, and next steps exist', () => {
      const result = computeHealth(
        makeSession({
          blockers: ['env misconfigured'],
          tasksCompleted: 0,
          tasksPending: 0,
          nextSteps: ['fix env'],
        })
      );
      expect(result.score).toBe('red');
      expect(result.reasons).toContain('1 blocker');
      expect(result.reasons).toContain('blocked with no progress');
    });

    it('returns red when 2 blockers, 0 tasks completed, and tasks exist', () => {
      const result = computeHealth(
        makeSession({
          blockers: ['a', 'b'],
          tasksCompleted: 0,
          tasksPending: 3,
        })
      );
      expect(result.score).toBe('red');
    });

    it('returns red when 4 blockers', () => {
      const result = computeHealth(
        makeSession({ blockers: ['a', 'b', 'c', 'd'] })
      );
      expect(result.score).toBe('red');
      expect(result.reasons).toContain('4 blockers');
    });
  });

  describe('confidence', () => {
    it('is high when blockers > 0 AND tasksTotal > 0', () => {
      const result = computeHealth(
        makeSession({ blockers: ['x'], tasksCompleted: 1, tasksPending: 1 })
      );
      expect(result.confidence).toBe('high');
    });

    it('is medium when only blockers > 0', () => {
      const result = computeHealth(
        makeSession({ blockers: ['x'], tasksCompleted: 0, tasksPending: 0 })
      );
      expect(result.confidence).toBe('medium');
    });

    it('is medium when only tasksTotal > 0', () => {
      const result = computeHealth(
        makeSession({ blockers: [], tasksCompleted: 3, tasksPending: 2 })
      );
      expect(result.confidence).toBe('medium');
    });

    it('is low when both blockers and tasks are 0', () => {
      const result = computeHealth(makeSession());
      expect(result.confidence).toBe('low');
    });
  });
});

// ---------------------------------------------------------------------------
// getHealthLabel
// ---------------------------------------------------------------------------

describe('getHealthLabel', () => {
  it('returns Healthy for green', () => {
    expect(getHealthLabel('green')).toBe('Healthy');
  });

  it('returns Mixed for yellow', () => {
    expect(getHealthLabel('yellow')).toBe('Mixed');
  });

  it('returns Struggling for red', () => {
    expect(getHealthLabel('red')).toBe('Struggling');
  });
});

// ---------------------------------------------------------------------------
// aggregateProjectHealth
// ---------------------------------------------------------------------------

describe('aggregateProjectHealth', () => {
  it('returns green when all sessions are green', () => {
    const sessions = [
      makeSession({ id: '1' }),
      makeSession({ id: '2' }),
      makeSession({ id: '3' }),
    ];
    const result = aggregateProjectHealth(sessions);
    expect(result.score).toBe('green');
    expect(result.label).toBe('Healthy');
    expect(result.redCount).toBe(0);
    expect(result.yellowCount).toBe(0);
    expect(result.recentSessionCount).toBe(3);
  });

  it('returns red when 2 or more recent sessions are red', () => {
    const redSession = makeSession({ blockers: ['a', 'b', 'c'] });
    const sessions = [
      { ...redSession, id: '1' },
      { ...redSession, id: '2' },
      makeSession({ id: '3' }),
    ];
    const result = aggregateProjectHealth(sessions);
    expect(result.score).toBe('red');
    expect(result.label).toBe('Struggling');
    expect(result.redCount).toBe(2);
  });

  it('returns yellow when exactly 1 red session', () => {
    const redSession = makeSession({ blockers: ['a', 'b', 'c'] });
    const sessions = [
      { ...redSession, id: '1' },
      makeSession({ id: '2' }),
      makeSession({ id: '3' }),
    ];
    const result = aggregateProjectHealth(sessions);
    expect(result.score).toBe('yellow');
    expect(result.redCount).toBe(1);
  });

  it('returns yellow when 2 yellow sessions and 0 red', () => {
    const yellowSession = makeSession({ blockers: ['minor issue'] });
    const sessions = [
      { ...yellowSession, id: '1' },
      { ...yellowSession, id: '2' },
      makeSession({ id: '3' }),
    ];
    const result = aggregateProjectHealth(sessions);
    expect(result.score).toBe('yellow');
    expect(result.yellowCount).toBe(2);
    expect(result.redCount).toBe(0);
  });

  it('returns green when only 1 yellow session and 0 red', () => {
    const yellowSession = makeSession({ blockers: ['minor issue'] });
    const sessions = [
      { ...yellowSession, id: '1' },
      makeSession({ id: '2' }),
      makeSession({ id: '3' }),
    ];
    const result = aggregateProjectHealth(sessions);
    expect(result.score).toBe('green');
    expect(result.yellowCount).toBe(1);
  });

  it('respects the recentCount parameter and only scores the first N sessions', () => {
    // First 3 sessions are green; sessions 4-5 are red (should be ignored with recentCount=3)
    const redSession = makeSession({ blockers: ['a', 'b', 'c'] });
    const sessions = [
      makeSession({ id: '1' }),
      makeSession({ id: '2' }),
      makeSession({ id: '3' }),
      { ...redSession, id: '4' },
      { ...redSession, id: '5' },
    ];
    const result = aggregateProjectHealth(sessions, 3);
    expect(result.score).toBe('green');
    expect(result.recentSessionCount).toBe(3);
    expect(result.redCount).toBe(0);
  });

  it('returns green for an empty sessions array', () => {
    const result = aggregateProjectHealth([]);
    expect(result.score).toBe('green');
    expect(result.recentSessionCount).toBe(0);
    expect(result.redCount).toBe(0);
    expect(result.yellowCount).toBe(0);
  });

  it('defaults recentCount to 5', () => {
    const redSession = makeSession({ blockers: ['a', 'b', 'c'] });
    // 6 sessions: positions 1-2 are red (within default 5), position 6 is green
    const sessions = [
      { ...redSession, id: '1' },
      { ...redSession, id: '2' },
      makeSession({ id: '3' }),
      makeSession({ id: '4' }),
      makeSession({ id: '5' }),
      makeSession({ id: '6' }), // outside default window
    ];
    const result = aggregateProjectHealth(sessions);
    expect(result.recentSessionCount).toBe(5);
    expect(result.redCount).toBe(2);
    expect(result.score).toBe('red');
  });
});
