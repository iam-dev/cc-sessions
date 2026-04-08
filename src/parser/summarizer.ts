/**
 * Session summary orchestrator.
 *
 * Tries providers in order:
 *   1. Claude Code CLI (cc-sessions: no extra key required)
 *   2. Anthropic API   (only if ANTHROPIC_API_KEY is set)
 *   3. Rule-based      (always succeeds; tags result with 'no-ai-summary')
 *
 * Call sites that already pass config.summaries as the second argument are
 * backward compatible — the new optional skipAI third param defaults to false.
 */

import { tryClaudeCli }     from './providers/claude-cli';
import { tryAnthropicApi }  from './providers/anthropic-api';
import { ruleBasedSummary } from './providers/rule-based';
import type { ParsedSession, SessionSummary, SummaryConfig } from '../types';

/**
 * Generate a summary for a parsed session using the provider chain.
 *
 * @param parsed  - Parsed session data
 * @param config  - Summary config (model, maxLength)
 * @param skipAI  - If true, skip CC CLI and Anthropic API and use rule-based only
 */
export async function generateSummary(
  parsed: ParsedSession,
  config: SummaryConfig,
  skipAI = false,
): Promise<SessionSummary> {
  if (!skipAI) {
    const ccCli = await tryClaudeCli(parsed);
    if (ccCli) return ccCli;

    if (process.env.ANTHROPIC_API_KEY) {
      const api = await tryAnthropicApi(parsed, config);
      if (api) return api;
    }
  }

  return ruleBasedSummary(parsed);
}
