/**
 * Anthropic API summary provider.
 *
 * Returns null if ANTHROPIC_API_KEY is not set or the API call fails.
 * Does NOT append 'no-ai-summary' — only the rule-based provider does that.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ParsedSession, SessionSummary, SummaryConfig, Task } from '../../types';

const SUMMARY_PROMPT = `Analyze this Claude Code session and provide a structured summary.

<session_data>
Project: {projectPath}
Duration: {duration} minutes
Messages: {messagesCount}
Tokens: {tokensUsed}

Files created: {filesCreated}
Files modified: {filesModified}

Recent user messages:
{userMessages}

Recent assistant responses:
{assistantMessages}
</session_data>

Respond ONLY with valid JSON in this exact format (no markdown, no explanation):
{
  "title": "3-6 word title",
  "summary": "One concise sentence describing what was accomplished",
  "description": "2-3 sentences explaining the work done and current state",
  "tasks": [
    {"description": "task text", "status": "completed"},
    {"description": "task text", "status": "pending"}
  ],
  "nextSteps": ["suggested next action"],
  "keyDecisions": ["important decision made"],
  "blockers": ["any issues encountered"],
  "tags": ["relevant", "tags"]
}`;

/**
 * Attempts to generate a session summary via the Anthropic API.
 *
 * Returns null if the API key is absent or the API call fails.
 */
export async function tryAnthropicApi(
  parsed: ParsedSession,
  config: SummaryConfig,
): Promise<SessionSummary | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null;
  }

  try {
    const client = new Anthropic();

    const prompt = buildPrompt(parsed);

    const modelId = config.model === 'sonnet'
      ? 'claude-sonnet-4-6'
      : 'claude-haiku-4-5-20251001';

    const response = await client.messages.create({
      model: modelId,
      max_tokens: Math.max(config.maxLength || 500, 500),
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const text = textBlock && 'text' in textBlock ? textBlock.text : '';

    return parseResponse(text);
  } catch {
    return null;
  }
}

// ─── private helpers ───────────────────────────────────────────────────────────

function buildPrompt(parsed: ParsedSession): string {
  return SUMMARY_PROMPT
    .replace('{projectPath}', parsed.projectPath.split('/').pop() ?? '')
    .replace('{duration}', String(parsed.duration))
    .replace('{messagesCount}', String(parsed.messagesCount))
    .replace('{tokensUsed}', formatTokens(parsed.tokensUsed))
    .replace('{filesCreated}', parsed.filesCreated.join(', ') || 'None')
    .replace('{filesModified}', parsed.filesModified.join(', ') || 'None')
    .replace('{userMessages}', formatMessages(parsed.userMessages, 5, 500))
    .replace('{assistantMessages}', formatMessages(parsed.assistantMessages, 3, 800));
}

function parseResponse(text: string): SessionSummary | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const data = JSON.parse(match[0]) as Record<string, unknown>;
    if (!data['summary']) return null;

    return {
      title:        String(data.title ?? ''),
      summary:      String(data.summary ?? ''),
      description:  String(data.description ?? ''),
      tasks:        normalizeTasks(data.tasks),
      nextSteps:    normalizeStringArray(data.nextSteps),
      keyDecisions: normalizeStringArray(data.keyDecisions),
      blockers:     normalizeStringArray(data.blockers),
      tags:         normalizeStringArray(data.tags),
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
  return (tasks as Record<string, unknown>[])
    .map((t, i) => ({
      id:          String(i + 1),
      description: String(t.description ?? ''),
      status:      normalizeStatus(t.status),
      createdAt:   new Date(),
    }))
    .filter(t => t.description.length > 0);
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
