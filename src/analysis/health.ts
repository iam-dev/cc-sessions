/**
 * Health Scoring — session and project health analysis
 *
 * Scoring is deliberately blocker-first because task extraction is regex-based
 * and unreliable (false positives, single-session only).
 */

import type { SessionMemory } from '../types';

export type HealthScore = 'green' | 'yellow' | 'red';

export interface SessionHealth {
  score: HealthScore;
  reasons: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface ProjectHealth {
  score: HealthScore;
  label: string;
  recentSessionCount: number;
  redCount: number;
  yellowCount: number;
}

/**
 * Compute a health score for a single session.
 *
 * Blocker-first: blockers are the most reliable signal; task counts are
 * supplementary because task extraction is regex-based and unreliable.
 */
export function computeHealth(session: SessionMemory): SessionHealth {
  const { blockers, tasksCompleted, tasksPending, nextSteps } = session;

  const tasksTotal = tasksCompleted + tasksPending;
  const completionRate = tasksTotal > 0 ? tasksCompleted / tasksTotal : 0;

  // ---- Confidence ----
  const hasBlockers = blockers.length > 0;
  const hasTasks = tasksTotal > 0;

  let confidence: SessionHealth['confidence'];
  if (hasBlockers && hasTasks) {
    confidence = 'high';
  } else if (hasBlockers || hasTasks) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // ---- Red conditions ----
  const isRedManyBlockers = blockers.length >= 3;
  const isRedBlockedNoProgress =
    blockers.length >= 1 && tasksCompleted === 0 && nextSteps.length > 0;
  const isRedNoTasksCompleted =
    tasksTotal > 0 && tasksCompleted === 0 && blockers.length >= 2;

  if (isRedManyBlockers || isRedBlockedNoProgress || isRedNoTasksCompleted) {
    const reasons: string[] = [];

    if (isRedManyBlockers) {
      reasons.push(`${blockers.length} blockers`);
    } else {
      // 1 or 2 blockers with no progress
      reasons.push(`${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`);
      if (isRedBlockedNoProgress) {
        reasons.push('blocked with no progress');
      }
    }

    if (isRedNoTasksCompleted && !isRedManyBlockers && !isRedBlockedNoProgress) {
      reasons.push('no tasks completed');
    }

    return { score: 'red', reasons, confidence };
  }

  // ---- Yellow conditions ----
  const isYellowSomBlockers = blockers.length === 1 || blockers.length === 2;
  const isYellowLowCompletion = tasksTotal > 0 && completionRate < 0.67;
  const isYellowWorkInProgress =
    nextSteps.length > 0 &&
    blockers.length === 0 &&
    tasksCompleted === 0 &&
    tasksTotal > 0;

  if (isYellowSomBlockers || isYellowLowCompletion || isYellowWorkInProgress) {
    const reasons: string[] = [];

    if (isYellowSomBlockers) {
      reasons.push(`${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`);
    } else if (isYellowWorkInProgress) {
      // "work in progress" is more descriptive than a raw completion percentage
      // when there are explicit next steps recorded but no tasks done yet
      reasons.push('work in progress');
    } else if (isYellowLowCompletion) {
      const pct = Math.round(completionRate * 100);
      reasons.push(`${pct}% tasks done`);
    }

    return { score: 'yellow', reasons, confidence };
  }

  // ---- Green ----
  const reasons: string[] = ['no blockers'];
  if (tasksTotal > 0) {
    reasons.push(`${tasksCompleted}/${tasksTotal} tasks done`);
  }

  return { score: 'green', reasons, confidence };
}

/**
 * Return a human-readable label for a health score.
 */
export function getHealthLabel(score: HealthScore): string {
  switch (score) {
    case 'green':
      return 'Healthy';
    case 'yellow':
      return 'Mixed';
    case 'red':
      return 'Struggling';
  }
}

/**
 * Aggregate health across the most recent sessions for a project.
 *
 * @param sessions - Sessions already sorted newest-first
 * @param recentCount - Number of recent sessions to consider (default: 5)
 */
export function aggregateProjectHealth(
  sessions: SessionMemory[],
  recentCount: number = 5
): ProjectHealth {
  const recent = sessions.slice(0, recentCount);
  const healths = recent.map(computeHealth);

  const redCount = healths.filter(h => h.score === 'red').length;
  const yellowCount = healths.filter(h => h.score === 'yellow').length;

  let score: HealthScore;
  if (redCount >= 2) {
    score = 'red';
  } else if (redCount >= 1 || yellowCount >= 2) {
    score = 'yellow';
  } else {
    score = 'green';
  }

  return {
    score,
    label: getHealthLabel(score),
    recentSessionCount: recent.length,
    redCount,
    yellowCount,
  };
}
