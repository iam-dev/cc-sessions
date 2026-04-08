/**
 * Claude Code CLI summary provider.
 *
 * Spawns `claude -p "<prompt>" --output-format json`.
 * The CC CLI wraps the output in:
 *   { "type": "result", "subtype": "success", "result": "<JSON string>", "is_error": false }
 *
 * Returns SessionSummary | null — falls through on any error or timeout.
 * Does NOT append 'no-ai-summary'.
 */

import { spawn } from 'child_process';
import type { ParsedSession, SessionSummary, Task } from '../../types';

const TIMEOUT_MS = 30_000;

const CLI_PROMPT_TEMPLATE = `Analyze this Claude Code session and produce a JSON summary.

Project: {projectPath}
Duration: {duration} minutes, {messagesCount} messages, {tokensUsed} tokens
Files created: {filesCreated}
Files modified: {filesModified}

Recent user messages:
{userMessages}

Recent assistant responses:
{assistantMessages}

Respond ONLY with valid JSON matching exactly:
{"summary":"one sentence","description":"2-3 sentences","tasks":[{"description":"...","status":"completed|pending"}],"nextSteps":["..."],"keyDecisions":["..."],"blockers":["..."],"tags":["..."]}`;

interface CliEnvelope {
  type?: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
}

/** Attempts to generate a session summary using the local Claude Code CLI binary. */
export async function tryClaudeCli(parsed: ParsedSession): Promise<SessionSummary | null> {
  const prompt = buildPrompt(parsed);

  try {
    const raw = await runClaude(prompt);
    return parseEnvelope(raw);
  } catch {
    return null;
  }
}

// ─── private helpers ───────────────────────────────────────────────────────────

function buildPrompt(parsed: ParsedSession): string {
  const projectName = parsed.projectPath.split('/').pop() ?? '';
  return CLI_PROMPT_TEMPLATE
    .replace('{projectPath}', projectName)
    .replace('{duration}', String(parsed.duration))
    .replace('{messagesCount}', String(parsed.messagesCount))
    .replace('{tokensUsed}', formatTokens(parsed.tokensUsed))
    .replace('{filesCreated}', parsed.filesCreated.join(', ') || 'None')
    .replace('{filesModified}', parsed.filesModified.join(', ') || 'None')
    .replace('{userMessages}', formatMessages(parsed.userMessages, 3, 400))
    .replace('{assistantMessages}', formatMessages(parsed.assistantMessages, 2, 600));
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('claude CLI timeout'));
    }, TIMEOUT_MS);

    let stdout = '';
    let stderr = '';

    const child = spawn('claude', ['-p', prompt, '--output-format', 'json'], {
      signal: controller.signal,
    });

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

function parseEnvelope(raw: string): SessionSummary | null {
  try {
    const envelope = JSON.parse(raw) as CliEnvelope;
    if (envelope.is_error) return null;
    if (!envelope.result) return null;

    return parseSessionSummary(envelope.result);
  } catch {
    return null;
  }
}

function parseSessionSummary(jsonStr: string): SessionSummary | null {
  try {
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const data = JSON.parse(match[0]) as Record<string, unknown>;
    if (!data['summary']) return null;

    return {
      summary:      String(data['summary']),
      description:  String(data['description'] ?? ''),
      tasks:        normalizeTasks(data['tasks']),
      nextSteps:    normalizeStringArray(data['nextSteps']),
      keyDecisions: normalizeStringArray(data['keyDecisions']),
      blockers:     normalizeStringArray(data['blockers']),
      tags:         normalizeStringArray(data['tags']),
    };
  } catch {
    return null;
  }
}

function formatMessages(messages: string[], maxCount: number, maxLen: number): string {
  let result = '';
  let total = 0;
  for (const msg of messages.slice(-maxCount)) {
    const t = msg.slice(0, 300);
    if (total + t.length > maxLen) break;
    result += t + '\n---\n';
    total += t.length;
  }
  return result || 'No messages';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function normalizeTasks(tasks: unknown): Task[] {
  if (!Array.isArray(tasks)) return [];
  return (tasks as Record<string, unknown>[]).map((t, i) => ({
    id:          String(i + 1),
    description: String(t['description'] ?? ''),
    status:      normalizeStatus(t['status']),
    createdAt:   new Date(),
  })).filter(task => task.description.length > 0);
}

function normalizeStatus(s: unknown): 'pending' | 'in_progress' | 'completed' | 'blocked' {
  const v = String(s).toLowerCase();
  if (v === 'completed' || v === 'done') return 'completed';
  if (v === 'in_progress' || v === 'in progress') return 'in_progress';
  if (v === 'blocked') return 'blocked';
  return 'pending';
}

function normalizeStringArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return (arr as unknown[]).map(i => String(i).trim()).filter(s => s.length > 0);
}
