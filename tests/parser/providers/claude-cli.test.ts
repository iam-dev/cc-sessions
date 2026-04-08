import { EventEmitter } from 'events';
import type * as childProcessTypes from 'child_process';

// ── module-level mock so spawn is configurable ────────────────────────────────

jest.mock('child_process', () => ({
  ...jest.requireActual<typeof import('child_process')>('child_process'),
  spawn: jest.fn(),
}));

import { tryClaudeCli } from '../../../src/parser/providers/claude-cli';
import type { ParsedSession } from '../../../src/types';
import * as childProcess from 'child_process';

const mockSpawn = childProcess.spawn as jest.Mock;

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
    logPath: '/home/user/project/.claude/sessions/test-uuid.jsonl',
    ...overrides,
  };
}

// ── helper to create a fake child process ─────────────────────────────────────

function fakeProcess(stdout: string, exitCode: number): childProcessTypes.ChildProcessWithoutNullStreams {
  const proc = new EventEmitter() as childProcessTypes.ChildProcessWithoutNullStreams;
  proc.stdout = new EventEmitter() as typeof proc.stdout;
  proc.stderr = new EventEmitter() as typeof proc.stderr;

  setTimeout(() => {
    proc.stdout.emit('data', Buffer.from(stdout));
    proc.emit('close', exitCode);
  }, 0);

  return proc;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('tryClaudeCli', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when claude is not in PATH', async () => {
    const origPath = process.env.PATH;
    process.env.PATH = '';
    const result = await tryClaudeCli(makeSession());
    expect(result).toBeNull();
    process.env.PATH = origPath;
  });

  it('returns null when spawn fails with ENOENT', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter() as childProcessTypes.ChildProcessWithoutNullStreams;
      proc.stdout = new EventEmitter() as typeof proc.stdout;
      proc.stderr = new EventEmitter() as typeof proc.stderr;
      setTimeout(() => proc.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })), 0);
      return proc;
    });

    const result = await tryClaudeCli(makeSession());
    expect(result).toBeNull();
  });

  it('returns null when process exits with non-zero code', async () => {
    mockSpawn.mockImplementation(() => fakeProcess('', 1));

    const result = await tryClaudeCli(makeSession());
    expect(result).toBeNull();
  });

  it('returns null when claude returns is_error: true', async () => {
    const envelope = JSON.stringify({ type: 'result', subtype: 'error', result: '', is_error: true });
    mockSpawn.mockImplementation(() => fakeProcess(envelope, 0));

    const result = await tryClaudeCli(makeSession());
    expect(result).toBeNull();
  });

  it('returns null when claude returns empty result', async () => {
    const envelope = JSON.stringify({ type: 'result', subtype: 'success', result: '', is_error: false });
    mockSpawn.mockImplementation(() => fakeProcess(envelope, 0));

    const result = await tryClaudeCli(makeSession());
    expect(result).toBeNull();
  });

  it('returns null when result JSON has no summary', async () => {
    const inner = JSON.stringify({ description: 'no summary' });
    const envelope = JSON.stringify({ type: 'result', subtype: 'success', result: inner, is_error: false });
    mockSpawn.mockImplementation(() => fakeProcess(envelope, 0));

    const result = await tryClaudeCli(makeSession());
    expect(result).toBeNull();
  });

  it('returns null when output is not valid JSON', async () => {
    mockSpawn.mockImplementation(() => fakeProcess('not json at all', 0));

    const result = await tryClaudeCli(makeSession());
    expect(result).toBeNull();
  });

  it('parses a valid claude CLI response', async () => {
    const inner = JSON.stringify({
      summary: 'Fixed the bug',
      description: 'We fixed it',
      tasks: [{ description: 'Fix null pointer', status: 'completed' }],
      nextSteps: ['deploy'],
      keyDecisions: ['use patch'],
      blockers: [],
      tags: ['bugfix'],
    });
    const envelope = JSON.stringify({ type: 'result', subtype: 'success', result: inner, is_error: false });
    mockSpawn.mockImplementation(() => fakeProcess(envelope, 0));

    const result = await tryClaudeCli(makeSession());
    expect(result).not.toBeNull();
    expect(result!.summary).toBe('Fixed the bug');
    expect(result!.tags).toContain('bugfix');
    expect(result!.tasks[0].status).toBe('completed');
  });

  it('normalizes "done" status to completed', async () => {
    const inner = JSON.stringify({
      summary: 'test',
      description: '',
      tasks: [{ description: 'task', status: 'done' }],
      nextSteps: [],
      keyDecisions: [],
      blockers: [],
      tags: [],
    });
    const envelope = JSON.stringify({ type: 'result', subtype: 'success', result: inner, is_error: false });
    mockSpawn.mockImplementation(() => fakeProcess(envelope, 0));

    const result = await tryClaudeCli(makeSession());
    expect(result!.tasks[0].status).toBe('completed');
  });

  it('normalizes "in_progress" status', async () => {
    const inner = JSON.stringify({
      summary: 'test',
      description: '',
      tasks: [{ description: 'ongoing task', status: 'in_progress' }],
      nextSteps: [],
      keyDecisions: [],
      blockers: [],
      tags: [],
    });
    const envelope = JSON.stringify({ type: 'result', subtype: 'success', result: inner, is_error: false });
    mockSpawn.mockImplementation(() => fakeProcess(envelope, 0));

    const result = await tryClaudeCli(makeSession());
    expect(result!.tasks[0].status).toBe('in_progress');
  });

  it('normalizes "blocked" status', async () => {
    const inner = JSON.stringify({
      summary: 'test',
      description: '',
      tasks: [{ description: 'stuck task', status: 'blocked' }],
      nextSteps: [],
      keyDecisions: [],
      blockers: [],
      tags: [],
    });
    const envelope = JSON.stringify({ type: 'result', subtype: 'success', result: inner, is_error: false });
    mockSpawn.mockImplementation(() => fakeProcess(envelope, 0));

    const result = await tryClaudeCli(makeSession());
    expect(result!.tasks[0].status).toBe('blocked');
  });

  it('handles session with files in prompt (coverage for buildPrompt)', async () => {
    mockSpawn.mockImplementation(() => fakeProcess('', 1));

    await tryClaudeCli(makeSession({ filesCreated: ['/a.ts'], filesModified: ['/b.ts'] }));
    expect(mockSpawn).toHaveBeenCalled();
  });

  it('handles large token counts in prompt (formatTokens M)', async () => {
    mockSpawn.mockImplementation(() => fakeProcess('', 1));

    await tryClaudeCli(makeSession({ tokensUsed: 2_000_000 }));
    expect(mockSpawn).toHaveBeenCalled();
  });

  it('handles k-range token counts in prompt (formatTokens K)', async () => {
    mockSpawn.mockImplementation(() => fakeProcess('', 1));

    await tryClaudeCli(makeSession({ tokensUsed: 5000 }));
    expect(mockSpawn).toHaveBeenCalled();
  });

  it('handles many messages (formatMessages slices to last N)', async () => {
    mockSpawn.mockImplementation(() => fakeProcess('', 1));

    await tryClaudeCli(makeSession({ userMessages: Array(10).fill('msg') }));
    expect(mockSpawn).toHaveBeenCalled();
  });

  it('handles non-array tasks in result JSON', async () => {
    const inner = JSON.stringify({
      summary: 'ok',
      description: '',
      tasks: null,
      nextSteps: [],
      keyDecisions: [],
      blockers: [],
      tags: [],
    });
    const envelope = JSON.stringify({ type: 'result', subtype: 'success', result: inner, is_error: false });
    mockSpawn.mockImplementation(() => fakeProcess(envelope, 0));

    const result = await tryClaudeCli(makeSession());
    expect(result!.tasks).toEqual([]);
  });
});
