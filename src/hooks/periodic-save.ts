/**
 * Periodic Save Hook for cc-sessions
 *
 * Fires periodically during active sessions (default: every 5 minutes).
 * Creates checkpoint saves for session recovery.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { loadConfig } from '../config/loader';
import { parseLogFile, findAllLogFiles } from '../parser/jsonl';
import { SessionStore } from '../store/sessions';
import type { SessionMemory, ParsedSession } from '../types';

interface HookContext {
  sessionId: string;
  cwd: string;
}

// Track the current session's memory ID for updates
let currentSessionMemoryId: string | null = null;

/**
 * Generate a unique session memory ID
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `mem_${timestamp}_${random}`;
}

/**
 * Find the log file for the current session
 */
function findCurrentSessionLog(sessionId: string, cwd: string): string | null {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

  if (!fs.existsSync(claudeProjectsDir)) {
    return null;
  }

  const allLogs = findAllLogFiles();

  if (allLogs.length === 0) {
    return null;
  }

  // Sort by modification time
  const sortedLogs = allLogs
    .map(logPath => ({
      path: logPath,
      mtime: fs.statSync(logPath).mtime.getTime()
    }))
    .sort((a, b) => b.mtime - a.mtime);

  // Try to find by session ID
  const bySessionId = sortedLogs.find(log =>
    path.basename(log.path, '.jsonl').includes(sessionId)
  );
  if (bySessionId) return bySessionId.path;

  // Try to find by project path
  const encodedCwd = encodeURIComponent(cwd);
  const byCwd = sortedLogs.find(log => log.path.includes(encodedCwd));
  if (byCwd) return byCwd.path;

  // Use most recently modified if within last minute
  const mostRecent = sortedLogs[0];
  const oneMinuteAgo = Date.now() - 60 * 1000;

  if (mostRecent && mostRecent.mtime > oneMinuteAgo) {
    return mostRecent.path;
  }

  return null;
}

/**
 * Create a basic SessionMemory from parsed session
 */
function createCheckpointMemory(
  parsed: ParsedSession,
  logPath: string,
  existingId?: string
): SessionMemory {
  const projectName = path.basename(parsed.projectPath);
  const fileCount = parsed.filesCreated.length + parsed.filesModified.length;

  return {
    id: existingId || generateId(),
    claudeSessionId: parsed.claudeSessionId,
    projectPath: parsed.projectPath,
    projectName,
    startedAt: parsed.startTime,
    endedAt: new Date(), // Current time as checkpoint
    duration: parsed.duration,
    summary: fileCount > 0
      ? `[In Progress] ${projectName}: ${fileCount} file${fileCount !== 1 ? 's' : ''} modified`
      : `[In Progress] ${projectName}: ${parsed.messagesCount} messages`,
    description: `Active session checkpoint. Worked for ${parsed.duration} minutes so far.`,
    tasks: [],
    tasksCompleted: 0,
    tasksPending: 0,
    filesCreated: parsed.filesCreated,
    filesModified: parsed.filesModified,
    filesDeleted: parsed.filesDeleted,
    lastUserMessage: parsed.userMessages.at(-1) || '',
    lastAssistantMessage: parsed.assistantMessages.at(-1)?.slice(0, 500) || '',
    nextSteps: [],
    keyDecisions: [],
    blockers: [],
    tokensUsed: parsed.tokensUsed,
    messagesCount: parsed.messagesCount,
    toolCallsCount: parsed.toolCalls.length,
    tags: ['checkpoint', 'in-progress'],
    archived: false,
    logFile: logPath
  };
}

/**
 * Main hook handler
 */
export default async function periodicSaveHook(context: HookContext): Promise<void> {
  try {
    const config = await loadConfig();

    // Check if auto-save is enabled
    if (!config.autoSave.enabled) {
      return;
    }

    // Find the current session log
    const logPath = findCurrentSessionLog(context.sessionId, context.cwd);

    if (!logPath) {
      return; // No active session found
    }

    // Check if log file has been modified since last check
    const stats = fs.statSync(logPath);
    const modifiedRecently = (Date.now() - stats.mtime.getTime()) < 60 * 1000; // Within last minute

    if (!modifiedRecently) {
      return; // Session appears inactive
    }

    // Parse the current state
    const parsed = parseLogFile(logPath);

    // Skip if too few messages
    if (parsed.messagesCount < 1) {
      return;
    }

    // Create or update checkpoint
    const store = new SessionStore();

    // Check if we have an existing checkpoint for this session
    let existingMemory: SessionMemory | null = null;

    if (currentSessionMemoryId) {
      existingMemory = store.getById(currentSessionMemoryId);
    }

    // If no existing checkpoint, check by Claude session ID
    if (!existingMemory) {
      const recent = store.getRecent(5, context.cwd);
      existingMemory = recent.find(s =>
        s.claudeSessionId === parsed.claudeSessionId ||
        s.tags.includes('in-progress')
      ) || null;

      if (existingMemory) {
        currentSessionMemoryId = existingMemory.id;
      }
    }

    // Create checkpoint memory
    const checkpoint = createCheckpointMemory(
      parsed,
      logPath,
      existingMemory?.id
    );

    // Update the session memory ID for future updates
    currentSessionMemoryId = checkpoint.id;

    // Save checkpoint
    store.save(checkpoint);
    store.close();

    // Log quietly (don't spam user)
    if (process.env.CC_MEMORY_DEBUG) {
      console.log(`cc-sessions: Checkpoint saved (${parsed.messagesCount} messages, ${parsed.duration} min)`);
    }

  } catch (error) {
    // Silently fail - don't interrupt user's work
    if (process.env.CC_MEMORY_DEBUG) {
      console.error('cc-sessions: Periodic save failed:', error);
    }
  }
}

/**
 * Reset the current session tracking (for testing)
 */
export function resetSessionTracking(): void {
  currentSessionMemoryId = null;
}

// Allow running directly for testing
if (require.main === module) {
  process.env.CC_MEMORY_DEBUG = 'true';

  const testContext: HookContext = {
    sessionId: 'test-session',
    cwd: process.cwd()
  };

  periodicSaveHook(testContext).catch(console.error);
}
