---
layout: default
title: API Reference
nav_order: 6
---

# API Reference

cc-sessions can be used programmatically in your Node.js applications.

## Installation

```bash
npm install @iam-dev/cc-sessions
```

## Quick Start

```typescript
import {
  SessionStore,
  loadConfig,
  parseLogFile
} from '@iam-dev/cc-sessions';

// Load configuration
const config = await loadConfig();

// Access session store
const store = new SessionStore();

// Get last session for a project
const lastSession = store.getLastForProject('/path/to/project');

// Search sessions
const results = store.search('authentication');

// Clean up
store.close();
```

## Core Classes

### SessionStore

SQLite-based storage for session memories.

```typescript
import { SessionStore } from '@iam-dev/cc-sessions';

const store = new SessionStore();
// or with custom path
const store = new SessionStore('/custom/path/to/db.sqlite');
```

#### Methods

##### save(session: SessionMemory): void

Save a session to the database.

```typescript
store.save({
  id: 'mem_abc123',
  claudeSessionId: 'session-456',
  projectPath: '/my/project',
  projectName: 'my-project',
  startedAt: new Date(),
  endedAt: new Date(),
  duration: 30,
  summary: 'Worked on feature X',
  description: 'Implemented new feature...',
  tasks: [],
  tasksCompleted: 0,
  tasksPending: 0,
  filesCreated: [],
  filesModified: ['src/index.ts'],
  filesDeleted: [],
  lastUserMessage: 'Thanks!',
  lastAssistantMessage: 'You\'re welcome!',
  nextSteps: [],
  keyDecisions: [],
  blockers: [],
  tokensUsed: 5000,
  messagesCount: 10,
  toolCallsCount: 5,
  tags: ['feature'],
  archived: false,
  logFile: '/path/to/log.jsonl'
});
```

##### getById(id: string): SessionMemory | null

Get a session by its ID.

```typescript
const session = store.getById('mem_abc123');
if (session) {
  console.log(session.summary);
}
```

##### getLastForProject(projectPath: string): SessionMemory | null

Get the most recent session for a project.

```typescript
const session = store.getLastForProject('/my/project');
```

##### getRecent(limit?: number, projectPath?: string): SessionMemory[]

Get recent sessions.

```typescript
// Get last 10 sessions
const recent = store.getRecent(10);

// Get last 5 for specific project
const projectRecent = store.getRecent(5, '/my/project');
```

##### search(query: string, limit?: number): SearchResult[]

Full-text search across sessions.

```typescript
const results = store.search('authentication', 20);

for (const result of results) {
  console.log(`${result.session.summary} (score: ${result.score})`);
  for (const match of result.matches) {
    console.log(`  ${match.field}: ${match.highlight}`);
  }
}
```

##### getUnsyncedSessions(): SessionMemory[]

Get sessions not yet synced to cloud.

```typescript
const unsynced = store.getUnsyncedSessions();
```

##### markSynced(id: string): void

Mark a session as synced.

```typescript
store.markSynced('mem_abc123');
```

##### archiveOld(olderThanDays: number): number

Archive sessions older than specified days.

```typescript
const archived = store.archiveOld(365);
console.log(`Archived ${archived} sessions`);
```

##### getStats(): StorageStats

Get storage statistics.

```typescript
const stats = store.getStats();
console.log(`Total: ${stats.totalSessions}`);
console.log(`Active: ${stats.activeSessions}`);
console.log(`Storage: ${stats.storageUsedBytes} bytes`);
```

##### close(): void

Close the database connection.

```typescript
store.close();
```

---

### CloudSync

Cloud storage sync with encryption.

```typescript
import { CloudSync } from '@iam-dev/cc-sessions';

const cloudSync = new CloudSync({
  enabled: true,
  provider: 's3',
  bucket: 'my-bucket',
  accessKeyId: 'KEY',
  secretAccessKey: 'SECRET',
  region: 'us-east-1',
  encryptionKey: 'your-hex-key',
  syncIntervalMinutes: 30,
  syncOnSave: true,
  deviceId: 'auto'
});
```

#### Methods

##### testConnection(): Promise<boolean>

Test connection to cloud storage.

```typescript
const connected = await cloudSync.testConnection();
```

##### uploadSession(session: SessionMemory): Promise<void>

Upload and encrypt a session.

```typescript
await cloudSync.uploadSession(session);
```

##### downloadSession(info: RemoteSessionInfo): Promise<SessionMemory>

Download and decrypt a session.

```typescript
const session = await cloudSync.downloadSession(info);
```

##### listRemoteSessions(): Promise<RemoteSessionInfo[]>

List all sessions in cloud storage.

```typescript
const sessions = await cloudSync.listRemoteSessions();
for (const info of sessions) {
  console.log(`${info.sessionId} from ${info.deviceId}`);
}
```

##### sync(store: SessionStore): Promise<SyncReport>

Perform full bidirectional sync.

```typescript
const report = await cloudSync.sync(store);
console.log(`Uploaded: ${report.uploaded}`);
console.log(`Downloaded: ${report.downloaded}`);
```

##### getDeviceId(): string

Get the current device ID.

```typescript
const deviceId = cloudSync.getDeviceId();
```

##### getKeyFingerprint(): string

Get encryption key fingerprint.

```typescript
const fingerprint = cloudSync.getKeyFingerprint();
```

---

### Encryptor

AES-256-GCM encryption utilities.

```typescript
import { Encryptor } from '@iam-dev/cc-sessions';

// Auto-generate key
const encryptor = new Encryptor();

// Use existing key
const encryptor = new Encryptor('your-64-char-hex-key');
```

#### Methods

##### encrypt(data: string): Buffer

Encrypt a string.

```typescript
const encrypted = encryptor.encrypt('secret data');
```

##### decrypt(data: Buffer): string

Decrypt data.

```typescript
const decrypted = encryptor.decrypt(encrypted);
```

##### static generateKey(): string

Generate a new encryption key.

```typescript
const key = Encryptor.generateKey();
```

##### getKeyHex(): string

Get the current key as hex string.

```typescript
const keyHex = encryptor.getKeyHex();
```

##### getKeyFingerprint(): string

Get 8-character key fingerprint.

```typescript
const fingerprint = encryptor.getKeyFingerprint();
```

---

### RetentionManager

Manage session retention and cleanup.

```typescript
import { RetentionManager, SessionStore } from '@iam-dev/cc-sessions';

const store = new SessionStore();
const retention = new RetentionManager(store, {
  fullSessions: '1y',
  archives: 'forever',
  searchIndex: 'forever',
  overrideClaudeRetention: true,
  maxStorageGb: 10
});
```

#### Methods

##### runCleanup(): Promise<CleanupReport>

Run retention cleanup.

```typescript
const report = await retention.runCleanup();
console.log(`Archived: ${report.sessionsArchived}`);
console.log(`Deleted: ${report.sessionsDeleted}`);
console.log(`Freed: ${report.bytesFreed} bytes`);
```

##### parseDays(retention: string): number

Parse retention string to days.

```typescript
retention.parseDays('1y');  // 365
retention.parseDays('30d'); // 30
retention.parseDays('forever'); // Infinity
```

---

## Parser Functions

### parseLogFile(path: string): ParsedSession

Parse a Claude Code JSONL log file.

```typescript
import { parseLogFile } from '@iam-dev/cc-sessions';

const parsed = parseLogFile('/path/to/session.jsonl');

console.log(`Duration: ${parsed.duration} minutes`);
console.log(`Messages: ${parsed.messagesCount}`);
console.log(`Tokens: ${parsed.tokensUsed}`);
console.log(`Files modified: ${parsed.filesModified.join(', ')}`);
```

### generateSummary(parsed: ParsedSession, config: SummaryConfig): Promise<SessionSummary>

Generate AI summary for a parsed session.

```typescript
import { generateSummary } from '@iam-dev/cc-sessions';

const summary = await generateSummary(parsed, {
  model: 'haiku',
  maxLength: 500,
  include: ['description', 'tasks_completed', 'next_steps']
});

console.log(summary.summary);
console.log(summary.nextSteps);
```

---

## Configuration Functions

### loadConfig(): Promise<Config>

Load configuration from file.

```typescript
import { loadConfig } from '@iam-dev/cc-sessions';

const config = await loadConfig();
console.log(`Retention: ${config.retention.fullSessions}`);
```

### saveConfig(config: Config): Promise<void>

Save configuration to file.

```typescript
import { saveConfig, loadConfig } from '@iam-dev/cc-sessions';

const config = await loadConfig();
config.retention.fullSessions = '2y';
await saveConfig(config);
```

---

## Types

### SessionMemory

```typescript
interface SessionMemory {
  id: string;
  claudeSessionId: string;
  projectPath: string;
  projectName: string;
  startedAt: Date;
  endedAt: Date;
  duration: number;
  summary: string;
  description: string;
  tasks: Task[];
  tasksCompleted: number;
  tasksPending: number;
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  lastUserMessage: string;
  lastAssistantMessage: string;
  nextSteps: string[];
  keyDecisions: string[];
  blockers: string[];
  tokensUsed: number;
  messagesCount: number;
  toolCallsCount: number;
  tags: string[];
  archived: boolean;
  archivedAt?: Date;
  synced?: boolean;
  syncedAt?: Date;
  logFile: string;
  logFileArchived?: string;
}
```

### SearchResult

```typescript
interface SearchResult {
  session: SessionMemory;
  score: number;
  matches: SearchMatch[];
}

interface SearchMatch {
  field: string;
  text: string;
  highlight: string;
}
```

### SyncReport

```typescript
interface SyncReport {
  uploaded: number;
  downloaded: number;
  conflicts: number;
}
```

### StorageStats

```typescript
interface StorageStats {
  totalSessions: number;
  activeSessions: number;
  archivedSessions: number;
  storageUsedBytes: number;
  oldestSession?: Date;
  newestSession?: Date;
}
```

---

## Constants

```typescript
import { VERSION, NAME, DEFAULT_CONFIG } from '@iam-dev/cc-sessions';

console.log(`${NAME} v${VERSION}`);
// cc-sessions v1.1.0
```
