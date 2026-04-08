/**
 * Session Importer
 *
 * Imports Claude Code CLI sessions from the global store (~/.claude/projects/)
 * into the cc-sessions database. Handles deduplication, progress reporting,
 * and optional AI summary generation.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { Config, SessionMemory, SessionSummary, ParsedSession } from '../types';
import { SessionStore } from '../store/sessions';
import { findAllLogFiles, findLatestLogFile, parseLogFile } from '../parser/jsonl';
import { generateSummary } from '../parser/summarizer';

/**
 * Options controlling what gets imported and how
 */
export interface ImportOptions {
  /** Only import sessions whose project path contains this string */
  projectPath?: string;
  /** Preview results without writing anything to the database */
  dryRun?: boolean;
  /** Only import sessions that started on or after this date */
  since?: Date;
  /** Maximum number of sessions to import (default: 100) */
  limit?: number;
  /** Skip AI-powered summary generation; use rule-based fallback */
  skipAI?: boolean;
  /** Called after each log file is processed */
  onProgress?: (current: number, total: number, logPath: string) => void;
}

/**
 * Result of a batch import operation
 */
export interface ImportResult {
  /** Number of new sessions written to the database */
  imported: number;
  /** Number of sessions skipped because they were already in the database */
  skipped: number;
  /** Number of sessions that failed to parse or save */
  failed: number;
  /** Error messages for failed sessions */
  errors: string[];
  /** The SessionMemory objects that were (or would have been) imported */
  sessions: SessionMemory[];
}

/**
 * Import all Claude Code CLI sessions from the global store into the database.
 *
 * @param store  - Open SessionStore instance to write into
 * @param config - Application configuration (used for AI summary settings)
 * @param options - Filtering and behaviour options
 * @returns Summary of what was imported, skipped, and failed
 */
export async function importFromGlobalStore(
  store: SessionStore,
  config: Config,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const {
    projectPath,
    dryRun = false,
    since,
    limit = 100,
    skipAI = false,
    onProgress,
  } = options;

  const result: ImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    sessions: [],
  };

  // Locate all JSONL log files produced by the Claude Code CLI
  let logFiles = findAllLogFiles();

  if (logFiles.length === 0) {
    return result;
  }

  // Filter by project path substring when requested
  if (projectPath) {
    const encodedPath = encodeURIComponent(projectPath);
    logFiles = logFiles.filter(
      (f) => f.includes(encodedPath) || f.includes(projectPath)
    );
  }

  // Sort oldest-first so the import order is chronological
  logFiles = logFiles
    .map((f) => ({ path: f, mtime: safeStatMtime(f) }))
    .sort((a, b) => a.mtime - b.mtime)
    .map((f) => f.path);

  // Apply limit *before* processing to avoid unnecessary work
  logFiles = logFiles.slice(0, limit);

  const total = logFiles.length;

  for (let i = 0; i < total; i++) {
    const logPath = logFiles[i];

    onProgress?.(i + 1, total, logPath);

    try {
      const session = await importSingleFile(logPath, store, config, {
        dryRun,
        since,
        skipAI,
      });

      if (session === 'skipped') {
        result.skipped++;
      } else if (session !== null) {
        result.imported++;
        result.sessions.push(session);
      }
    } catch (err) {
      result.failed++;
      result.errors.push(
        `${path.basename(logPath)}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

/**
 * Import a single Claude Code CLI session JSONL file into the database.
 *
 * @param logPath - Absolute path to the .jsonl file
 * @param store   - Open SessionStore instance
 * @param config  - Application configuration
 * @param opts    - Per-file import options
 * @returns The created SessionMemory, `'skipped'` when already present, or
 *          `null` when filtered out by the `since` option
 */
export async function importSingleFile(
  logPath: string,
  store: SessionStore,
  config: Config,
  opts: { dryRun?: boolean; since?: Date; skipAI?: boolean } = {}
): Promise<SessionMemory | 'skipped' | null> {
  const { dryRun = false, since, skipAI = false } = opts;

  const parsed = parseLogFile(logPath);

  // Apply date filter
  if (since && parsed.startTime < since) {
    return null;
  }

  // Skip sessions with no content
  if (parsed.messagesCount === 0) {
    return null;
  }

  // Deduplicate: skip if already stored by claudeSessionId
  if (store.getByClaudeSessionId(parsed.claudeSessionId)) {
    return 'skipped';
  }

  // Generate summary (AI or rule-based)
  const summary = await resolveSummary(parsed, config, skipAI);

  // Build the SessionMemory object
  const sessionMemory = buildSessionMemory(parsed, summary, logPath);

  if (!dryRun) {
    store.save(sessionMemory);
  }

  return sessionMemory;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/**
 * Build a SessionMemory from a parsed log and its summary.
 */
function buildSessionMemory(
  parsed: ParsedSession,
  summary: SessionSummary,
  logPath: string
): SessionMemory {
  const completedTasks = summary.tasks.filter((t) => t.status === 'completed');
  const pendingTasks = summary.tasks.filter((t) => t.status !== 'completed');

  return {
    id: generateId(),
    claudeSessionId: parsed.claudeSessionId,
    projectPath: parsed.projectPath,
    projectName: path.basename(parsed.projectPath),
    startedAt: parsed.startTime,
    endedAt: parsed.endTime,
    duration: parsed.duration,
    summary: summary.summary,
    description: summary.description,
    tasks: summary.tasks,
    tasksCompleted: completedTasks.length,
    tasksPending: pendingTasks.length,
    filesCreated: parsed.filesCreated,
    filesModified: parsed.filesModified,
    filesDeleted: parsed.filesDeleted,
    lastUserMessage: parsed.userMessages.at(-1) ?? '',
    lastAssistantMessage: (parsed.assistantMessages.at(-1) ?? '').slice(0, 1000),
    nextSteps: summary.nextSteps,
    keyDecisions: summary.keyDecisions,
    blockers: summary.blockers,
    tokensUsed: parsed.tokensUsed,
    messagesCount: parsed.messagesCount,
    toolCallsCount: parsed.toolCalls.length,
    tags: ['imported', ...summary.tags],
    archived: false,
    logFile: logPath,
  };
}

/**
 * Produce a summary, either via AI or the rule-based fallback.
 */
async function resolveSummary(
  parsed: ParsedSession,
  config: Config,
  skipAI: boolean
): Promise<SessionSummary> {
  return generateSummary(parsed, config.summaries, skipAI);
}

/**
 * Generate a unique session memory ID.
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `mem_${timestamp}_${random}`;
}

/**
 * Safely read a file's modification time in milliseconds.
 * Returns 0 if the file cannot be stat'd.
 */
function safeStatMtime(filePath: string): number {
  try {
    return fs.statSync(filePath).mtime.getTime();
  } catch {
    return 0;
  }
}

// Re-export findLatestLogFile for convenience
export { findLatestLogFile };
