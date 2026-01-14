/**
 * CC-Sessions Type Definitions
 * Core data structures for session memory management
 */

// ============================================
// Session Memory Types
// ============================================

export interface SessionMemory {
  // Identification
  id: string;
  claudeSessionId: string;
  projectPath: string;
  projectName: string;

  // Timing
  startedAt: Date;
  endedAt: Date;
  duration: number; // Minutes

  // Content Summary
  summary: string;
  description: string;

  // Task Tracking
  tasks: Task[];
  tasksCompleted: number;
  tasksPending: number;

  // Files
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];

  // Context
  lastUserMessage: string;
  lastAssistantMessage: string;
  nextSteps: string[];
  keyDecisions: string[];
  blockers: string[];

  // Metrics
  tokensUsed: number;
  messagesCount: number;
  toolCallsCount: number;

  // Metadata
  tags: string[];
  archived: boolean;
  archivedAt?: Date;
  synced?: boolean;
  syncedAt?: Date;

  // Raw data reference
  logFile: string;
  logFileArchived?: string;
}

export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  createdAt: Date;
  completedAt?: Date;
  relatedFiles?: string[];
  notes?: string;
}

// ============================================
// Search Types
// ============================================

export interface SearchResult {
  session: SessionMemory;
  score: number;
  matches: SearchMatch[];
}

export interface SearchMatch {
  field: string;
  text: string;
  highlight: string;
}

export interface SearchOptions {
  query: string;
  projectPath?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  includeArchived?: boolean;
}

// ============================================
// Parser Types
// ============================================

export interface RawLogEntry {
  type: 'human' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
  timestamp: string;
  content?: string;
  message?: {
    content: string | ContentBlock[];
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  name?: string;
  input?: Record<string, unknown>;
  cwd?: string;
  sessionId?: string;
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  timestamp: string;
}

export interface ParsedSession {
  logPath: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  userMessages: string[];
  assistantMessages: string[];
  toolCalls: ToolCall[];
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  tokensUsed: number;
  messagesCount: number;
  projectPath: string;
  claudeSessionId: string;
}

// ============================================
// Summary Types
// ============================================

export interface SessionSummary {
  summary: string;
  description: string;
  tasks: Task[];
  nextSteps: string[];
  keyDecisions: string[];
  blockers: string[];
  tags: string[];
}

export interface SummaryConfig {
  model: 'haiku' | 'sonnet';
  maxLength: number;
  include: string[];
}

// ============================================
// Configuration Types
// ============================================

export interface Config {
  version: number;
  retention: RetentionConfig;
  autoSave: AutoSaveConfig;
  summaries: SummaryConfig;
  search: SearchConfig;
  cloud: CloudConfig;
  ui: UIConfig;
  projects: ProjectsConfig;
}

export interface RetentionConfig {
  fullSessions: string;
  archives: string;
  searchIndex: string;
  overrideClaudeRetention: boolean;
  maxStorageGb: number;
}

export interface AutoSaveConfig {
  enabled: boolean;
  intervalMinutes: number;
  onSessionEnd: boolean;
  onTerminalClose: boolean;
  generateSummary: boolean;
  extractTasks: boolean;
}

export interface SearchConfig {
  enabled: boolean;
  indexFields: string[];
  fuzzyThreshold: number;
}

export interface CloudConfig {
  enabled: boolean;
  provider: 'r2' | 's3' | 'b2';
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
  region?: string;
  encryptionKey?: string;
  syncIntervalMinutes: number;
  syncOnSave: boolean;
  deviceId: string;
}

/**
 * Remote session metadata for cloud sync
 */
export interface RemoteSessionInfo {
  sessionId: string;
  deviceId: string;
  uploadedAt: Date;
  size: number;
  key: string;
}

export interface UIConfig {
  showOnStart: boolean;
  recentCount: number;
  dateFormat: string;
  theme: 'auto' | 'dark' | 'light';
}

export interface ProjectsConfig {
  overrides: Record<string, ProjectOverride>;
}

export interface ProjectOverride {
  retention?: string;
  cloudSync?: boolean;
  generateSummary?: boolean;
}

// ============================================
// Store Types
// ============================================

export interface CleanupReport {
  sessionsArchived: number;
  sessionsDeleted: number;
  bytesFreed: number;
  logFilesBackedUp: number;
}

export interface SyncReport {
  uploaded: number;
  downloaded: number;
  conflicts: number;
}

export interface StorageStats {
  totalSessions: number;
  activeSessions: number;
  archivedSessions: number;
  storageUsedBytes: number;
  oldestSession?: Date;
  newestSession?: Date;
}

// ============================================
// Hook Context Types
// ============================================

export interface HookContext {
  sessionId: string;
  projectPath: string;
  cwd: string;
  startedAt: Date;
}
