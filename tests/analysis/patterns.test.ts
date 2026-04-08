/**
 * Tests for src/analysis/patterns.ts
 */

import {
  normalizeBlocker,
  getRecurringBlockers,
} from '../../src/analysis/patterns';
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
// normalizeBlocker
// ---------------------------------------------------------------------------

describe('normalizeBlocker', () => {
  it('lowercases and trims the text', () => {
    expect(normalizeBlocker('  Auth Service Down  ')).toBe('auth service down');
  });

  it('removes punctuation by replacing with spaces and collapsing', () => {
    expect(normalizeBlocker('db:connection-reset!')).toBe('db connection reset');
  });

  it('strips "Error: " prefix', () => {
    expect(normalizeBlocker('Error: connection refused')).toBe('connection refused');
  });

  it('strips "blocked by " prefix', () => {
    expect(normalizeBlocker('blocked by missing env var')).toBe('missing env var');
  });

  it('strips "Failed " prefix', () => {
    expect(normalizeBlocker('Failed to build docker image')).toBe('to build docker image');
  });

  it('collapses multiple spaces into one', () => {
    expect(normalizeBlocker('auth   service   down')).toBe('auth   service   down'.replace(/\s+/g, ' ').trim());
  });

  it('handles already-normalized input unchanged', () => {
    expect(normalizeBlocker('database unreachable')).toBe('database unreachable');
  });
});

// ---------------------------------------------------------------------------
// getRecurringBlockers
// ---------------------------------------------------------------------------

describe('getRecurringBlockers', () => {
  it('returns [] for empty sessions array', () => {
    expect(getRecurringBlockers([])).toEqual([]);
  });

  it('returns [] when all sessions have no blockers', () => {
    const sessions = [
      makeSession({ id: '1' }),
      makeSession({ id: '2' }),
    ];
    expect(getRecurringBlockers(sessions)).toEqual([]);
  });

  it('returns a single entry with count 3 when three sessions have identical blocker text', () => {
    const sessions = [
      makeSession({ id: '1', blockers: ['database connection failed'] }),
      makeSession({ id: '2', blockers: ['database connection failed'] }),
      makeSession({ id: '3', blockers: ['database connection failed'] }),
    ];
    const result = getRecurringBlockers(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('database connection failed');
    expect(result[0].count).toBe(3);
  });

  it('groups near-duplicate blockers with different word order together', () => {
    const sessions = [
      makeSession({ id: '1', blockers: ['authentication service down'] }),
      makeSession({ id: '2', blockers: ['service authentication down'] }),
      makeSession({ id: '3', blockers: ['authentication service unavailable'] }),
    ];
    const result = getRecurringBlockers(sessions);
    // All three share enough tokens to be grouped
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(3);
  });

  it('groups near-duplicate blockers with minor variation together', () => {
    const sessions = [
      makeSession({ id: '1', blockers: ['Error: database unreachable'] }),
      makeSession({ id: '2', blockers: ['database unreachable host'] }),
    ];
    const result = getRecurringBlockers(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
  });

  it('returns at most 3 results (top 3 by count)', () => {
    const sessions = [
      makeSession({ id: '1', blockers: ['alpha blocker one', 'beta issue two', 'gamma problem three', 'delta failure four'] }),
      makeSession({ id: '2', blockers: ['alpha blocker one', 'beta issue two', 'gamma problem three'] }),
      makeSession({ id: '3', blockers: ['alpha blocker one', 'beta issue two'] }),
      makeSession({ id: '4', blockers: ['alpha blocker one'] }),
    ];
    const result = getRecurringBlockers(sessions);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('sorts results by count descending', () => {
    const sessions = [
      makeSession({ id: '1', blockers: ['network timeout'] }),
      makeSession({ id: '2', blockers: ['network timeout'] }),
      makeSession({ id: '3', blockers: ['network timeout'] }),
      makeSession({ id: '4', blockers: ['missing api key'] }),
      makeSession({ id: '5', blockers: ['missing api key'] }),
    ];
    const result = getRecurringBlockers(sessions);
    expect(result[0].count).toBeGreaterThanOrEqual(result[1]?.count ?? 0);
    // The most common blocker is network timeout with count 3
    expect(result[0].count).toBe(3);
    expect(result[1].count).toBe(2);
  });

  it('keeps dissimilar blockers as separate groups', () => {
    const sessions = [
      makeSession({ id: '1', blockers: ['authentication broken'] }),
      makeSession({ id: '2', blockers: ['disk space exhausted'] }),
      makeSession({ id: '3', blockers: ['network firewall blocking'] }),
    ];
    const result = getRecurringBlockers(sessions);
    // All three are dissimilar enough to be separate groups, each with count 1
    expect(result.length).toBe(3);
    result.forEach(r => expect(r.count).toBe(1));
  });
});
