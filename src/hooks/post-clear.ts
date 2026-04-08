/**
 * post-clear.ts — SessionStart hook handler for /clear events.
 *
 * When Claude Code fires SessionStart with matcher "clear", the previous
 * session's JSONL is still on disk. This handler finds it and saves a
 * snapshot tagged 'pre-clear' with a full AI summary (forceAI=true).
 *
 * Always exits 0 — never interrupts the user's session.
 * Entry point: cc-sessions on-clear
 */

import * as path from 'path';
import { loadConfig } from '../config/loader';
import { SessionStore } from '../store/sessions';
import { findPreviousSessionLog } from './utils';
import { saveSnapshot } from './snapshot';
import type { Config } from '../types';

interface PostClearPayload {
  hook_event_name: string;
  session_id: string;
  transcript_path?: string;
  cwd?: string;
}

const DEBUG = !!process.env.CC_MEMORY_DEBUG;

function dbg(msg: string): void {
  if (DEBUG) process.stderr.write('cc-sessions: ' + msg + '\n');
}

/**
 * Handle a parsed SessionStart payload from a /clear event.
 * Exported for unit testing.
 */
export async function handlePostClear(
  payload: PostClearPayload,
  store: SessionStore,
  config: Config,
): Promise<void> {
  if (payload.hook_event_name !== 'SessionStart') {
    return;
  }
  if (!payload.transcript_path) {
    dbg('post-clear: no transcript_path in payload, skipping');
    return;
  }

  const projectDir = path.dirname(path.resolve(payload.transcript_path));
  const clearedLog = findPreviousSessionLog(projectDir, payload.transcript_path);

  if (!clearedLog) {
    dbg('post-clear: no previous session log found');
    return;
  }

  // forceAI=true: always run full provider chain (CC CLI -> API -> rule-based)
  // regardless of config.autoSave.generateSummary
  await saveSnapshot(clearedLog, store, config, 'pre-clear', true);
  dbg(`post-clear: snapshot saved (pre-clear) for ${clearedLog}`);
}

/**
 * CLI entry point: cc-sessions on-clear
 * Reads SessionStart JSON from stdin, handles /clear save. Always exits 0.
 */
export default async function postClearHook(): Promise<void> {
  try {
    const rawInput = await readStdin();
    let payload: PostClearPayload;

    try {
      payload = JSON.parse(rawInput) as PostClearPayload;
    } catch {
      dbg('post-clear: failed to parse stdin JSON');
      return;
    }

    const config = await loadConfig();
    const store  = new SessionStore();

    try {
      await handlePostClear(payload, store, config);
    } finally {
      store.close();
    }
  } catch (err) {
    dbg('post-clear: ' + (err instanceof Error ? err.message : String(err)));
    // Always exit 0
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
