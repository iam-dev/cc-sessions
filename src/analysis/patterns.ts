/**
 * Blocker Pattern Detection — identifies recurring blockers across sessions
 * using token-based Jaccard similarity for near-duplicate grouping.
 */

import type { SessionMemory } from '../types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'is', 'was', 'are', 'with', 'of', 'it', 'its', 'by', 'from', 'not',
]);

/**
 * Tokenize a blocker string into a set of meaningful words.
 * Applies normalizeBlocker first, then filters short and stop words.
 */
function tokenizeBlocker(text: string): Set<string> {
  return new Set(
    normalizeBlocker(text)
      .split(' ')
      .filter(t => t.length > 2 && !STOPWORDS.has(t))
  );
}

/**
 * Compute Jaccard similarity between two token sets.
 * Returns 1 when both sets are empty (identical empty strings).
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }

  let intersectionSize = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersectionSize++;
    }
  }

  const unionSize = a.size + b.size - intersectionSize;
  return unionSize === 0 ? 1 : intersectionSize / unionSize;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Normalize a blocker string for similarity comparison.
 *
 * Steps:
 * 1. Lowercase + trim
 * 2. Replace non-word, non-space chars with space
 * 3. Collapse whitespace
 * 4. Strip common prefix noise: "blocked by", "issue", "problem", "error", "failed", "failure"
 * 5. Trim again
 */
export function normalizeBlocker(text: string): string {
  let s = text.toLowerCase().trim();
  s = s.replace(/[^\w\s]/g, ' ');
  s = s.replace(/\s+/g, ' ');

  const noisePrefixes = [
    'blocked by',
    'failure',
    'failed',
    'error',
    'problem',
    'issue',
  ];

  for (const prefix of noisePrefixes) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }

  return s.trim();
}

interface BlockerGroup {
  text: string;
  tokens: Set<string>;
  count: number;
}

/**
 * Identify recurring blockers across sessions using token-based Jaccard similarity.
 *
 * Near-duplicate blockers (Jaccard >= 0.4) are merged into a single group.
 * Returns the top 3 groups sorted by count descending.
 */
export function getRecurringBlockers(
  sessions: SessionMemory[]
): Array<{ text: string; count: number }> {
  const allBlockers = sessions.flatMap(s => s.blockers);

  const groups: BlockerGroup[] = [];

  for (const blocker of allBlockers) {
    const tokens = tokenizeBlocker(blocker);

    let merged = false;
    for (const group of groups) {
      if (jaccardSimilarity(tokens, group.tokens) >= 0.4) {
        group.count++;
        merged = true;
        break;
      }
    }

    if (!merged) {
      groups.push({ text: blocker, tokens, count: 1 });
    }
  }

  return groups
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(({ text, count }) => ({ text, count }));
}
