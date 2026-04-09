/**
 * CC-Sessions Web UI Server
 *
 * A minimal Node.js HTTP server that:
 *  - Serves the SPA HTML page at GET /
 *  - Provides JSON REST API endpoints under /api/
 *
 * No framework dependencies — uses only Node.js built-in `http` module.
 */

import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { SessionStore } from '../store/sessions';
import { MemoryStore } from '../store/memory';
import { getUIHtml } from './ui';
import { aggregateProjectHealth } from '../analysis/health';
import { getRecurringBlockers } from '../analysis/patterns';

// ─── types ────────────────────────────────────────────────────────────────────

interface SuccessEnvelope<T> {
  data: T;
}

interface ErrorEnvelope {
  error: string;
}

type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

/** Return value of createServer — allows callers to control the server lifecycle. */
export interface ServerHandle {
  server: http.Server;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Write a JSON API response.
 */
function sendJson<T>(
  res: http.ServerResponse,
  status: number,
  body: ApiEnvelope<T>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':  'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control':  'no-store',
  });
  res.end(payload);
}

/**
 * Write an HTML response (for the SPA root).
 */
function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    'Content-Type':  'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control':  'no-store',
  });
  res.end(html);
}

/**
 * Extract the session id from a path like /api/sessions/:id.
 * Returns the decoded id string, or null if the path does not match the pattern.
 */
function parseSessionId(pathname: string): string | null {
  const prefix = '/api/sessions/';
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length);
  // Reject empty segments and paths with further slashes (sub-routes)
  if (!segment || segment.includes('/')) return null;
  return decodeURIComponent(segment);
}

/**
 * Extract a session id from a path like /api/sessions/:id/messages.
 * Returns the decoded id, or null if the path does not match.
 */
function parseSessionMessagesPath(pathname: string): string | null {
  const prefix = '/api/sessions/';
  const suffix = '/messages';
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
  const segment = pathname.slice(prefix.length, -suffix.length);
  if (!segment || segment.includes('/')) return null;
  return decodeURIComponent(segment);
}

/**
 * Parse an integer query parameter.
 * Returns null when the parameter is absent, NaN when it is present but invalid.
 */
function parseIntParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  return n; // NaN propagates to callers
}

// ─── route handlers ───────────────────────────────────────────────────────────

/** GET / — serve the SPA HTML */
function handleRoot(_req: http.IncomingMessage, res: http.ServerResponse): void {
  sendHtml(res, getUIHtml());
}

/**
 * Extract a project path from a path like /api/projects/:path.
 * Returns the decoded path string, or null if the path does not match.
 */
function parseProjectPath(pathname: string): string | null {
  const prefix = '/api/projects/';
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length);
  if (!segment || segment.includes('/')) return null;
  return decodeURIComponent(segment);
}

/** GET /api/projects */
function handleProjects(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  store: SessionStore,
): void {
  const projects = store.getProjects();
  const augmented = projects.map(p => {
    const recentSessions = store.getRecent(5, p.projectPath);
    const health = aggregateProjectHealth(recentSessions);
    const blockers = getRecurringBlockers(recentSessions);
    const topBlocker = blockers.find(b => b.count >= 2) ?? null;
    return { ...p, health, topBlocker };
  });
  sendJson(res, 200, { data: augmented });
}

/** GET /api/projects/:path */
function handleProjectByPath(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  store: SessionStore,
  projectPath: string,
): void {
  const allProjects = store.getProjects();
  const summary = allProjects.find(p => p.projectPath === projectPath);
  if (!summary) {
    sendJson(res, 404, { error: 'Project not found: ' + projectPath });
    return;
  }

  // Read README.md from the project directory; create one if absent
  const readmePath = path.join(projectPath, 'README.md');
  let readmeContent = '';
  try {
    readmeContent = fs.readFileSync(readmePath, 'utf8');
  } catch {
    const defaultReadme =
      `# ${summary.projectName}\n\n` +
      `> Add a description of this project here.\n`;
    try {
      fs.writeFileSync(readmePath, defaultReadme, 'utf8');
      readmeContent = defaultReadme;
    } catch {
      // Project dir may not be writable — leave readmeContent empty
    }
  }

  const recentSessions = store.getRecent(5, projectPath);
  sendJson(res, 200, { data: { ...summary, recentSessions, readmeContent } });
}

/** GET /api/sessions[?project=path&limit=N] */
function handleSessions(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  store: SessionStore,
): void {
  const parsed = url.parse(req.url ?? '', true);
  const params = new URLSearchParams(parsed.search ?? '');

  const limitRaw = parseIntParam(params, 'limit');
  if (limitRaw !== null && isNaN(limitRaw)) {
    sendJson(res, 400, { error: 'Invalid "limit" parameter — must be a positive integer' });
    return;
  }
  const limit       = limitRaw ?? 20;
  const projectPath = params.get('project') ?? undefined;

  const sessions = store.getRecent(limit, projectPath);
  sendJson(res, 200, { data: sessions });
}

/** GET /api/sessions/:id */
function handleSessionById(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  store: SessionStore,
  sessionId: string,
): void {
  const session = store.getById(sessionId);
  if (!session) {
    sendJson(res, 404, { error: 'Session not found: ' + sessionId });
    return;
  }
  sendJson(res, 200, { data: session });
}

/** GET /api/sessions/:id/messages */
function handleSessionMessages(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  store: SessionStore,
  sessionId: string,
): void {
  const session = store.getById(sessionId);
  if (!session) {
    sendJson(res, 404, { error: 'Session not found: ' + sessionId });
    return;
  }

  const logFile = session.logFile;
  if (!logFile || !fs.existsSync(logFile)) {
    sendJson(res, 404, { error: 'Log file not found' });
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(logFile, 'utf-8');
  } catch {
    sendJson(res, 500, { error: 'Failed to read log file' });
    return;
  }

  const lines = content.split('\n').filter(line => line.trim());
  const messages: Array<{ role: string; text: string; timestamp: string }> = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry['type'] !== 'user' && entry['type'] !== 'assistant') continue;

      let text = '';
      const entryContent = entry['content'];
      const entryMessage = entry['message'] as Record<string, unknown> | undefined;

      if (typeof entryContent === 'string') {
        text = entryContent;
      } else if (entryMessage?.['content']) {
        const c = entryMessage['content'];
        if (typeof c === 'string') {
          text = c;
        } else if (Array.isArray(c)) {
          text = (c as Array<{ type: string; text?: string }>)
            .filter(b => b.type === 'text')
            .map(b => b.text ?? '')
            .join('\n');
        }
      }

      if (!text.trim()) continue;

      messages.push({
        role: entry['type'] === 'user' ? 'user' : 'assistant',
        text: text.trim(),
        timestamp: typeof entry['timestamp'] === 'string' ? entry['timestamp'] : '',
      });
    } catch {
      continue;
    }
  }

  sendJson(res, 200, { data: messages });
}

/** GET /api/search?q=query[&limit=N] */
function handleSearch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  store: SessionStore,
): void {
  const parsed = url.parse(req.url ?? '', true);
  const params = new URLSearchParams(parsed.search ?? '');

  const q = params.get('q');
  if (!q || q.trim() === '') {
    sendJson(res, 400, { error: 'Missing required query parameter: q' });
    return;
  }

  const limitRaw = parseIntParam(params, 'limit');
  if (limitRaw !== null && isNaN(limitRaw)) {
    sendJson(res, 400, { error: 'Invalid "limit" parameter — must be a positive integer' });
    return;
  }
  const limit = limitRaw ?? 20;

  const results = store.search(q.trim(), limit);
  sendJson(res, 200, { data: results });
}

/** GET /api/stats */
function handleStats(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  store: SessionStore,
): void {
  const stats = store.getStats();
  sendJson(res, 200, { data: stats });
}

// ─── body parsing ─────────────────────────────────────────────────────────────

/**
 * Collect all chunks from the request stream and parse as JSON.
 * Resolves to the parsed value, or rejects with a SyntaxError on malformed input.
 */
async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

// ─── router ───────────────────────────────────────────────────────────────────

/**
 * Route an incoming request to the appropriate handler.
 */
async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  store: SessionStore,
  memoryStore: MemoryStore | undefined,
): Promise<void> {
  const method = req.method ?? 'GET';
  const pathname = url.parse(req.url ?? '').pathname ?? '/';

  // ── Memory mutation routes (PUT / POST) ──────────────────────────────────

  if (method === 'POST' && pathname === '/api/memory/sync') {
    if (!memoryStore) return sendJson(res, 503, { error: 'Memory store not available' });
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    const { projectPath: syncPath } = body as { projectPath?: string };
    if (!syncPath || typeof syncPath !== 'string') {
      return sendJson(res, 400, { error: 'projectPath required' });
    }
    const result = memoryStore.syncProject(syncPath);
    return sendJson(res, 200, { data: { result } });
  }

  if (method === 'POST' && pathname === '/api/memory/create-claude-md') {
    if (!memoryStore) return sendJson(res, 503, { error: 'Memory store not available' });
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    const { projectPath: claudePath, content } = body as { projectPath?: string; content?: string };
    if (!claudePath || typeof claudePath !== 'string') {
      return sendJson(res, 400, { error: 'projectPath required' });
    }
    if (!fs.existsSync(path.resolve(claudePath))) {
      return sendJson(res, 422, { error: `Project directory not found: ${claudePath}` });
    }
    const targetPath = path.resolve(claudePath, 'CLAUDE.md');
    const safeRoot = path.resolve(claudePath) + path.sep;
    if (!targetPath.startsWith(safeRoot)) {
      return sendJson(res, 403, { error: 'Path traversal detected' });
    }
    if (fs.existsSync(targetPath)) {
      return sendJson(res, 409, { error: 'CLAUDE.md already exists' });
    }
    fs.writeFileSync(targetPath, typeof content === 'string' ? content : '', 'utf8');
    memoryStore.syncProject(claudePath);
    return sendJson(res, 201, { data: { path: targetPath } });
  }

  const memoryIdMatch = pathname.match(/^\/api\/memory\/([^/]+)$/);
  if (method === 'PUT' && memoryIdMatch) {
    if (!memoryStore) return sendJson(res, 503, { error: 'Memory store not available' });
    const id = decodeURIComponent(memoryIdMatch[1]!);
    let fields: Record<string, unknown>;
    try {
      fields = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    try {
      const updated = memoryStore.update(id, fields as Parameters<MemoryStore['update']>[1]);
      return sendJson(res, 200, { data: { entry: updated } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      const status = msg.toLowerCase().includes('not found') ? 404
        : msg.toLowerCase().includes('traversal') ? 403
        : msg.toLowerCase().includes('512') ? 400
        : 500;
      return sendJson(res, status, { error: msg });
    }
  }

  // ── GET-only guard ────────────────────────────────────────────────────────

  if (method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  if (pathname === '/') {
    handleRoot(req, res);
    return;
  }

  if (pathname === '/api/projects') {
    handleProjects(req, res, store);
    return;
  }

  const projectPath = parseProjectPath(pathname);
  if (projectPath !== null) {
    handleProjectByPath(req, res, store, projectPath);
    return;
  }

  if (pathname === '/api/sessions') {
    handleSessions(req, res, store);
    return;
  }

  const messagesSessionId = parseSessionMessagesPath(pathname);
  if (messagesSessionId !== null) {
    handleSessionMessages(req, res, store, messagesSessionId);
    return;
  }

  const sessionId = parseSessionId(pathname);
  if (sessionId !== null) {
    handleSessionById(req, res, store, sessionId);
    return;
  }

  if (pathname === '/api/search') {
    handleSearch(req, res, store);
    return;
  }

  if (pathname === '/api/stats') {
    handleStats(req, res, store);
    return;
  }

  if (pathname === '/api/memory') {
    const memParams = new URLSearchParams(url.parse(req.url ?? '').search ?? '');
    const projectPath = memParams.get('project');
    if (!projectPath) {
      sendJson(res, 400, { error: 'project required' });
      return;
    }
    if (!memoryStore) {
      sendJson(res, 503, { error: 'Memory store not available' });
      return;
    }
    const entries = memoryStore.getByProject(projectPath);
    sendJson(res, 200, { data: entries });
    return;
  }

  if (pathname === '/api/memory/search') {
    const memParams = new URLSearchParams(url.parse(req.url ?? '').search ?? '');
    const q = memParams.get('q');
    if (!q) {
      sendJson(res, 400, { error: 'q required' });
      return;
    }
    if (!memoryStore) {
      sendJson(res, 503, { error: 'Memory store not available' });
      return;
    }
    const projectPath = memParams.get('projectPath') ?? undefined;
    const limitParam = memParams.get('limit');
    const limitParsed = limitParam ? parseInt(limitParam, 10) : undefined;
    const limit = limitParsed !== undefined && !isNaN(limitParsed) ? limitParsed : undefined;
    const results = memoryStore.search(q, { projectPath, limit });
    sendJson(res, 200, { data: results });
    return;
  }

  if (memoryIdMatch) {
    if (!memoryStore) {
      sendJson(res, 503, { error: 'Memory store not available' });
      return;
    }
    const entry = memoryStore.getById(decodeURIComponent(memoryIdMatch[1]!));
    if (!entry) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    sendJson(res, 200, { data: entry });
    return;
  }

  sendJson(res, 404, { error: 'Route not found: ' + pathname });
}

// ─── factory ──────────────────────────────────────────────────────────────────

/**
 * Create a new HTTP server bound to the given SessionStore.
 *
 * The server is NOT started — call server.listen() after creation.
 *
 * @example
 * ```typescript
 * const store = new SessionStore();
 * const { server } = createServer(store);
 * server.listen(3456, '127.0.0.1', () => console.log('Ready'));
 * ```
 */
export function createServer(store: SessionStore, memoryStore?: MemoryStore): ServerHandle {
  const server = http.createServer((req, res) => {
    route(req, res, store, memoryStore).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendJson(res, 500, { error: message });
    });
  });

  return { server };
}
