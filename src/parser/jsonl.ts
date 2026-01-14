/**
 * JSONL Parser for Claude Code session logs
 *
 * Claude Code stores session logs at ~/.claude/projects/**\/*.jsonl
 * as newline-delimited JSON with entries containing message data.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RawLogEntry, ContentBlock, ToolCall, ParsedSession } from '../types';

/**
 * Parse a Claude Code JSONL log file into a structured session
 */
export function parseLogFile(logPath: string): ParsedSession {
  if (!fs.existsSync(logPath)) {
    throw new Error(`Log file not found: ${logPath}`);
  }

  const content = fs.readFileSync(logPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const entries: RawLogEntry[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as RawLogEntry;
      entries.push(parsed);
    } catch {
      // Skip malformed JSON lines
      continue;
    }
  }

  if (entries.length === 0) {
    return createEmptySession(logPath);
  }

  // Extract different message types
  const userMessages = entries.filter(e => e.type === 'human');
  const assistantMessages = entries.filter(e => e.type === 'assistant');
  const toolCalls = extractToolCalls(entries);

  // Calculate timing
  const timestamps = entries
    .map(e => e.timestamp)
    .filter(Boolean)
    .map(ts => new Date(ts).getTime())
    .filter(ts => !isNaN(ts));

  const startTime = timestamps.length > 0
    ? new Date(Math.min(...timestamps))
    : new Date();

  const endTime = timestamps.length > 0
    ? new Date(Math.max(...timestamps))
    : new Date();

  const duration = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

  // Extract files from tool calls
  const filesCreated = extractFilesFromToolCalls(toolCalls, ['Write', 'create_file']);
  const filesModified = extractFilesFromToolCalls(toolCalls, ['Edit', 'str_replace', 'str_replace_editor']);
  const filesDeleted = extractDeletedFiles(toolCalls);

  // Calculate token usage
  const tokensUsed = calculateTokenUsage(assistantMessages);

  // Get project path from entries
  const projectPath = findProjectPath(entries, logPath);
  const claudeSessionId = findSessionId(entries, logPath);

  return {
    logPath,
    startTime,
    endTime,
    duration,
    userMessages: userMessages.map(extractText),
    assistantMessages: assistantMessages.map(extractText),
    toolCalls,
    filesCreated: [...new Set(filesCreated)],
    filesModified: [...new Set(filesModified)],
    filesDeleted: [...new Set(filesDeleted)],
    tokensUsed,
    messagesCount: userMessages.length + assistantMessages.length,
    projectPath,
    claudeSessionId
  };
}

/**
 * Extract tool calls from log entries
 */
function extractToolCalls(entries: RawLogEntry[]): ToolCall[] {
  const calls: ToolCall[] = [];

  for (const entry of entries) {
    // Direct tool_use entries
    if (entry.type === 'tool_use' && entry.name) {
      calls.push({
        name: entry.name,
        input: entry.input || {},
        timestamp: entry.timestamp
      });
    }

    // Tool calls embedded in assistant message content blocks
    if (entry.type === 'assistant' && entry.message?.content) {
      const content = entry.message.content;

      if (Array.isArray(content)) {
        for (const block of content as ContentBlock[]) {
          if (block.type === 'tool_use' && block.name) {
            calls.push({
              name: block.name,
              input: block.input || {},
              timestamp: entry.timestamp
            });
          }
        }
      }
    }
  }

  return calls;
}

/**
 * Extract file paths from tool calls based on tool names
 */
function extractFilesFromToolCalls(toolCalls: ToolCall[], toolNames: string[]): string[] {
  const files: string[] = [];

  for (const call of toolCalls) {
    if (!toolNames.includes(call.name)) continue;

    // Try various input field names for file paths
    const filePath = call.input.path ||
      call.input.file_path ||
      call.input.file ||
      call.input.filename;

    if (typeof filePath === 'string') {
      files.push(filePath);
    }
  }

  return files;
}

/**
 * Extract deleted files from tool calls
 */
function extractDeletedFiles(toolCalls: ToolCall[]): string[] {
  const files: string[] = [];

  for (const call of toolCalls) {
    // Look for Bash commands that delete files
    if (call.name === 'Bash' || call.name === 'bash') {
      const command = call.input.command as string | undefined;
      if (command) {
        // Match rm commands
        const rmMatch = command.match(/rm\s+(?:-[rf]+\s+)?["']?([^\s"']+)["']?/);
        if (rmMatch && rmMatch[1]) {
          files.push(rmMatch[1]);
        }
      }
    }
  }

  return files;
}

/**
 * Extract text content from a log entry
 */
function extractText(entry: RawLogEntry): string {
  // Direct content field
  if (typeof entry.content === 'string') {
    return entry.content;
  }

  // Content in message object
  if (entry.message?.content) {
    const content = entry.message.content;

    if (typeof content === 'string') {
      return content;
    }

    // Array of content blocks
    if (Array.isArray(content)) {
      return (content as ContentBlock[])
        .filter(block => block.type === 'text')
        .map(block => block.text || '')
        .join('\n');
    }
  }

  return '';
}

/**
 * Calculate total token usage from assistant messages
 */
function calculateTokenUsage(assistantMessages: RawLogEntry[]): number {
  let total = 0;

  for (const msg of assistantMessages) {
    const usage = msg.message?.usage;
    if (usage) {
      total += (usage.input_tokens || 0) + (usage.output_tokens || 0);
    }
  }

  return total;
}

/**
 * Find the project path from log entries
 */
function findProjectPath(entries: RawLogEntry[], logPath: string): string {
  // Try to find cwd from entries
  for (const entry of entries) {
    if (entry.cwd) {
      return entry.cwd;
    }
  }

  // Fall back to extracting from log path
  // Log paths are like: ~/.claude/projects/<encoded-path>/<session>.jsonl
  const parts = logPath.split(path.sep);
  const projectsIndex = parts.findIndex(p => p === 'projects');

  if (projectsIndex !== -1 && parts[projectsIndex + 1]) {
    // Decode the project path (it's URL-encoded)
    try {
      return decodeURIComponent(parts[projectsIndex + 1]);
    } catch {
      return parts[projectsIndex + 1];
    }
  }

  return path.dirname(logPath);
}

/**
 * Find the session ID from log entries
 */
function findSessionId(entries: RawLogEntry[], logPath: string): string {
  // Try to find sessionId from entries
  for (const entry of entries) {
    if (entry.sessionId) {
      return entry.sessionId;
    }
  }

  // Fall back to filename without extension
  return path.basename(logPath, '.jsonl');
}

/**
 * Create an empty session for when parsing fails
 */
function createEmptySession(logPath: string): ParsedSession {
  return {
    logPath,
    startTime: new Date(),
    endTime: new Date(),
    duration: 0,
    userMessages: [],
    assistantMessages: [],
    toolCalls: [],
    filesCreated: [],
    filesModified: [],
    filesDeleted: [],
    tokensUsed: 0,
    messagesCount: 0,
    projectPath: path.dirname(logPath),
    claudeSessionId: path.basename(logPath, '.jsonl')
  };
}

/**
 * Find the most recent JSONL log file for a project
 */
export function findLatestLogFile(projectPath: string): string | null {
  const claudeProjectsDir = path.join(process.env.HOME || '', '.claude', 'projects');

  if (!fs.existsSync(claudeProjectsDir)) {
    return null;
  }

  // Encode project path as Claude does
  const encodedPath = encodeURIComponent(projectPath);

  // Look for project directory
  const projectDir = path.join(claudeProjectsDir, encodedPath);

  if (!fs.existsSync(projectDir)) {
    // Try to find by partial match
    const dirs = fs.readdirSync(claudeProjectsDir);
    const matching = dirs.find(d =>
      decodeURIComponent(d).includes(path.basename(projectPath))
    );

    if (!matching) return null;

    const matchingDir = path.join(claudeProjectsDir, matching);

    return findNewestJsonl(matchingDir);
  }

  return findNewestJsonl(projectDir);
}

/**
 * Find the newest JSONL file in a directory
 */
function findNewestJsonl(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      path: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtime
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return files[0]?.path || null;
}

/**
 * Find all JSONL log files across all projects
 */
export function findAllLogFiles(): string[] {
  const claudeProjectsDir = path.join(process.env.HOME || '', '.claude', 'projects');

  if (!fs.existsSync(claudeProjectsDir)) {
    return [];
  }

  const files: string[] = [];

  const projectDirs = fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(claudeProjectsDir, d.name));

  for (const projectDir of projectDirs) {
    const jsonlFiles = fs.readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(projectDir, f));

    files.push(...jsonlFiles);
  }

  return files;
}
