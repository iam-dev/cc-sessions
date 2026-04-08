/**
 * Rule-based session summary provider.
 *
 * Always returns a result. Appends 'no-ai-summary' tag so cc-sessions summarize
 * can target these sessions for AI regeneration later.
 */

import * as path from 'path';
import { extractTasks, extractKeyDecisions, extractBlockers, extractNextSteps, extractTags } from '../extractor';
import type { ParsedSession, SessionSummary } from '../../types';

export function ruleBasedSummary(parsed: ParsedSession): SessionSummary {
  const projectName = path.basename(parsed.projectPath);
  const allFiles = [...parsed.filesCreated, ...parsed.filesModified];
  const fileCount = allFiles.length;
  const firstUserMsg = parsed.userMessages[0] ?? '';

  const tasks       = extractTasks(parsed.userMessages, parsed.assistantMessages);
  const keyDecisions = extractKeyDecisions(parsed.assistantMessages);
  const blockers    = extractBlockers(parsed.userMessages, parsed.assistantMessages);
  const nextSteps   = extractNextSteps(parsed.assistantMessages);
  const techTags    = extractTags(parsed.userMessages, parsed.assistantMessages, allFiles);

  const summary = buildSummary(projectName, firstUserMsg, fileCount, allFiles);
  const description = buildDescription(projectName, firstUserMsg, parsed, allFiles);

  return {
    summary,
    description,
    tasks,
    nextSteps,
    keyDecisions,
    blockers,
    tags: [...techTags, 'no-ai-summary'],
  };
}

// ─── private helpers ──────────────────────────────────────────────────────────

function buildSummary(
  projectName: string,
  firstUserMsg: string,
  fileCount: number,
  files: string[],
): string {
  if (firstUserMsg && fileCount > 0) {
    const intent = firstUserMsg.slice(0, 60).replace(/\n.*/s, '');
    const fileNames = files.slice(0, 3).map(f => path.basename(f)).join(', ');
    return `[${projectName}] ${intent} — edited ${fileNames}${files.length > 3 ? ` (+${files.length - 3} more)` : ''}`;
  }
  if (firstUserMsg) {
    return firstUserMsg.slice(0, 80).replace(/\n.*/s, '');
  }
  if (fileCount > 0) {
    return `Session in ${projectName}: modified ${fileCount} file${fileCount !== 1 ? 's' : ''}`;
  }
  return `Session in ${projectName}`;
}

function buildDescription(
  projectName: string,
  firstUserMsg: string,
  parsed: ParsedSession,
  files: string[],
): string {
  const parts: string[] = [];

  if (firstUserMsg) {
    parts.push(`User asked: "${firstUserMsg.slice(0, 120).replace(/\n.*/s, '')}".`);
  }

  if (parsed.filesCreated.length > 0) {
    parts.push(`Created: ${parsed.filesCreated.map(f => path.basename(f)).slice(0, 4).join(', ')}.`);
  }
  if (parsed.filesModified.length > 0) {
    parts.push(`Edited: ${parsed.filesModified.map(f => path.basename(f)).slice(0, 4).join(', ')}.`);
  }

  parts.push(
    `Session lasted ${parsed.duration} minute${parsed.duration !== 1 ? 's' : ''}, ` +
    `${parsed.messagesCount} messages, ${formatTokens(parsed.tokensUsed)} tokens.`
  );

  return parts.join(' ');
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000)     return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}
