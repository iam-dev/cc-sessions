/**
 * TDD tests for the Sessions HTTP API server.
 * Written BEFORE implementation — expected to fail until production code is added.
 */

import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { SessionStore } from '../../src/store/sessions';
import { createServer } from '../../src/server/index';
import type { SessionMemory } from '../../src/types';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<SessionMemory> = {}): SessionMemory {
  return {
    id: `test-${Math.random().toString(36).slice(2, 10)}`,
    claudeSessionId: 'claude-test',
    projectPath: '/test/project',
    projectName: 'test-project',
    startedAt: new Date('2024-06-01T10:00:00Z'),
    endedAt: new Date('2024-06-01T10:30:00Z'),
    duration: 30,
    summary: 'Test session summary',
    description: 'Detailed description of what happened',
    tasks: [{ id: 't1', description: 'Do the thing', status: 'completed', createdAt: new Date() }],
    tasksCompleted: 1,
    tasksPending: 0,
    filesCreated: ['src/new.ts'],
    filesModified: ['src/existing.ts'],
    filesDeleted: [],
    lastUserMessage: 'implement X',
    lastAssistantMessage: 'done',
    nextSteps: ['Deploy to prod'],
    keyDecisions: ['Used SQLite'],
    blockers: [],
    tokensUsed: 5000,
    messagesCount: 20,
    toolCallsCount: 8,
    tags: ['feature'],
    archived: false,
    logFile: '/tmp/test.jsonl',
    ...overrides,
  };
}

/** Make a GET request against the test server and parse the response body. */
async function get(
  port: number,
  urlPath: string,
): Promise<{ status: number; body: unknown; rawBody: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method: 'GET', path: urlPath }, res => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data), rawBody: data });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: data, rawBody: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── test suite ─────────────────────────────────────────────────────────────

describe('Sessions HTTP API', () => {
  let server: http.Server;
  let store: SessionStore;
  let port: number;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sessions-api-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    store = new SessionStore(dbPath);
    ({ server } = createServer(store));

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr !== null ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
  });

  // ── GET / ──────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    test('serves the SPA HTML page', async () => {
      const { status, rawBody } = await get(port, '/');
      expect(status).toBe(200);
      expect(rawBody).toContain('<!DOCTYPE html>');
      expect(rawBody).toContain('CC Sessions');
    });
  });

  // ── GET /api/projects ──────────────────────────────────────────────────────

  describe('GET /api/projects', () => {
    test('returns empty array when no sessions exist', async () => {
      const { status, body } = await get(port, '/api/projects');
      expect(status).toBe(200);
      expect((body as { data: unknown[] }).data).toEqual([]);
    });

    test('returns project list with session counts', async () => {
      store.save(makeSession({ projectPath: '/app', projectName: 'app' }));
      store.save(makeSession({ projectPath: '/app', projectName: 'app' }));

      const { status, body } = await get(port, '/api/projects');
      const { data } = body as { data: Array<{ projectPath: string; sessionCount: number }> };

      expect(status).toBe(200);
      expect(data).toHaveLength(1);
      expect(data[0]!.projectPath).toBe('/app');
      expect(data[0]!.sessionCount).toBe(2);
    });

    test('orders projects by most recent activity', async () => {
      store.save(makeSession({ projectPath: '/old', projectName: 'old', startedAt: new Date('2023-01-01') }));
      store.save(makeSession({ projectPath: '/new', projectName: 'new', startedAt: new Date('2024-01-01') }));

      const { body } = await get(port, '/api/projects');
      const { data } = body as { data: Array<{ projectPath: string }> };

      expect(data[0]!.projectPath).toBe('/new');
    });
  });

  // ── GET /api/sessions ─────────────────────────────────────────────────────

  describe('GET /api/sessions', () => {
    test('returns recent sessions', async () => {
      store.save(makeSession());
      store.save(makeSession());

      const { status, body } = await get(port, '/api/sessions');
      const { data } = body as { data: SessionMemory[] };

      expect(status).toBe(200);
      expect(data).toHaveLength(2);
    });

    test('filters sessions by project path via ?project= param', async () => {
      store.save(makeSession({ projectPath: '/alpha', projectName: 'alpha' }));
      store.save(makeSession({ projectPath: '/beta', projectName: 'beta' }));

      const { status, body } = await get(port, '/api/sessions?project=%2Falpha');
      const { data } = body as { data: SessionMemory[] };

      expect(status).toBe(200);
      expect(data).toHaveLength(1);
      expect(data[0]!.projectPath).toBe('/alpha');
    });

    test('respects ?limit= parameter', async () => {
      for (let i = 0; i < 6; i++) store.save(makeSession());

      const { status, body } = await get(port, '/api/sessions?limit=3');
      const { data } = body as { data: unknown[] };

      expect(status).toBe(200);
      expect(data).toHaveLength(3);
    });

    test('rejects non-numeric limit with 400', async () => {
      const { status, body } = await get(port, '/api/sessions?limit=abc');
      const { error } = body as { error: string };

      expect(status).toBe(400);
      expect(error).toBeTruthy();
    });
  });

  // ── GET /api/sessions/:id ─────────────────────────────────────────────────

  describe('GET /api/sessions/:id', () => {
    test('returns the session matching the id', async () => {
      const session = makeSession({ id: 'unique-id-123' });
      store.save(session);

      const { status, body } = await get(port, '/api/sessions/unique-id-123');
      const { data } = body as { data: SessionMemory };

      expect(status).toBe(200);
      expect(data.id).toBe('unique-id-123');
      expect(data.summary).toBe(session.summary);
      expect(data.tasks).toHaveLength(1);
    });

    test('returns 404 for an unknown session id', async () => {
      const { status, body } = await get(port, '/api/sessions/does-not-exist');
      const { error } = body as { error: string };

      expect(status).toBe(404);
      expect(error).toBeTruthy();
    });
  });

  // ── GET /api/search ────────────────────────────────────────────────────────

  describe('GET /api/search', () => {
    test('returns sessions matching the search query', async () => {
      store.save(makeSession({ id: 'auth-session', summary: 'Implement OAuth2 authentication flow' }));
      store.save(makeSession({ id: 'css-session', summary: 'Fix responsive CSS layout bug' }));

      const { status, body } = await get(port, '/api/search?q=authentication');
      const { data } = body as { data: Array<{ session: { id: string }; score: number }> };

      expect(status).toBe(200);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]!.session.id).toBe('auth-session');
    });

    test('returns empty array when no sessions match', async () => {
      store.save(makeSession({ summary: 'Some completely different work' }));

      const { status, body } = await get(port, '/api/search?q=zzzxxx-no-match-term');
      const { data } = body as { data: unknown[] };

      expect(status).toBe(200);
      expect(data).toEqual([]);
    });

    test('returns 400 when ?q= parameter is absent', async () => {
      const { status, body } = await get(port, '/api/search');
      const { error } = body as { error: string };

      expect(status).toBe(400);
      expect(error).toContain('q');
    });
  });

  // ── GET /api/stats ─────────────────────────────────────────────────────────

  describe('GET /api/stats', () => {
    test('returns storage statistics including total session count', async () => {
      store.save(makeSession());
      store.save(makeSession());

      const { status, body } = await get(port, '/api/stats');
      const { data } = body as { data: { totalSessions: number; activeSessions: number } };

      expect(status).toBe(200);
      expect(data.totalSessions).toBe(2);
      expect(data.activeSessions).toBe(2);
    });

    test('returns stats with zero sessions when store is empty', async () => {
      const { status, body } = await get(port, '/api/stats');
      const { data } = body as { data: { totalSessions: number } };

      expect(status).toBe(200);
      expect(data.totalSessions).toBe(0);
    });
  });

  // ── unknown routes ─────────────────────────────────────────────────────────

  describe('Unknown routes', () => {
    test('returns 404 for unrecognised API paths', async () => {
      const { status } = await get(port, '/api/nonexistent');
      expect(status).toBe(404);
    });
  });

  // ── Non-GET methods ────────────────────────────────────────────────────────

  describe('Non-GET methods', () => {
    test('returns 405 for POST requests', async () => {
      const { status } = await new Promise<{ status: number }>((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, method: 'POST', path: '/api/sessions' }, res => {
          resolve({ status: res.statusCode ?? 0 });
          res.resume();
        });
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(405);
    });
  });

  // ── GET /api/projects/:path ────────────────────────────────────────────────

  describe('GET /api/projects/:path', () => {
    test('returns 404 for unknown project path', async () => {
      const { status, body } = await get(port, `/api/projects/${encodeURIComponent('/nonexistent/proj')}`);
      expect(status).toBe(404);
      expect((body as { error: string }).error).toContain('Project not found');
    });

    test('returns project details including recentSessions for known project', async () => {
      store.save(makeSession({ projectPath: '/my/proj', projectName: 'proj' }));
      const { status, body } = await get(port, `/api/projects/${encodeURIComponent('/my/proj')}`);
      expect(status).toBe(200);
      const data = (body as { data: { projectPath: string; recentSessions: unknown[] } }).data;
      expect(data.projectPath).toBe('/my/proj');
      expect(Array.isArray(data.recentSessions)).toBe(true);
    });
  });

  // ── GET /api/sessions/:id/messages ────────────────────────────────────────

  describe('GET /api/sessions/:id/messages', () => {
    test('returns 404 for unknown session', async () => {
      const { status } = await get(port, '/api/sessions/no-such-session/messages');
      expect(status).toBe(404);
    });

    test('returns 404 when log file does not exist on disk', async () => {
      store.save(makeSession({ id: 'no-log-session', logFile: '/no/such/file.jsonl' }));
      const { status } = await get(port, '/api/sessions/no-log-session/messages');
      expect(status).toBe(404);
    });

    test('returns messages from a valid log file with string content', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-msgs-'));
      const logFile = path.join(tmpDir, 'test.jsonl');
      const lines = [
        JSON.stringify({ type: 'human', content: 'Hello there', timestamp: '2024-01-01T10:00:00Z' }),
        JSON.stringify({ type: 'assistant', content: 'Hi friend', timestamp: '2024-01-01T10:00:01Z' }),
        JSON.stringify({ type: 'system', content: 'ignored' }),
      ];
      fs.writeFileSync(logFile, lines.join('\n'));

      store.save(makeSession({ id: 'msgs-test', logFile }));

      const { status, body } = await get(port, '/api/sessions/msgs-test/messages');
      expect(status).toBe(200);
      const { data } = body as { data: Array<{ role: string; text: string }> };
      expect(data).toHaveLength(2);
      expect(data[0]!.role).toBe('user');
      expect(data[1]!.role).toBe('assistant');

      fs.rmSync(tmpDir, { recursive: true });
    });

    test('parses message.content object format', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-msgs2-'));
      const logFile = path.join(tmpDir, 'test.jsonl');
      const entry = {
        type: 'human',
        message: { content: 'Hi from message.content' },
        timestamp: '2024-01-01T10:00:00Z',
      };
      fs.writeFileSync(logFile, JSON.stringify(entry));

      store.save(makeSession({ id: 'msgs-test2', logFile }));
      const { status, body } = await get(port, '/api/sessions/msgs-test2/messages');
      expect(status).toBe(200);
      const { data } = body as { data: Array<{ role: string; text: string }> };
      expect(data[0]!.text).toBe('Hi from message.content');

      fs.rmSync(tmpDir, { recursive: true });
    });

    test('parses message.content array format', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-msgs3-'));
      const logFile = path.join(tmpDir, 'test.jsonl');
      const entry = {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello from array' }, { type: 'tool_use' }] },
        timestamp: '2024-01-01T10:00:00Z',
      };
      fs.writeFileSync(logFile, JSON.stringify(entry));

      store.save(makeSession({ id: 'msgs-test3', logFile }));
      const { status, body } = await get(port, '/api/sessions/msgs-test3/messages');
      expect(status).toBe(200);
      const { data } = body as { data: Array<{ role: string; text: string }> };
      expect(data[0]!.text).toBe('Hello from array');

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  // ── GET /api/search invalid limit ─────────────────────────────────────────

  describe('GET /api/search with invalid limit', () => {
    test('returns 400 when limit is not a number', async () => {
      const { status, body } = await get(port, '/api/search?q=test&limit=abc');
      expect(status).toBe(400);
      expect((body as { error: string }).error).toContain('limit');
    });
  });
});
