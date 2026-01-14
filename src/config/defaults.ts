/**
 * Default configuration values for cc-sessions
 */

import type { Config } from '../types';

export const DEFAULT_CONFIG: Config = {
  version: 1,
  retention: {
    fullSessions: '1y',
    archives: 'forever',
    searchIndex: 'forever',
    overrideClaudeRetention: true,
    maxStorageGb: 10
  },
  autoSave: {
    enabled: true,
    intervalMinutes: 5,
    onSessionEnd: true,
    onTerminalClose: true,
    generateSummary: true,
    extractTasks: true
  },
  summaries: {
    model: 'haiku',
    maxLength: 500,
    include: [
      'description',
      'tasks_completed',
      'tasks_pending',
      'files_modified',
      'next_steps',
      'key_decisions',
      'blockers'
    ]
  },
  search: {
    enabled: true,
    indexFields: ['summary', 'tasks', 'files', 'user_messages', 'assistant_messages'],
    fuzzyThreshold: 0.7
  },
  cloud: {
    enabled: false,
    provider: 'r2',
    region: 'auto',
    syncIntervalMinutes: 30,
    syncOnSave: true,
    deviceId: 'auto'
  },
  ui: {
    showOnStart: true,
    recentCount: 10,
    dateFormat: 'MMM D, YYYY h:mm A',
    theme: 'auto'
  },
  projects: {
    overrides: {}
  }
};

/**
 * Retention period options and their descriptions
 */
export const RETENTION_OPTIONS = {
  '7d': { days: 7, label: '7 days', description: 'Minimal storage, recent sessions only' },
  '14d': { days: 14, label: '14 days', description: 'Two weeks of history' },
  '30d': { days: 30, label: '30 days', description: 'Claude default retention' },
  '90d': { days: 90, label: '90 days', description: 'Quarterly retention' },
  '180d': { days: 180, label: '6 months', description: 'Half year of history' },
  '1y': { days: 365, label: '1 year', description: 'Recommended for most users' },
  '2y': { days: 730, label: '2 years', description: 'Extended history' },
  '5y': { days: 1825, label: '5 years', description: 'Long-term projects' },
  'forever': { days: Infinity, label: 'Forever', description: 'Never delete (uses compression)' }
} as const;

/**
 * Summary model options
 */
export const SUMMARY_MODELS = {
  haiku: {
    id: 'claude-3-haiku-20240307',
    name: 'Claude Haiku',
    description: 'Fast and cheap (~$0.001 per summary)',
    costPer1k: 0.00025
  },
  sonnet: {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet',
    description: 'Better quality (~$0.01 per summary)',
    costPer1k: 0.003
  }
} as const;
