/**
 * Session Start Hook for cc-sessions
 *
 * Fires when a new Claude Code session starts.
 * Shows the last session summary for context restoration.
 */

import * as path from 'path';
import { loadConfig } from '../config/loader';
import { SessionStore } from '../store/sessions';
import type { SessionMemory } from '../types';

interface HookContext {
  sessionId: string;
  cwd: string;
}

/**
 * Format a date relative to now
 */
function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) !== 1 ? 's' : ''} ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

/**
 * Format duration in minutes to human-readable string
 */
function formatDuration(minutes: number): string {
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Format token count
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

/**
 * Display session summary in a formatted box
 */
function displaySessionSummary(session: SessionMemory): void {
  const width = 65;
  const hr = '─'.repeat(width);

  console.log(`\n┌${hr}┐`);
  console.log(`│${'  📍 LAST SESSION'.padEnd(width)}│`);
  console.log(`├${hr}┤`);

  // Project and timing info
  console.log(`│  Project:   ${session.projectName.slice(0, 45).padEnd(width - 13)}│`);
  console.log(`│  When:      ${formatRelativeDate(session.startedAt)} (${formatDuration(session.duration)})`.padEnd(width + 1) + '│');
  console.log(`│  Tokens:    ${formatTokens(session.tokensUsed)}`.padEnd(width + 1) + '│');

  console.log(`├${hr}┤`);

  // Summary
  if (session.summary) {
    console.log(`│${'  🎯 SUMMARY'.padEnd(width)}│`);
    const summaryLines = wrapText(session.summary, width - 4);
    for (const line of summaryLines) {
      console.log(`│  ${line.padEnd(width - 2)}│`);
    }
    console.log(`│${''.padEnd(width)}│`);
  }

  // Completed tasks
  const completedTasks = session.tasks.filter(t => t.status === 'completed');
  if (completedTasks.length > 0) {
    console.log(`│${'  ✅ COMPLETED'.padEnd(width)}│`);
    for (const task of completedTasks.slice(0, 3)) {
      console.log(`│  • ${task.description.slice(0, width - 6).padEnd(width - 4)}│`);
    }
    if (completedTasks.length > 3) {
      console.log(`│  ... and ${completedTasks.length - 3} more`.padEnd(width + 1) + '│');
    }
    console.log(`│${''.padEnd(width)}│`);
  }

  // Pending tasks
  const pendingTasks = session.tasks.filter(t => t.status === 'pending');
  if (pendingTasks.length > 0) {
    console.log(`│${'  ⏳ PENDING'.padEnd(width)}│`);
    for (const task of pendingTasks.slice(0, 3)) {
      console.log(`│  • ${task.description.slice(0, width - 6).padEnd(width - 4)}│`);
    }
    if (pendingTasks.length > 3) {
      console.log(`│  ... and ${pendingTasks.length - 3} more`.padEnd(width + 1) + '│');
    }
    console.log(`│${''.padEnd(width)}│`);
  }

  // Files modified
  const allFiles = [...session.filesCreated, ...session.filesModified];
  if (allFiles.length > 0) {
    console.log(`│${'  📁 FILES MODIFIED'.padEnd(width)}│`);
    for (const file of allFiles.slice(0, 3)) {
      const fileName = path.basename(file);
      const isCreated = session.filesCreated.includes(file);
      const suffix = isCreated ? ' (created)' : '';
      console.log(`│  • ${(fileName + suffix).slice(0, width - 6).padEnd(width - 4)}│`);
    }
    if (allFiles.length > 3) {
      console.log(`│  ... and ${allFiles.length - 3} more`.padEnd(width + 1) + '│');
    }
    console.log(`│${''.padEnd(width)}│`);
  }

  // Next steps
  if (session.nextSteps.length > 0) {
    console.log(`│${'  💡 SUGGESTED NEXT STEPS'.padEnd(width)}│`);
    for (let i = 0; i < Math.min(3, session.nextSteps.length); i++) {
      console.log(`│  ${i + 1}. ${session.nextSteps[i].slice(0, width - 7).padEnd(width - 5)}│`);
    }
    console.log(`│${''.padEnd(width)}│`);
  }

  console.log(`├${hr}┤`);
  console.log(`│  [/memory:resume] Resume    [/memory:search] Search    `.padEnd(width + 1) + '│');
  console.log(`└${hr}┘\n`);
}

/**
 * Wrap text to fit within a given width
 */
function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxWidth) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word.slice(0, maxWidth);
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Main hook handler
 */
export default async function sessionStartHook(context: HookContext): Promise<void> {
  try {
    const config = await loadConfig();

    // Check if showing on start is enabled
    if (!config.ui.showOnStart) {
      return;
    }

    const store = new SessionStore();

    // Find last session for this project
    const lastSession = store.getLastForProject(context.cwd);

    if (lastSession) {
      displaySessionSummary(lastSession);
    }

    store.close();

  } catch (error) {
    // Silently fail - don't interrupt user's session
    console.error('cc-sessions: Failed to load session context:', error);
  }
}

// Allow running directly for testing
if (require.main === module) {
  const testContext: HookContext = {
    sessionId: 'test-session',
    cwd: process.cwd()
  };

  sessionStartHook(testContext).catch(console.error);
}
