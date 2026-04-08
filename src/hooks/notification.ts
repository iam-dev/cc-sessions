/**
 * Notification hook handler for cc-sessions.
 *
 * Fires when Claude Code sends a Notification event.
 * Detects context compaction and snapshots the current session.
 *
 * Entry point: cc-sessions notify (reads JSON from stdin, always exits 0)
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../config/loader';
import { SessionStore } from '../store/sessions';
import { findCurrentSessionLog } from './utils';
import { saveSnapshot } from './snapshot';
import type { Config } from '../types';

interface NotificationPayload {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  params?: {
    message?: string;
  };
}

const DEBUG = !!process.env.CC_MEMORY_DEBUG;

function dbg(msg: string): void {
  if (DEBUG) process.stderr.write('cc-sessions: ' + msg + '\n');
}

/**
 * Resolve the JSONL log path for the given session.
 *
 * Tries a direct path first (cwd/<sessionId>.jsonl) so that tests
 * and edge-cases where the log lives outside ~/.claude/projects work.
 * Falls back to findCurrentSessionLog which scans ~/.claude/projects.
 */
function resolveLogPath(sessionId: string, cwd: string): string | null {
  const direct = path.join(cwd, `${sessionId}.jsonl`);
  if (fs.existsSync(direct)) {
    return direct;
  }
  return findCurrentSessionLog(sessionId, cwd);
}

/**
 * Handle a parsed Notification payload.
 * Exported for unit testing — CLI entry point passes in store + config.
 */
export async function handleNotification(
  payload: NotificationPayload,
  store: SessionStore,
  config: Config,
): Promise<void> {
  if (payload.hook_event_name !== 'Notification') {
    return;
  }

  const message = payload.params?.message ?? '';
  if (!/compact/i.test(message)) {
    dbg('Notification: not a compaction event, skipping');
    return;
  }

  const logPath = resolveLogPath(payload.session_id, payload.cwd);
  if (!logPath) {
    dbg('Notification: no session log found');
    return;
  }

  await saveSnapshot(logPath, store, config, 'pre-compact');
  dbg('Snapshot saved (pre-compact)');
}

/**
 * CLI entry point: cc-sessions notify
 * Reads JSON from stdin, handles compaction, always exits 0.
 */
export default async function notificationHook(): Promise<void> {
  try {
    const rawInput = await readStdin();
    let payload: NotificationPayload;

    try {
      payload = JSON.parse(rawInput) as NotificationPayload;
    } catch {
      dbg('Failed to parse stdin as JSON');
      return;
    }

    const config = await loadConfig();
    const store  = new SessionStore();

    try {
      await handleNotification(payload, store, config);
    } finally {
      store.close();
    }
  } catch (err) {
    dbg('Error: ' + (err instanceof Error ? err.message : String(err)));
    // Always exit 0 — never interrupt the user's Claude Code session
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
