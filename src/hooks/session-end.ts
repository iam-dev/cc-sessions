/**
 * Session End Hook for cc-sessions
 *
 * Fires when a Claude Code session ends.
 * Parses the session log and saves a structured memory.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { loadConfig } from '../config/loader';
import { parseLogFile, findAllLogFiles } from '../parser/jsonl';
import { generateSummary } from '../parser/summarizer';
import { SessionStore } from '../store/sessions';
import type { SessionMemory, ParsedSession, SessionSummary } from '../types';

interface HookContext {
  sessionId: string;
  cwd: string;
}

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

  // Get all log files
  const allLogs = findAllLogFiles();

  if (allLogs.length === 0) {
    return null;
  }

  // Sort by modification time (most recent first)
  const sortedLogs = allLogs
    .map(logPath => ({
      path: logPath,
      mtime: fs.statSync(logPath).mtime.getTime()
    }))
    .sort((a, b) => b.mtime - a.mtime);

  // First, try to find by session ID in the filename
  const bySessionId = sortedLogs.find(log =>
    path.basename(log.path, '.jsonl').includes(sessionId)
  );
  if (bySessionId) {
    return bySessionId.path;
  }

  // Next, try to find by project path
  const encodedCwd = encodeURIComponent(cwd);
  const byCwd = sortedLogs.find(log => log.path.includes(encodedCwd));
  if (byCwd) {
    return byCwd.path;
  }

  // Fall back to most recently modified log file
  // Only if it was modified within the last 5 minutes (likely current session)
  const mostRecent = sortedLogs[0];
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

  if (mostRecent && mostRecent.mtime > fiveMinutesAgo) {
    return mostRecent.path;
  }

  return null;
}

/**
 * Create a SessionMemory from parsed session and summary
 */
function createSessionMemory(
  parsed: ParsedSession,
  summary: SessionSummary,
  logPath: string
): SessionMemory {
  const completedTasks = summary.tasks.filter(t => t.status === 'completed');
  const pendingTasks = summary.tasks.filter(t => t.status === 'pending');

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
    lastUserMessage: parsed.userMessages.at(-1) || '',
    lastAssistantMessage: parsed.assistantMessages.at(-1)?.slice(0, 1000) || '',
    nextSteps: summary.nextSteps,
    keyDecisions: summary.keyDecisions,
    blockers: summary.blockers,
    tokensUsed: parsed.tokensUsed,
    messagesCount: parsed.messagesCount,
    toolCallsCount: parsed.toolCalls.length,
    tags: summary.tags,
    archived: false,
    logFile: logPath
  };
}

/**
 * Main hook handler
 */
export default async function sessionEndHook(context: HookContext): Promise<void> {
  try {
    const config = await loadConfig();

    // Check if auto-save is enabled
    if (!config.autoSave.enabled || !config.autoSave.onSessionEnd) {
      return;
    }

    // Find the session log file
    const logPath = findCurrentSessionLog(context.sessionId, context.cwd);

    if (!logPath) {
      console.log('cc-sessions: No session log found to save');
      return;
    }

    // Parse the log file
    const parsed = parseLogFile(logPath);

    // Skip if session is too short (less than 1 message)
    if (parsed.messagesCount < 1) {
      return;
    }

    // Generate AI summary if enabled
    let summary: SessionSummary;

    if (config.autoSave.generateSummary) {
      try {
        summary = await generateSummary(parsed, config.summaries);
      } catch (error) {
        console.error('cc-sessions: Failed to generate AI summary, using fallback:', error);
        summary = createFallbackSummary(parsed);
      }
    } else {
      summary = createFallbackSummary(parsed);
    }

    // Create session memory
    const sessionMemory = createSessionMemory(parsed, summary, logPath);

    // Save to store
    const store = new SessionStore();
    store.save(sessionMemory);

    console.log(`✅ cc-sessions: Session saved - ${sessionMemory.summary}`);

    // Trigger cloud sync if enabled
    if (config.cloud.enabled && config.cloud.syncOnSave) {
      try {
        const { CloudSync } = await import('../sync/cloud');
        const cloudSync = new CloudSync(config.cloud);
        await cloudSync.uploadSession(sessionMemory);
        store.markSynced(sessionMemory.id);
        console.log('☁️  cc-sessions: Session synced to cloud');
      } catch (error) {
        // Don't fail the session end if cloud sync fails
        if (process.env.CC_MEMORY_DEBUG) {
          console.error('cc-sessions: Cloud sync failed:', error);
        }
      }
    }

    store.close();

  } catch (error) {
    // Log error but don't interrupt session end
    console.error('cc-sessions: Failed to save session:', error);
  }
}

/**
 * Create a fallback summary when AI summary fails
 */
function createFallbackSummary(parsed: ParsedSession): SessionSummary {
  const projectName = path.basename(parsed.projectPath);
  const fileCount = parsed.filesCreated.length + parsed.filesModified.length;

  return {
    summary: fileCount > 0
      ? `Session in ${projectName}: modified ${fileCount} file${fileCount !== 1 ? 's' : ''}`
      : `Session in ${projectName}: ${parsed.messagesCount} messages`,
    description: `Worked on ${projectName} for ${parsed.duration} minutes. ${
      parsed.tokensUsed > 0 ? `Used ${Math.round(parsed.tokensUsed / 1000)}K tokens.` : ''
    }`,
    tasks: [],
    nextSteps: [],
    keyDecisions: [],
    blockers: [],
    tags: []
  };
}

// Allow running directly for testing
if (require.main === module) {
  const testContext: HookContext = {
    sessionId: 'test-session',
    cwd: process.cwd()
  };

  sessionEndHook(testContext).catch(console.error);
}
