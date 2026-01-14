/**
 * AI Summarizer for Claude Code sessions
 *
 * Uses the Anthropic API to generate intelligent session summaries
 */

import Anthropic from '@anthropic-ai/sdk';
import * as path from 'path';
import type { ParsedSession, SessionSummary, SummaryConfig, Task } from '../types';
import { extractTasks, extractKeyDecisions, extractBlockers, extractNextSteps, extractTags } from './extractor';

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
  "summary": "One concise sentence describing what was accomplished",
  "description": "2-3 sentences explaining the work being done and current state",
  "tasks": [
    {"description": "task text", "status": "completed"},
    {"description": "task text", "status": "pending"}
  ],
  "nextSteps": ["suggested next action 1", "action 2"],
  "keyDecisions": ["important decision made"],
  "blockers": ["any issues encountered"],
  "tags": ["relevant", "tags"]
}`;

/**
 * Generate an AI-powered summary of a parsed session
 */
export async function generateSummary(
  parsed: ParsedSession,
  config: SummaryConfig
): Promise<SessionSummary> {
  try {
    const client = new Anthropic();

    // Prepare the prompt with session data
    const prompt = SUMMARY_PROMPT
      .replace('{projectPath}', path.basename(parsed.projectPath))
      .replace('{duration}', String(parsed.duration))
      .replace('{messagesCount}', String(parsed.messagesCount))
      .replace('{tokensUsed}', formatTokens(parsed.tokensUsed))
      .replace('{filesCreated}', parsed.filesCreated.join(', ') || 'None')
      .replace('{filesModified}', parsed.filesModified.join(', ') || 'None')
      .replace('{userMessages}', formatMessages(parsed.userMessages, 5, 500))
      .replace('{assistantMessages}', formatMessages(parsed.assistantMessages, 3, 800));

    // Select model based on config
    const modelId = config.model === 'sonnet'
      ? 'claude-sonnet-4-20250514'
      : 'claude-3-haiku-20240307';

    const response = await client.messages.create({
      model: modelId,
      max_tokens: config.maxLength || 500,
      messages: [{ role: 'user', content: prompt }]
    });

    // Extract text content from response
    const textContent = response.content.find(block => block.type === 'text');
    const text = textContent && 'text' in textContent ? textContent.text : '';

    // Parse the JSON response
    return parseJsonResponse(text, parsed);

  } catch (error) {
    console.error('AI summary generation failed:', error);
    // Return fallback summary based on extracted data
    return createFallbackSummary(parsed);
  }
}

/**
 * Parse JSON response from AI, with fallback handling
 */
function parseJsonResponse(text: string, parsed: ParsedSession): SessionSummary {
  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const data = JSON.parse(jsonMatch[0]);

    // Validate and normalize the response
    return {
      summary: String(data.summary || ''),
      description: String(data.description || ''),
      tasks: normalizeTasks(data.tasks),
      nextSteps: normalizeStringArray(data.nextSteps),
      keyDecisions: normalizeStringArray(data.keyDecisions),
      blockers: normalizeStringArray(data.blockers),
      tags: normalizeStringArray(data.tags)
    };

  } catch (parseError) {
    console.error('Failed to parse AI response:', parseError);
    return createFallbackSummary(parsed);
  }
}

/**
 * Create a fallback summary using extraction methods
 */
function createFallbackSummary(parsed: ParsedSession): SessionSummary {
  const projectName = path.basename(parsed.projectPath);
  const tasks = extractTasks(parsed.userMessages, parsed.assistantMessages);
  const keyDecisions = extractKeyDecisions(parsed.assistantMessages);
  const blockers = extractBlockers(parsed.userMessages, parsed.assistantMessages);
  const nextSteps = extractNextSteps(parsed.assistantMessages);
  const tags = extractTags(
    parsed.userMessages,
    parsed.assistantMessages,
    [...parsed.filesCreated, ...parsed.filesModified]
  );

  // Generate basic summary
  const summary = generateBasicSummary(parsed, projectName);
  const description = generateBasicDescription(parsed, projectName);

  return {
    summary,
    description,
    tasks,
    nextSteps,
    keyDecisions,
    blockers,
    tags
  };
}

/**
 * Generate a basic summary without AI
 */
function generateBasicSummary(parsed: ParsedSession, projectName: string): string {
  const fileCount = parsed.filesCreated.length + parsed.filesModified.length;

  if (fileCount > 0) {
    return `Session in ${projectName}: modified ${fileCount} file${fileCount !== 1 ? 's' : ''} over ${parsed.duration} minutes`;
  }

  return `Session in ${projectName}: ${parsed.duration} minute${parsed.duration !== 1 ? 's' : ''}, ${parsed.messagesCount} message${parsed.messagesCount !== 1 ? 's' : ''}`;
}

/**
 * Generate a basic description without AI
 */
function generateBasicDescription(parsed: ParsedSession, projectName: string): string {
  const parts: string[] = [];

  parts.push(`Worked on ${projectName} for ${parsed.duration} minutes.`);

  if (parsed.filesCreated.length > 0) {
    parts.push(`Created ${parsed.filesCreated.length} new file${parsed.filesCreated.length !== 1 ? 's' : ''}.`);
  }

  if (parsed.filesModified.length > 0) {
    parts.push(`Modified ${parsed.filesModified.length} existing file${parsed.filesModified.length !== 1 ? 's' : ''}.`);
  }

  if (parsed.tokensUsed > 0) {
    parts.push(`Used ${formatTokens(parsed.tokensUsed)} tokens.`);
  }

  return parts.join(' ');
}

/**
 * Format messages for the prompt, limiting count and length
 */
function formatMessages(messages: string[], maxCount: number, maxTotalLength: number): string {
  const recent = messages.slice(-maxCount);
  let result = '';
  let totalLength = 0;

  for (const msg of recent) {
    const truncated = msg.slice(0, 300);
    if (totalLength + truncated.length > maxTotalLength) {
      break;
    }
    result += truncated + '\n---\n';
    totalLength += truncated.length;
  }

  return result || 'No messages';
}

/**
 * Format token count for display
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}K`;
  }
  return String(tokens);
}

/**
 * Normalize tasks array from AI response
 */
function normalizeTasks(tasks: unknown): Task[] {
  if (!Array.isArray(tasks)) return [];

  return tasks.map((t, i) => {
    const task = t as Record<string, unknown>;
    return {
      id: String(i + 1),
      description: String(task.description || ''),
      status: normalizeStatus(task.status),
      createdAt: new Date()
    };
  }).filter(t => t.description.length > 0);
}

/**
 * Normalize task status
 */
function normalizeStatus(status: unknown): 'pending' | 'in_progress' | 'completed' | 'blocked' {
  const s = String(status).toLowerCase();
  if (s === 'completed' || s === 'done' || s === 'finished') return 'completed';
  if (s === 'in_progress' || s === 'in progress' || s === 'working') return 'in_progress';
  if (s === 'blocked' || s === 'stuck') return 'blocked';
  return 'pending';
}

/**
 * Normalize string array from AI response
 */
function normalizeStringArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(item => String(item).trim())
    .filter(item => item.length > 0);
}
