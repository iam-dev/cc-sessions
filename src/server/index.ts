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
import { SessionStore } from '../store/sessions';
import { getUIHtml } from './ui';

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

/** GET /api/projects */
function handleProjects(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  store: SessionStore,
): void {
  const projects = store.getProjects();
  sendJson(res, 200, { data: projects });
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

// ─── router ───────────────────────────────────────────────────────────────────

/**
 * Route an incoming request to the appropriate handler.
 */
function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  store: SessionStore,
): void {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const pathname = url.parse(req.url ?? '').pathname ?? '/';

  if (pathname === '/') {
    handleRoot(req, res);
    return;
  }

  if (pathname === '/api/projects') {
    handleProjects(req, res, store);
    return;
  }

  if (pathname === '/api/sessions') {
    handleSessions(req, res, store);
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
export function createServer(store: SessionStore): ServerHandle {
  const server = http.createServer((req, res) => {
    try {
      route(req, res, store);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendJson(res, 500, { error: message });
    }
  });

  return { server };
}
