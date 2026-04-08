#!/usr/bin/env node
/**
 * CC-Sessions CLI
 * Command-line interface for session memory management
 */

import { Command } from 'commander';
import * as path from 'path';
import * as http from 'http';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json') as { version: string };
import { SessionStore } from './store/sessions';
import { loadConfig, getConfigFile } from './config/loader';
import { RETENTION_OPTIONS, SUMMARY_MODELS } from './config/defaults';
import { createServer } from './server/index';
import { importFromGlobalStore } from './importer/index';
import notificationHook from './hooks/notification';
import { saveSnapshot } from './hooks/snapshot';
import { findCurrentSessionLog } from './hooks/utils';
import type { SessionMemory, Config } from './types';

const program = new Command();

program
  .name('cc-sessions')
  .description('Smart session memory for Claude Code')
  .version(version);

/**
 * Format duration in human readable format
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Format relative time
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Truncate string to max length
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Show command - display last session for current project
 */
program
  .command('show')
  .description('Show the last session for current project')
  .option('-p, --project <path>', 'Project path (default: current directory)')
  .action(async (options) => {
    const store = new SessionStore();
    const projectPath = options.project || process.cwd();

    const session = store.getLastForProject(projectPath);

    if (!session) {
      // Try to get recent sessions from other projects
      const recent = store.getRecent(3);
      if (recent.length > 0) {
        console.log('No session memory found for this project.\n');
        console.log('Recent sessions from other projects:');
        for (const s of recent) {
          console.log(`- ${s.projectName}: ${s.summary || 'No summary'} (${formatRelativeTime(s.startedAt)})`);
        }
        console.log('\nUse /sessions:list to browse all sessions.');
      } else {
        console.log('No session memories found.\n');
        console.log('Sessions are automatically saved when you end a Claude Code session.');
        console.log('Start working on a project and your context will be preserved.\n');
        console.log('Configure settings with /sessions:settings');
      }
      store.close();
      return;
    }

    printSessionDetail(session);
    store.close();
  });

/**
 * List command - list all sessions
 */
program
  .command('list')
  .description('List all saved sessions')
  .option('-p, --project <path>', 'Filter by project path')
  .option('-l, --limit <number>', 'Number of sessions to show', '10')
  .option('-a, --all', 'Include archived sessions')
  .action(async (options) => {
    const store = new SessionStore();
    const limit = parseInt(options.limit, 10);

    let sessions: SessionMemory[];
    if (options.all) {
      sessions = store.getAll(true).slice(0, limit);
    } else if (options.project) {
      sessions = store.getRecent(limit, options.project);
    } else {
      sessions = store.getRecent(limit);
    }

    const stats = store.getStats();

    if (sessions.length === 0) {
      console.log('No session memories found.\n');
      console.log('Sessions are automatically saved when you:');
      console.log('- End a Claude Code session');
      console.log('- Close the terminal');
      console.log('- Work for more than 5 minutes (auto-checkpoint)\n');
      console.log('Start working on a project and your context will be preserved!');
      store.close();
      return;
    }

    console.log('Session Memories\n');
    console.log(`Showing ${sessions.length} of ${stats.totalSessions} sessions\n`);

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      console.log(`${i + 1}. ${truncate(s.summary || 'No summary', 60)}`);
      console.log(`   Project: ${s.projectName}`);
      console.log(`   ${formatRelativeTime(s.startedAt)} - ${formatDuration(s.duration)} - ${s.tokensUsed.toLocaleString()} tokens`);
      console.log(`   ID: ${s.id}`);
      if (i < sessions.length - 1) console.log('');
    }

    console.log('\n---');
    console.log('Commands:');
    console.log('- /sessions:resume <id> - Resume a session');
    console.log('- /sessions:export <id> - Export session to markdown');
    console.log('- /sessions:search <query> - Search sessions');
    console.log(`\nStorage: ${formatBytes(stats.storageUsedBytes)} used - ${stats.totalSessions} sessions`);

    store.close();
  });

/**
 * Search command - full-text search
 */
program
  .command('search <query>')
  .description('Search across all sessions')
  .option('-p, --project <path>', 'Limit to specific project')
  .option('-l, --limit <number>', 'Max results', '10')
  .action(async (query, options) => {
    const store = new SessionStore();
    const limit = parseInt(options.limit, 10);

    const results = store.search(query, limit);

    if (results.length === 0) {
      console.log(`Search: "${query}"\n`);
      console.log('No sessions found matching your search.\n');
      console.log('Suggestions:');
      console.log('- Try broader search terms');
      console.log('- Check spelling');
      console.log('- Use /sessions:list to browse all sessions');
      store.close();
      return;
    }

    console.log(`Search: "${query}"`);
    console.log(`Found ${results.length} sessions:\n`);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      console.log(`${i + 1}. ${truncate(r.session.summary || 'No summary', 60)}`);
      console.log(`   ${formatRelativeTime(r.session.startedAt)} - ${formatDuration(r.session.duration)} - ${r.session.projectName}`);
      if (r.matches.length > 0) {
        const match = r.matches[0];
        console.log(`   "${truncate(match.text, 70)}"`);
      }
      console.log(`   ID: ${r.session.id}`);
      if (i < results.length - 1) console.log('');
    }

    console.log('\nUse /sessions:resume <id> to resume a session.');
    store.close();
  });

/**
 * Resume command - get session context for resumption
 */
program
  .command('resume [sessionId]')
  .description('Get session context for resumption')
  .action(async (sessionId) => {
    const store = new SessionStore();

    let session: SessionMemory | null;

    if (sessionId) {
      session = store.getById(sessionId);
      if (!session) {
        console.log(`Session not found: ${sessionId}\n`);
        console.log('The session ID may be incorrect or the session may have been deleted.\n');
        console.log('Use /sessions:list to see available sessions.');
        store.close();
        return;
      }
    } else {
      session = store.getLastForProject(process.cwd());
      if (!session) {
        console.log('No session found to resume.\n');
        console.log('To resume a specific session:');
        console.log('1. Use /sessions:list to see all sessions');
        console.log('2. Note the session ID');
        console.log('3. Run /sessions:resume <session_id>\n');
        console.log('Or use /sessions:search to find a specific session.');
        store.close();
        return;
      }
    }

    // Output context in a format that can be consumed by Claude
    console.log('---CONTEXT_START---');
    console.log(JSON.stringify({
      id: session.id,
      projectPath: session.projectPath,
      projectName: session.projectName,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      duration: session.duration,
      summary: session.summary,
      description: session.description,
      tasks: session.tasks,
      tasksCompleted: session.tasksCompleted,
      tasksPending: session.tasksPending,
      filesCreated: session.filesCreated,
      filesModified: session.filesModified,
      filesDeleted: session.filesDeleted,
      lastUserMessage: session.lastUserMessage,
      lastAssistantMessage: session.lastAssistantMessage,
      nextSteps: session.nextSteps,
      keyDecisions: session.keyDecisions,
      blockers: session.blockers,
      tags: session.tags
    }, null, 2));
    console.log('---CONTEXT_END---');

    store.close();
  });

/**
 * Export command - export session to file
 */
program
  .command('export [sessionId]')
  .description('Export session to markdown or JSON')
  .option('-f, --format <format>', 'Output format: md or json', 'md')
  .option('-o, --output <path>', 'Output file path')
  .action(async (sessionId, options) => {
    const store = new SessionStore();

    let session: SessionMemory | null;

    if (sessionId) {
      session = store.getById(sessionId);
    } else {
      session = store.getLastForProject(process.cwd());
    }

    if (!session) {
      console.log(`Session not found: ${sessionId || 'last session'}\n`);
      console.log('Use /sessions:list to see available sessions.');
      store.close();
      return;
    }

    let content: string;

    if (options.format === 'json') {
      content = JSON.stringify({
        id: session.id,
        projectPath: session.projectPath,
        projectName: session.projectName,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        duration: session.duration,
        summary: session.summary,
        description: session.description,
        tasks: session.tasks,
        filesCreated: session.filesCreated,
        filesModified: session.filesModified,
        tokensUsed: session.tokensUsed,
        tags: session.tags
      }, null, 2);
    } else {
      content = generateMarkdown(session);
    }

    if (options.output) {
      const fs = await import('fs');
      const outputPath = path.resolve(options.output);
      fs.writeFileSync(outputPath, content, 'utf-8');
      console.log('Session exported successfully!\n');
      console.log(`File: ${outputPath}`);
      console.log(`Format: ${options.format}`);
      console.log(`\nSession: ${session.summary || 'No summary'}`);
      console.log(`From: ${session.startedAt.toLocaleDateString()}`);
    } else {
      console.log(content);
    }

    store.close();
  });

/**
 * Settings command - show current configuration
 */
program
  .command('settings')
  .description('Show current configuration')
  .action(async () => {
    const config = await loadConfig();
    const store = new SessionStore();
    const stats = store.getStats();

    console.log('SESSION MEMORY SETTINGS\n');

    console.log('RETENTION');
    console.log(`  Full sessions:    ${config.retention.fullSessions}`);
    console.log(`  Archives:         ${config.retention.archives}`);
    console.log(`  Max storage:      ${config.retention.maxStorageGb} GB\n`);

    console.log('AUTO-SAVE');
    console.log(`  [${config.autoSave.enabled ? 'x' : ' '}] Auto-save sessions on exit`);
    console.log(`  [${config.autoSave.generateSummary ? 'x' : ' '}] Generate AI summaries`);
    console.log(`  [${config.autoSave.extractTasks ? 'x' : ' '}] Extract tasks automatically\n`);

    console.log('AI SUMMARIES');
    const model = SUMMARY_MODELS[config.summaries.model];
    console.log(`  Model: ${config.summaries.model}`);
    console.log(`         ${model.description}\n`);

    console.log('STORAGE STATUS');
    console.log(`  Sessions saved:    ${stats.totalSessions}`);
    console.log(`  Storage used:      ${formatBytes(stats.storageUsedBytes)} / ${config.retention.maxStorageGb} GB\n`);

    console.log(`Config file: ${getConfigFile()}`);

    store.close();
  });

/**
 * Generate markdown export
 */
function generateMarkdown(session: SessionMemory): string {
  const lines: string[] = [];

  lines.push(`# Session: ${session.summary || 'Untitled Session'}`);
  lines.push('');
  lines.push(`**Project:** ${session.projectPath}`);
  lines.push(`**Date:** ${session.startedAt.toLocaleString()}`);
  lines.push(`**Duration:** ${formatDuration(session.duration)}`);
  lines.push(`**Tokens Used:** ${session.tokensUsed.toLocaleString()}`);
  lines.push('');

  if (session.description) {
    lines.push('## Summary');
    lines.push('');
    lines.push(session.description);
    lines.push('');
  }

  if (session.tasks.length > 0) {
    lines.push('## Tasks');
    lines.push('');

    const completed = session.tasks.filter(t => t.status === 'completed');
    const pending = session.tasks.filter(t => t.status !== 'completed');

    if (completed.length > 0) {
      lines.push('### Completed');
      for (const t of completed) {
        lines.push(`- [x] ${t.description}`);
      }
      lines.push('');
    }

    if (pending.length > 0) {
      lines.push('### Pending');
      for (const t of pending) {
        lines.push(`- [ ] ${t.description}`);
      }
      lines.push('');
    }
  }

  if (session.filesCreated.length > 0 || session.filesModified.length > 0) {
    lines.push('## Files Modified');
    lines.push('');

    if (session.filesCreated.length > 0) {
      lines.push('### Created');
      for (const f of session.filesCreated) {
        lines.push(`- \`${f}\``);
      }
      lines.push('');
    }

    if (session.filesModified.length > 0) {
      lines.push('### Modified');
      for (const f of session.filesModified) {
        lines.push(`- \`${f}\``);
      }
      lines.push('');
    }
  }

  if (session.keyDecisions.length > 0) {
    lines.push('## Key Decisions');
    lines.push('');
    for (const d of session.keyDecisions) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  if (session.nextSteps.length > 0) {
    lines.push('## Suggested Next Steps');
    lines.push('');
    for (let i = 0; i < session.nextSteps.length; i++) {
      lines.push(`${i + 1}. ${session.nextSteps[i]}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`*Exported from cc-sessions on ${new Date().toLocaleString()}*`);
  lines.push(`*Session ID: ${session.id}*`);

  return lines.join('\n');
}

/**
 * Print detailed session info
 */
function printSessionDetail(session: SessionMemory): void {
  console.log('LAST SESSION\n');
  console.log(`  Project:   ${session.projectName}`);
  console.log(`  When:      ${formatRelativeTime(session.startedAt)} (${formatDuration(session.duration)})`);
  console.log(`  Tokens:    ${session.tokensUsed.toLocaleString()}\n`);

  if (session.summary) {
    console.log('SUMMARY');
    console.log(`  ${session.summary}\n`);
  }

  if (session.description) {
    console.log('DESCRIPTION');
    const lines = session.description.split('\n');
    for (const line of lines.slice(0, 5)) {
      console.log(`  ${line}`);
    }
    if (lines.length > 5) console.log('  ...');
    console.log('');
  }

  const completed = session.tasks.filter(t => t.status === 'completed');
  const pending = session.tasks.filter(t => t.status !== 'completed');

  if (completed.length > 0) {
    console.log('COMPLETED');
    for (const t of completed.slice(0, 5)) {
      console.log(`  - ${t.description}`);
    }
    if (completed.length > 5) console.log(`  ... and ${completed.length - 5} more`);
    console.log('');
  }

  if (pending.length > 0) {
    console.log('PENDING');
    for (const t of pending.slice(0, 5)) {
      console.log(`  - ${t.description}`);
    }
    if (pending.length > 5) console.log(`  ... and ${pending.length - 5} more`);
    console.log('');
  }

  const allFiles = [...session.filesCreated, ...session.filesModified];
  if (allFiles.length > 0) {
    console.log('FILES MODIFIED');
    for (const f of session.filesCreated.slice(0, 3)) {
      console.log(`  - ${f} (created)`);
    }
    for (const f of session.filesModified.slice(0, 3)) {
      console.log(`  - ${f} (modified)`);
    }
    const total = allFiles.length;
    if (total > 6) console.log(`  ... and ${total - 6} more`);
    console.log('');
  }

  if (session.nextSteps.length > 0) {
    console.log('SUGGESTED NEXT STEPS');
    for (let i = 0; i < Math.min(session.nextSteps.length, 3); i++) {
      console.log(`  ${i + 1}. ${session.nextSteps[i]}`);
    }
    console.log('');
  }

  console.log('---');
  console.log(`[/sessions:resume] Resume    [/sessions:search] Search`);
  console.log(`Session ID: ${session.id}`);
}

/**
 * UI command - start the web UI server
 */
program
  .command('ui')
  .description('Open the session browser UI in your web browser')
  .option('-p, --port <number>', 'Port to listen on', '3456')
  .option('--no-open', 'Print the URL but do not open the browser automatically')
  .action(async (options: { port: string; open: boolean }) => {
    const port = parseInt(options.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error('Invalid port: ' + options.port + '. Must be a number between 1 and 65535.');
      process.exit(1);
    }

    const store = new SessionStore();
    const { server } = createServer(store);

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error('Port ' + port + ' is already in use. Try: cc-sessions ui --port 3457');
      } else {
        console.error('Server error: ' + err.message);
      }
      store.close();
      process.exit(1);
    });

    server.listen(port, '127.0.0.1', async () => {
      const uiUrl = 'http://127.0.0.1:' + port;
      console.log('CC Sessions UI running at ' + uiUrl);
      console.log('Press Ctrl+C to stop.\n');

      if (options.open) {
        try {
          const { default: childProcess } = await import('child_process');
          const platform = process.platform;
          if (platform === 'darwin') {
            childProcess.spawn('open', [uiUrl], { detached: true, stdio: 'ignore' });
          } else if (platform === 'win32') {
            childProcess.spawn('cmd', ['/c', 'start', uiUrl], { detached: true, stdio: 'ignore' });
          } else {
            childProcess.spawn('xdg-open', [uiUrl], { detached: true, stdio: 'ignore' });
          }
        } catch {
          // Browser open is best-effort — the URL is already printed above
        }
      }
    });

    process.on('SIGINT', () => {
      server.close(() => {
        store.close();
        process.exit(0);
      });
    });
    process.on('SIGTERM', () => {
      server.close(() => {
        store.close();
        process.exit(0);
      });
    });
  });

/**
 * Import command - import Claude Code CLI sessions from the global store
 */
program
  .command('import')
  .description('Import Claude Code CLI sessions from ~/.claude/projects/ into the database')
  .option('-p, --project <path>', 'Only import sessions for a specific project path')
  .option('--dry-run', 'Preview sessions that would be imported without saving them')
  .option('--no-ai', 'Skip AI summary generation; use rule-based summaries instead')
  .option('--since <date>', 'Only import sessions that started on or after this date (ISO 8601 or YYYY-MM-DD)')
  .option('-l, --limit <number>', 'Maximum number of sessions to import', '100')
  .action(async (options: {
    project?: string;
    dryRun?: boolean;
    ai: boolean;
    since?: string;
    limit: string;
  }) => {
    const config = await loadConfig();
    const store = new SessionStore();

    const limit = parseInt(options.limit, 10);
    if (isNaN(limit) || limit < 1) {
      console.error('Invalid limit: must be a positive integer.');
      process.exit(1);
    }

    let since: Date | undefined;
    if (options.since) {
      since = new Date(options.since);
      if (isNaN(since.getTime())) {
        console.error(`Invalid date: "${options.since}". Use ISO 8601 format, e.g. 2024-01-15`);
        process.exit(1);
      }
    }

    const skipAI = !options.ai;

    if (options.dryRun) {
      console.log('DRY RUN — no sessions will be saved.\n');
    }

    console.log('Scanning ~/.claude/projects/ for sessions...\n');

    let lastPercent = -1;

    const result = await importFromGlobalStore(store, config, {
      projectPath: options.project,
      dryRun: options.dryRun,
      since,
      limit,
      skipAI,
      onProgress: (current, total, logPath) => {
        const percent = Math.floor((current / total) * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          process.stdout.write(
            `\r  [${percent.toString().padStart(3)}%] ${current}/${total} — ${path.basename(logPath)}`
          );
        }
      },
    });

    // Clear progress line
    process.stdout.write('\r' + ' '.repeat(80) + '\r');

    if (options.dryRun) {
      console.log(`Found ${result.sessions.length + result.skipped + result.failed} session(s):`);
      console.log(`  ${result.sessions.length} would be imported`);
      console.log(`  ${result.skipped} already in database (would be skipped)`);
      if (result.failed > 0) {
        console.log(`  ${result.failed} would fail`);
      }

      if (result.sessions.length > 0) {
        console.log('\nSessions that would be imported:');
        for (const s of result.sessions.slice(0, 10)) {
          const when = formatRelativeTime(s.startedAt);
          console.log(`  - ${s.projectName}: ${s.summary} (${when})`);
        }
        if (result.sessions.length > 10) {
          console.log(`  ... and ${result.sessions.length - 10} more`);
        }
      }
    } else {
      const total = result.imported + result.skipped + result.failed;
      console.log(`Processed ${total} session(s):`);
      console.log(`  ${result.imported} imported`);
      console.log(`  ${result.skipped} already in database (skipped)`);
      if (result.failed > 0) {
        console.log(`  ${result.failed} failed`);
        for (const err of result.errors.slice(0, 5)) {
          console.log(`    - ${err}`);
        }
      }

      if (result.imported > 0) {
        console.log('\nRecently imported:');
        for (const s of result.sessions.slice(0, 5)) {
          console.log(`  - ${s.projectName}: ${s.summary}`);
        }
      }

      if (result.imported === 0 && result.skipped === 0) {
        console.log('\nNo Claude Code sessions found in ~/.claude/projects/');
        console.log('Sessions are created when you use Claude Code in a project.');
      }
    }

    store.close();
  });

/**
 * Notify command — internal hook entry point (cc-sessions notify)
 * Reads a Notification JSON payload from stdin and snapshots the session
 * if compaction is detected. Always exits 0. Not intended for direct user use.
 */
program
  .command('notify')
  .description('Internal: handle a Claude Code Notification hook event (reads JSON from stdin)')
  .action(async () => {
    await notificationHook();
  });

/**
 * Save command — snapshot the current session before /clear
 *
 * Usage:
 *   cc-sessions save                    # most recently modified JSONL
 *   cc-sessions save <claude-session-id> # specific session by ID
 */
program
  .command('save [claudeSessionId]')
  .description('Snapshot the current session (run before /clear to preserve context)')
  .action(async (claudeSessionId?: string) => {
    const config = await loadConfig();
    const store  = new SessionStore();

    try {
      const logPath = findCurrentSessionLog(claudeSessionId ?? '', process.cwd());

      if (!logPath) {
        console.error('⚠️  No session log found — run this command from your project directory');
        process.exit(1);
      }

      await saveSnapshot(logPath, store, config, 'snapshot');

      // Read back the saved session to display its claudeSessionId
      const sessions = store.getRecent(1);
      const savedId  = sessions[0]?.claudeSessionId ?? path.basename(logPath, '.jsonl');
      console.log(`✅ Session saved: ${savedId} (pre-clear snapshot)`);
    } catch (err) {
      console.error(`❌ Save failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    } finally {
      store.close();
    }
  });

program.parse();
