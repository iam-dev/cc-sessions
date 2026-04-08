/**
 * Shared snapshot helper for cc-sessions hooks.
 *
 * saveSnapshot() parses a JSONL log, generates a summary, and upserts the
 * resulting SessionMemory into the store with a caller-supplied tag.
 * The caller owns the store lifecycle (open + close).
 */

import * as path from 'path';
import { parseLogFile } from '../parser/jsonl';
import { generateSummary } from '../parser/summarizer';
import { generateId } from './utils';
import type { SessionStore } from '../store/sessions';
import type { Config, SessionMemory, ParsedSession, SessionSummary } from '../types';

/**
 * Parse, summarise, and upsert a session from a JSONL log file.
 *
 * @param logPath - Absolute path to the .jsonl file
 * @param store   - Open SessionStore (caller must close it)
 * @param config  - App config (controls AI summary)
 * @param tag     - Tag to append to the session (e.g. 'snapshot', 'pre-compact')
 */
export async function saveSnapshot(
  logPath: string,
  store: SessionStore,
  config: Config,
  tag: string,
): Promise<void> {
  const parsed = parseLogFile(logPath);

  if (parsed.messagesCount < 1) {
    return;
  }

  const summary = await resolveSummary(parsed, config);
  const sessionMemory = buildMemory(parsed, summary, logPath);

  // Upsert: if a record already exists for this Claude session, reuse its id
  // so store.save() (INSERT OR REPLACE on primary key) updates it in place
  const existing = store.getByClaudeSessionId(parsed.claudeSessionId);
  if (existing) {
    sessionMemory.id = existing.id;
    // Preserve tags already persisted; append new tag only if not already present
    const merged = Array.from(new Set([...existing.tags, ...sessionMemory.tags, tag]));
    sessionMemory.tags = merged;
  } else {
    sessionMemory.tags = [...sessionMemory.tags, tag];
  }

  store.save(sessionMemory);
}

// ─── private helpers ──────────────────────────────────────────────────────────

async function resolveSummary(parsed: ParsedSession, config: Config): Promise<SessionSummary> {
  if (config.autoSave.generateSummary) {
    try {
      return await generateSummary(parsed, config.summaries);
    } catch {
      // fall through to rule-based
    }
  }
  return fallbackSummary(parsed);
}

function fallbackSummary(parsed: ParsedSession): SessionSummary {
  const projectName = path.basename(parsed.projectPath);
  const fileCount = parsed.filesCreated.length + parsed.filesModified.length;

  return {
    summary: fileCount > 0
      ? `Session in ${projectName}: modified ${fileCount} file${fileCount !== 1 ? 's' : ''}`
      : `Session in ${projectName}: ${parsed.messagesCount} message${parsed.messagesCount !== 1 ? 's' : ''}`,
    description: [
      `Worked on ${projectName} for ${parsed.duration} minute${parsed.duration !== 1 ? 's' : ''}.`,
      parsed.filesCreated.length > 0
        ? `Created ${parsed.filesCreated.length} file${parsed.filesCreated.length !== 1 ? 's' : ''}.`
        : null,
      parsed.filesModified.length > 0
        ? `Modified ${parsed.filesModified.length} file${parsed.filesModified.length !== 1 ? 's' : ''}.`
        : null,
      parsed.tokensUsed > 0
        ? `Used ${Math.round(parsed.tokensUsed / 1000)}K tokens.`
        : null,
    ].filter(Boolean).join(' '),
    tasks: [],
    nextSteps: [],
    keyDecisions: [],
    blockers: [],
    tags: [],
  };
}

function buildMemory(
  parsed: ParsedSession,
  summary: SessionSummary,
  logPath: string,
): SessionMemory {
  const completedTasks = summary.tasks.filter(t => t.status === 'completed');
  const pendingTasks   = summary.tasks.filter(t => t.status === 'pending');

  return {
    id:                   generateId(),
    claudeSessionId:      parsed.claudeSessionId,
    projectPath:          parsed.projectPath,
    projectName:          path.basename(parsed.projectPath),
    startedAt:            parsed.startTime,
    endedAt:              parsed.endTime,
    duration:             parsed.duration,
    summary:              summary.summary,
    description:          summary.description,
    tasks:                summary.tasks,
    tasksCompleted:       completedTasks.length,
    tasksPending:         pendingTasks.length,
    filesCreated:         parsed.filesCreated,
    filesModified:        parsed.filesModified,
    filesDeleted:         parsed.filesDeleted,
    lastUserMessage:      parsed.userMessages.at(-1) ?? '',
    lastAssistantMessage: (parsed.assistantMessages.at(-1) ?? '').slice(0, 1000),
    nextSteps:            summary.nextSteps,
    keyDecisions:         summary.keyDecisions,
    blockers:             summary.blockers,
    tokensUsed:           parsed.tokensUsed,
    messagesCount:        parsed.messagesCount,
    toolCallsCount:       parsed.toolCalls.length,
    tags:                 summary.tags,   // tag appended by caller after this returns
    archived:             false,
    logFile:              logPath,
  };
}
