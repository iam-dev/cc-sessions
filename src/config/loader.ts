/**
 * Configuration loader for cc-sessions
 * Loads and validates user configuration, merging with defaults
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import type { Config, RetentionConfig, AutoSaveConfig, SummaryConfig, SearchConfig, CloudConfig, UIConfig, ProjectsConfig } from '../types';
import { DEFAULT_CONFIG } from './defaults';

const CONFIG_DIR = path.join(os.homedir(), '.cc-sessions');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yml');

/**
 * Load configuration from file, merging with defaults
 */
export async function loadConfig(): Promise<Config> {
  ensureConfigDir();

  if (!fs.existsSync(CONFIG_FILE)) {
    // Create default config file
    await saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = yaml.parse(content);
    return mergeConfig(parsed);
  } catch (error) {
    console.error('Error loading config, using defaults:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: Config): Promise<void> {
  ensureConfigDir();

  const yamlContent = yaml.stringify(configToYaml(config), {
    indent: 2,
    lineWidth: 80
  });

  fs.writeFileSync(CONFIG_FILE, yamlContent, 'utf-8');
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Merge parsed YAML config with defaults
 */
function mergeConfig(parsed: Record<string, unknown>): Config {
  return {
    version: (parsed.version as number) || DEFAULT_CONFIG.version,
    retention: mergeRetention(parsed.retention as Record<string, unknown> | undefined),
    autoSave: mergeAutoSave(parsed.auto_save as Record<string, unknown> | undefined),
    summaries: mergeSummaries(parsed.summaries as Record<string, unknown> | undefined),
    search: mergeSearch(parsed.search as Record<string, unknown> | undefined),
    cloud: mergeCloud(parsed.cloud as Record<string, unknown> | undefined),
    ui: mergeUI(parsed.ui as Record<string, unknown> | undefined),
    projects: mergeProjects(parsed.projects as Record<string, unknown> | undefined)
  };
}

function mergeRetention(parsed: Record<string, unknown> | undefined): RetentionConfig {
  const defaults = DEFAULT_CONFIG.retention;
  if (!parsed) return defaults;

  return {
    fullSessions: (parsed.full_sessions as string) || defaults.fullSessions,
    archives: (parsed.archives as string) || defaults.archives,
    searchIndex: (parsed.search_index as string) || defaults.searchIndex,
    overrideClaudeRetention: parsed.override_claude_retention !== undefined
      ? (parsed.override_claude_retention as boolean)
      : defaults.overrideClaudeRetention,
    maxStorageGb: (parsed.max_storage_gb as number) || defaults.maxStorageGb
  };
}

function mergeAutoSave(parsed: Record<string, unknown> | undefined): AutoSaveConfig {
  const defaults = DEFAULT_CONFIG.autoSave;
  if (!parsed) return defaults;

  return {
    enabled: parsed.enabled !== undefined ? (parsed.enabled as boolean) : defaults.enabled,
    intervalMinutes: (parsed.interval_minutes as number) || defaults.intervalMinutes,
    onSessionEnd: parsed.on_session_end !== undefined
      ? (parsed.on_session_end as boolean)
      : defaults.onSessionEnd,
    onTerminalClose: parsed.on_terminal_close !== undefined
      ? (parsed.on_terminal_close as boolean)
      : defaults.onTerminalClose,
    generateSummary: parsed.generate_summary !== undefined
      ? (parsed.generate_summary as boolean)
      : defaults.generateSummary,
    extractTasks: parsed.extract_tasks !== undefined
      ? (parsed.extract_tasks as boolean)
      : defaults.extractTasks
  };
}

function mergeSummaries(parsed: Record<string, unknown> | undefined): SummaryConfig {
  const defaults = DEFAULT_CONFIG.summaries;
  if (!parsed) return defaults;

  return {
    model: (parsed.model as 'haiku' | 'sonnet') || defaults.model,
    maxLength: (parsed.max_length as number) || defaults.maxLength,
    include: (parsed.include as string[]) || defaults.include
  };
}

function mergeSearch(parsed: Record<string, unknown> | undefined): SearchConfig {
  const defaults = DEFAULT_CONFIG.search;
  if (!parsed) return defaults;

  return {
    enabled: parsed.enabled !== undefined ? (parsed.enabled as boolean) : defaults.enabled,
    indexFields: (parsed.index_fields as string[]) || defaults.indexFields,
    fuzzyThreshold: (parsed.fuzzy_threshold as number) || defaults.fuzzyThreshold
  };
}

function mergeCloud(parsed: Record<string, unknown> | undefined): CloudConfig {
  const defaults = DEFAULT_CONFIG.cloud;
  if (!parsed) return defaults;

  return {
    enabled: parsed.enabled !== undefined ? (parsed.enabled as boolean) : defaults.enabled,
    provider: (parsed.provider as 'r2' | 's3' | 'b2') || defaults.provider,
    bucket: parsed.bucket as string | undefined,
    accessKeyId: parsed.access_key_id as string | undefined,
    secretAccessKey: parsed.secret_access_key as string | undefined,
    endpoint: parsed.endpoint as string | undefined,
    encryptionKey: parsed.encryption_key as string | undefined,
    syncIntervalMinutes: (parsed.sync_interval_minutes as number) || defaults.syncIntervalMinutes,
    syncOnSave: parsed.sync_on_save !== undefined
      ? (parsed.sync_on_save as boolean)
      : defaults.syncOnSave,
    deviceId: (parsed.device_id as string) || defaults.deviceId
  };
}

function mergeUI(parsed: Record<string, unknown> | undefined): UIConfig {
  const defaults = DEFAULT_CONFIG.ui;
  if (!parsed) return defaults;

  return {
    showOnStart: parsed.show_on_start !== undefined
      ? (parsed.show_on_start as boolean)
      : defaults.showOnStart,
    recentCount: (parsed.recent_count as number) || defaults.recentCount,
    dateFormat: (parsed.date_format as string) || defaults.dateFormat,
    theme: (parsed.theme as 'auto' | 'dark' | 'light') || defaults.theme
  };
}

function mergeProjects(parsed: Record<string, unknown> | undefined): ProjectsConfig {
  const defaults = DEFAULT_CONFIG.projects;
  if (!parsed) return defaults;

  return {
    overrides: (parsed.overrides as Record<string, { retention?: string; cloudSync?: boolean; generateSummary?: boolean }>) || defaults.overrides
  };
}

/**
 * Convert config object to YAML-friendly format (snake_case keys)
 */
function configToYaml(config: Config): Record<string, unknown> {
  return {
    version: config.version,
    retention: {
      full_sessions: config.retention.fullSessions,
      archives: config.retention.archives,
      search_index: config.retention.searchIndex,
      override_claude_retention: config.retention.overrideClaudeRetention,
      max_storage_gb: config.retention.maxStorageGb
    },
    auto_save: {
      enabled: config.autoSave.enabled,
      interval_minutes: config.autoSave.intervalMinutes,
      on_session_end: config.autoSave.onSessionEnd,
      on_terminal_close: config.autoSave.onTerminalClose,
      generate_summary: config.autoSave.generateSummary,
      extract_tasks: config.autoSave.extractTasks
    },
    summaries: {
      model: config.summaries.model,
      max_length: config.summaries.maxLength,
      include: config.summaries.include
    },
    search: {
      enabled: config.search.enabled,
      index_fields: config.search.indexFields,
      fuzzy_threshold: config.search.fuzzyThreshold
    },
    cloud: {
      enabled: config.cloud.enabled,
      provider: config.cloud.provider,
      bucket: config.cloud.bucket,
      access_key_id: config.cloud.accessKeyId,
      secret_access_key: config.cloud.secretAccessKey,
      endpoint: config.cloud.endpoint,
      encryption_key: config.cloud.encryptionKey,
      sync_interval_minutes: config.cloud.syncIntervalMinutes,
      sync_on_save: config.cloud.syncOnSave,
      device_id: config.cloud.deviceId
    },
    ui: {
      show_on_start: config.ui.showOnStart,
      recent_count: config.ui.recentCount,
      date_format: config.ui.dateFormat,
      theme: config.ui.theme
    },
    projects: {
      overrides: config.projects.overrides
    }
  };
}

/**
 * Get config directory path
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * Get config file path
 */
export function getConfigFile(): string {
  return CONFIG_FILE;
}
