/**
 * CC-Sessions - Session Memory Plugin for Claude Code
 *
 * Never lose context again. Smart session memory with extended retention.
 */

// Export types
export * from './types';

// Export parser
export { parseLogFile } from './parser/jsonl';
export { extractFilesCreated, extractFilesModified, extractFilesDeleted, extractTasks } from './parser/extractor';
export { generateSummary } from './parser/summarizer';

// Export store
export { SessionStore } from './store/sessions';
export { SearchIndex } from './store/index';
export { RetentionManager } from './store/retention';

// Export config
export { loadConfig, saveConfig, getConfigDir, getConfigFile } from './config/loader';
export { DEFAULT_CONFIG, RETENTION_OPTIONS, SUMMARY_MODELS } from './config/defaults';

// Version info
export const VERSION = '1.0.0';
export const NAME = 'cc-sessions';
