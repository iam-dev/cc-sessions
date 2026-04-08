# Session Snapshot & Resume Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-snapshot on compaction (Notification hook), manual `cc-sessions save` CLI command, and a UI resume block + tag badges to cc-sessions.

**Architecture:** A new shared `saveSnapshot()` helper in `src/hooks/snapshot.ts` handles parse → summarise → upsert for both the Notification hook (`src/hooks/notification.ts`) and the `cc-sessions save` CLI command. The UI changes are self-contained edits to `src/server/ui.ts`.

**Tech Stack:** TypeScript, Node.js built-ins, better-sqlite3, Jest (ts-jest), Commander.js (CLI)

---

## Chunk 1: Backend — snapshot helper, notification hook, CLI commands, tests

---

### Task 1: Create `src/hooks/snapshot.ts` — shared save helper

**Files:**
- Create: `src/hooks/snapshot.ts`
- Create: `tests/hooks/snapshot.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `tests/hooks/snapshot.test.ts`:

```typescript
/**
 * Tests for saveSnapshot() helper
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionStore } from '../../src/store/sessions';
import { saveSnapshot } from '../../src/hooks/snapshot';
import type { Config } from '../../src/types';

// Minimal config — AI summary disabled so no network calls in tests
const testConfig: Config = {
  version: 1,
  retention: { fullSessions: '1y', archives: 'forever', searchIndex: '1y', overrideClaudeRetention: false, maxStorageGb: 10 },
  autoSave: { enabled: true, intervalMinutes: 5, onSessionEnd: true, onTerminalClose: true, generateSummary: false, extractTasks: false },
  summaries: { model: 'haiku', maxLength: 500, include: [] },
  search: { enabled: true, indexFields: [], fuzzyThreshold: 0.8 },
  cloud: { enabled: false, provider: 'r2', syncIntervalMinutes: 60, syncOnSave: false, deviceId: 'test' },
  ui: { showOnStart: false, recentCount: 10, dateFormat: 'relative', theme: 'dark' },
  projects: { overrides: {} },
};

// Path to a real JSONL fixture — we create a minimal valid one
function writeMinimalJsonl(dir: string): string {
  const filePath = path.join(dir, 'abc123.jsonl');
  const entries = [
    JSON.stringify({
      type: 'human',
      timestamp: new Date().toISOString(),
      message: { content: 'Hello', usage: { input_tokens: 10, output_tokens: 0 } },
      cwd: dir,
      sessionId: 'abc123',
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: { content: 'Hi there', usage: { input_tokens: 0, output_tokens: 5 } },
      cwd: dir,
      sessionId: 'abc123',
    }),
  ];
  fs.writeFileSync(filePath, entries.join('\n') + '\n', 'utf8');
  return filePath;
}

describe('saveSnapshot', () => {
  const tmpDir = path.join(os.tmpdir(), `snapshot-test-${Date.now()}`);
  const dbPath  = path.join(tmpDir, 'test.db');
  let store: SessionStore;
  let logPath: string;

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    logPath = writeMinimalJsonl(tmpDir);
  });

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    store = new SessionStore(dbPath);
  });

  afterEach(() => {
    store.close();
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('saves a new session with the given tag', async () => {
    await saveSnapshot(logPath, store, testConfig, 'snapshot');

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].tags).toContain('snapshot');
  });

  it('upserts an existing session — does not create duplicate', async () => {
    await saveSnapshot(logPath, store, testConfig, 'snapshot');
    await saveSnapshot(logPath, store, testConfig, 'pre-compact');

    const all = store.getAll();
    expect(all).toHaveLength(1);           // still just one record
    expect(all[0].tags).toContain('pre-compact');
  });

  it('preserves claudeSessionId on the saved record', async () => {
    await saveSnapshot(logPath, store, testConfig, 'snapshot');

    const all = store.getAll();
    expect(all[0].claudeSessionId).toBeTruthy();
  });

  it('does nothing for an empty JSONL file', async () => {
    const emptyPath = path.join(tmpDir, 'empty.jsonl');
    fs.writeFileSync(emptyPath, '', 'utf8');

    await saveSnapshot(emptyPath, store, testConfig, 'snapshot');

    expect(store.getAll()).toHaveLength(0);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd /Users/in615bac/Documents/cc-sessions
npx jest tests/hooks/snapshot.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../../src/hooks/snapshot'`

- [ ] **Step 1.3: Create `src/hooks/snapshot.ts`**

```typescript
/**
 * Shared snapshot helper for cc-sessions hooks.
 *
 * saveSnapshot() parses a JSONL log, generates a summary, and upserts the
 * resulting SessionMemory into the store with a caller-supplied tag.
 * The caller owns the store lifecycle (open + close).
 */

import * as path from 'path';
import { parseLogFile } from '../parser/jsonl';
import { generateSummary } from '../parser/summarizer';
import { generateId } from './utils';
import type { SessionStore } from '../store/sessions';
import type { Config, SessionMemory, ParsedSession, SessionSummary } from '../types';

/**
 * Parse, summarise, and upsert a session from a JSONL log file.
 *
 * @param logPath - Absolute path to the .jsonl file
 * @param store   - Open SessionStore (caller must close it)
 * @param config  - App config (controls AI summary)
 * @param tag     - Tag to append to the session (e.g. 'snapshot', 'pre-compact')
 */
export async function saveSnapshot(
  logPath: string,
  store: SessionStore,
  config: Config,
  tag: string,
): Promise<void> {
  const parsed = parseLogFile(logPath);

  if (parsed.messagesCount < 1) {
    return;
  }

  const summary = await resolveSummary(parsed, config);
  const sessionMemory = buildMemory(parsed, summary, logPath);

  // Append tag — preserve any AI-generated tags from summary
  sessionMemory.tags = [...sessionMemory.tags, tag];

  // Upsert: if a record already exists for this Claude session, reuse its id
  // so store.save() (INSERT OR REPLACE on primary key) updates it in place
  const existing = store.getByClaudeSessionId(parsed.claudeSessionId);
  if (existing) {
    sessionMemory.id = existing.id;
  }

  store.save(sessionMemory);
}

// ─── private helpers ──────────────────────────────────────────────────────────

async function resolveSummary(parsed: ParsedSession, config: Config): Promise<SessionSummary> {
  if (config.autoSave.generateSummary) {
    try {
      return await generateSummary(parsed, config.summaries);
    } catch {
      // fall through to rule-based
    }
  }
  return fallbackSummary(parsed);
}

function fallbackSummary(parsed: ParsedSession): SessionSummary {
  const projectName = path.basename(parsed.projectPath);
  const fileCount = parsed.filesCreated.length + parsed.filesModified.length;

  return {
    summary: fileCount > 0
      ? `Session in ${projectName}: modified ${fileCount} file${fileCount !== 1 ? 's' : ''}`
      : `Session in ${projectName}: ${parsed.messagesCount} message${parsed.messagesCount !== 1 ? 's' : ''}`,
    description: [
      `Worked on ${projectName} for ${parsed.duration} minute${parsed.duration !== 1 ? 's' : ''}.`,
      parsed.filesCreated.length > 0
        ? `Created ${parsed.filesCreated.length} file${parsed.filesCreated.length !== 1 ? 's' : ''}.`
        : null,
      parsed.filesModified.length > 0
        ? `Modified ${parsed.filesModified.length} file${parsed.filesModified.length !== 1 ? 's' : ''}.`
        : null,
      parsed.tokensUsed > 0
        ? `Used ${Math.round(parsed.tokensUsed / 1000)}K tokens.`
        : null,
    ].filter(Boolean).join(' '),
    tasks: [],
    nextSteps: [],
    keyDecisions: [],
    blockers: [],
    tags: [],
  };
}

function buildMemory(
  parsed: ParsedSession,
  summary: SessionSummary,
  logPath: string,
): SessionMemory {
  const completedTasks = summary.tasks.filter(t => t.status === 'completed');
  const pendingTasks   = summary.tasks.filter(t => t.status !== 'completed');

  return {
    id:                   generateId(),
    claudeSessionId:      parsed.claudeSessionId,
    projectPath:          parsed.projectPath,
    projectName:          path.basename(parsed.projectPath),
    startedAt:            parsed.startTime,
    endedAt:              parsed.endTime,
    duration:             parsed.duration,
    summary:              summary.summary,
    description:          summary.description,
    tasks:                summary.tasks,
    tasksCompleted:       completedTasks.length,
    tasksPending:         pendingTasks.length,
    filesCreated:         parsed.filesCreated,
    filesModified:        parsed.filesModified,
    filesDeleted:         parsed.filesDeleted,
    lastUserMessage:      parsed.userMessages.at(-1) ?? '',
    lastAssistantMessage: (parsed.assistantMessages.at(-1) ?? '').slice(0, 1000),
    nextSteps:            summary.nextSteps,
    keyDecisions:         summary.keyDecisions,
    blockers:             summary.blockers,
    tokensUsed:           parsed.tokensUsed,
    messagesCount:        parsed.messagesCount,
    toolCallsCount:       parsed.toolCalls.length,
    tags:                 summary.tags,   // tag appended by caller after this returns
    archived:             false,
    logFile:              logPath,
  };
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
npx jest tests/hooks/snapshot.test.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 1.5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 1.6: Commit**

```bash
git add src/hooks/snapshot.ts tests/hooks/snapshot.test.ts
git commit -m "feat(snapshot): add saveSnapshot() shared helper with upsert logic"
```

---

### Task 2: Create `src/hooks/notification.ts` — Notification hook handler

**Files:**
- Create: `src/hooks/notification.ts`
- Create: `tests/hooks/notification.test.ts`

- [ ] **Step 2.1: Write failing tests**

Create `tests/hooks/notification.test.ts`:

```typescript
/**
 * Tests for the Notification hook handler
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleNotification } from '../../src/hooks/notification';
import { SessionStore } from '../../src/store/sessions';
import type { Config } from '../../src/types';

const testConfig: Config = {
  version: 1,
  retention: { fullSessions: '1y', archives: 'forever', searchIndex: '1y', overrideClaudeRetention: false, maxStorageGb: 10 },
  autoSave: { enabled: true, intervalMinutes: 5, onSessionEnd: true, onTerminalClose: true, generateSummary: false, extractTasks: false },
  summaries: { model: 'haiku', maxLength: 500, include: [] },
  search: { enabled: true, indexFields: [], fuzzyThreshold: 0.8 },
  cloud: { enabled: false, provider: 'r2', syncIntervalMinutes: 60, syncOnSave: false, deviceId: 'test' },
  ui: { showOnStart: false, recentCount: 10, dateFormat: 'relative', theme: 'dark' },
  projects: { overrides: {} },
};

function writeMinimalJsonl(dir: string, sessionId = 'test-session-id'): string {
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  const entries = [
    JSON.stringify({ type: 'human',     timestamp: new Date().toISOString(), message: { content: 'Hi', usage: { input_tokens: 5, output_tokens: 0 } }, cwd: dir, sessionId }),
    JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: 'Hello', usage: { input_tokens: 0, output_tokens: 5 } }, cwd: dir, sessionId }),
  ];
  fs.writeFileSync(filePath, entries.join('\n') + '\n', 'utf8');
  return filePath;
}

describe('handleNotification', () => {
  const tmpDir = path.join(os.tmpdir(), `notif-test-${Date.now()}`);
  const dbPath  = path.join(tmpDir, 'test.db');
  let store: SessionStore;

  beforeAll(() => { fs.mkdirSync(tmpDir, { recursive: true }); });

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    store = new SessionStore(dbPath);
  });

  afterEach(() => { store.close(); });

  afterAll(() => { fs.rmSync(tmpDir, { recursive: true }); });

  it('saves session tagged pre-compact when message contains "compact"', async () => {
    writeMinimalJsonl(tmpDir, 'test-session-id');

    const payload = {
      hook_event_name: 'Notification',
      session_id: 'test-session-id',
      cwd: tmpDir,
      params: { message: 'Context was compacted. Previous conversation history is summarized.' },
    };

    await handleNotification(payload, store, testConfig);

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].tags).toContain('pre-compact');
  });

  it('does nothing when message does not contain "compact"', async () => {
    writeMinimalJsonl(tmpDir, 'other-session');

    const payload = {
      hook_event_name: 'Notification',
      session_id: 'other-session',
      cwd: tmpDir,
      params: { message: 'Some other notification message' },
    };

    await handleNotification(payload, store, testConfig);

    expect(store.getAll()).toHaveLength(0);
  });

  it('does nothing when hook_event_name is not Notification', async () => {
    const payload = {
      hook_event_name: 'Stop',
      session_id: 'x',
      cwd: tmpDir,
      params: { message: 'compacted' },
    };

    await handleNotification(payload, store, testConfig);

    expect(store.getAll()).toHaveLength(0);
  });

  it('does nothing when params.message is absent', async () => {
    const payload = {
      hook_event_name: 'Notification',
      session_id: 'x',
      cwd: tmpDir,
      params: {},
    };

    await handleNotification(payload as never, store, testConfig);

    expect(store.getAll()).toHaveLength(0);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npx jest tests/hooks/notification.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../../src/hooks/notification'`

- [ ] **Step 2.3: Create `src/hooks/notification.ts`**

```typescript
/**
 * Notification hook handler for cc-sessions.
 *
 * Fires when Claude Code sends a Notification event.
 * Detects context compaction and snapshots the current session.
 *
 * Entry point: cc-sessions notify (reads JSON from stdin, always exits 0)
 */

import { loadConfig } from '../config/loader';
import { SessionStore } from '../store/sessions';
import { findCurrentSessionLog } from './utils';
import { saveSnapshot } from './snapshot';
import type { Config } from '../types';

interface NotificationPayload {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  params?: {
    message?: string;
  };
}

const DEBUG = !!process.env.CC_MEMORY_DEBUG;

function dbg(msg: string): void {
  if (DEBUG) process.stderr.write('cc-sessions: ' + msg + '\n');
}

/**
 * Handle a parsed Notification payload.
 * Exported for unit testing — CLI entry point passes in store + config.
 */
export async function handleNotification(
  payload: NotificationPayload,
  store: SessionStore,
  config: Config,
): Promise<void> {
  if (payload.hook_event_name !== 'Notification') {
    return;
  }

  const message = payload.params?.message ?? '';
  if (!/compact/i.test(message)) {
    dbg('Notification: not a compaction event, skipping');
    return;
  }

  const logPath = findCurrentSessionLog(payload.session_id, payload.cwd);
  if (!logPath) {
    dbg('Notification: no session log found');
    return;
  }

  await saveSnapshot(logPath, store, config, 'pre-compact');
  dbg('Snapshot saved (pre-compact)');
}

/**
 * CLI entry point: cc-sessions notify
 * Reads JSON from stdin, handles compaction, always exits 0.
 */
export default async function notificationHook(): Promise<void> {
  try {
    const rawInput = await readStdin();
    let payload: NotificationPayload;

    try {
      payload = JSON.parse(rawInput) as NotificationPayload;
    } catch {
      dbg('Failed to parse stdin as JSON');
      return;
    }

    const config = await loadConfig();
    const store  = new SessionStore();

    try {
      await handleNotification(payload, store, config);
    } finally {
      store.close();
    }
  } catch (err) {
    dbg('Error: ' + (err instanceof Error ? err.message : String(err)));
    // Always exit 0 — never interrupt the user's Claude Code session
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
npx jest tests/hooks/notification.test.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 2.5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 2.6: Commit**

```bash
git add src/hooks/notification.ts tests/hooks/notification.test.ts
git commit -m "feat(hooks): add Notification hook handler for auto-snapshot on compaction"
```

---

### Task 3: Add `save` and `notify` sub-commands to `src/cli.ts`

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 3.1: Add the `notify` command**

Open `src/cli.ts`. After the import block at the top, add:

```typescript
import notificationHook from './hooks/notification';
```

Add this command block after the `import` command block (before `program.parse()`):

```typescript
/**
 * Notify command — internal hook entry point (cc-sessions notify)
 * Reads a Notification JSON payload from stdin and snapshots the session
 * if compaction is detected. Always exits 0. Not intended for direct user use.
 */
program
  .command('notify')
  .description('Internal: handle a Claude Code Notification hook event (reads JSON from stdin)')
  .action(async () => {
    await notificationHook();
  });
```

- [ ] **Step 3.2: Add the `save` command**

Add these imports after the existing imports in `src/cli.ts`:

```typescript
import { saveSnapshot } from './hooks/snapshot';
import { findCurrentSessionLog } from './hooks/utils';
```

Add this command block (after `notify`, before `program.parse()`):

```typescript
/**
 * Save command — snapshot the current session before /clear
 *
 * Usage:
 *   cc-sessions save                    # most recently modified JSONL
 *   cc-sessions save <claude-session-id> # specific session by ID
 */
program
  .command('save [claudeSessionId]')
  .description('Snapshot the current session (run before /clear to preserve context)')
  .action(async (claudeSessionId?: string) => {
    const config = await loadConfig();
    const store  = new SessionStore();

    try {
      const logPath = findCurrentSessionLog(claudeSessionId ?? '', process.cwd());

      if (!logPath) {
        console.error('⚠️  No session log found — run this command from your project directory');
        process.exit(1);
      }

      await saveSnapshot(logPath, store, config, 'snapshot');

      // Read back the saved session to display its claudeSessionId
      const sessions = store.getRecent(1);
      const savedId  = sessions[0]?.claudeSessionId ?? logPath;
      console.log(`✅ Session saved: ${savedId} (pre-clear snapshot)`);
    } catch (err) {
      console.error('❌ Save failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    } finally {
      store.close();
    }
  });
```

- [ ] **Step 3.3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3.4: Smoke-test the commands exist**

```bash
npx ts-node src/cli.ts --help 2>&1 | grep -E 'save|notify'
```

Expected output includes:
```
  save [claudeSessionId]   Snapshot the current session...
  notify                   Internal: handle a Claude Code Notification...
```

- [ ] **Step 3.5: Run all tests to confirm nothing regressed**

```bash
npx jest --no-coverage
```

Expected: all existing tests still pass

- [ ] **Step 3.6: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add 'save' and 'notify' sub-commands"
```

---

## Chunk 2: Frontend — UI tag badges, resume block, slash command skill, docs

---

### Task 4: Add tag badges to session cards in `src/server/ui.ts`

**Files:**
- Modify: `src/server/ui.ts`
- Create: `tests/server/ui-badges.test.ts`

- [ ] **Step 4.1: Write failing test**

Create `tests/server/ui-badges.test.ts`:

```typescript
/**
 * Tests that the UI HTML includes tag badge CSS and rendering logic
 */
import { getUIHtml } from '../../src/server/ui';

describe('UI tag badges', () => {
  let html: string;

  beforeAll(() => {
    html = getUIHtml();
  });

  it('includes .tag-badge CSS class', () => {
    expect(html).toContain('.tag-badge');
  });

  it('references pre-compact badge text in JS', () => {
    expect(html).toContain('pre-compact');
  });

  it('references snapshot badge text in JS', () => {
    expect(html).toContain('snapshot');
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
npx jest tests/server/ui-badges.test.ts --no-coverage
```

Expected: FAIL — `.tag-badge` not in HTML

- [ ] **Step 4.3: Add `.tag-badge` CSS to `src/server/ui.ts`**

Locate the `/* ── Shared ───` CSS comment block. Insert the new class immediately before it:

```css
    /* ── Tag badges ──────────────────────────────────────────────── */
    .tag-badge {
      background: #2a2420; border: 1px solid #5a3a20;
      border-radius: 4px; padding: 2px 6px; font-size: 10px;
      color: var(--accent); flex-shrink: 0;
    }
```

- [ ] **Step 4.4: Add tag badge rendering to `buildSessionCard()`**

Locate the `buildSessionCard` function in the `<script>` block. After the line that appends `meta` to the card (`card.appendChild(meta);` or the line building meta), add:

```javascript
  // Tag badges (pre-compact, snapshot)
  var KNOWN_TAGS = { 'pre-compact': '\uD83D\uDCF8 pre-compact', 'snapshot': '\uD83D\uDCCC snapshot' };
  var tagKeys = Object.keys(KNOWN_TAGS);
  if (s.tags && s.tags.length > 0) {
    for (var ti = 0; ti < tagKeys.length; ti++) {
      if (s.tags.indexOf(tagKeys[ti]) !== -1) {
        meta.appendChild(h('span', { class: 'tag-badge', text: KNOWN_TAGS[tagKeys[ti]] }));
      }
    }
  }
```

Place this block right before `card.appendChild(meta);` so the badges appear in the meta row.

- [ ] **Step 4.5: Run tests to verify they pass**

```bash
npx jest tests/server/ui-badges.test.ts --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 4.6: Commit**

```bash
git add src/server/ui.ts tests/server/ui-badges.test.ts
git commit -m "feat(ui): add tag badges for pre-compact and snapshot sessions"
```

---

### Task 5: Add "Resume in Claude Code" section to session detail in `src/server/ui.ts`

**Files:**
- Modify: `src/server/ui.ts`
- Create: `tests/server/ui-resume.test.ts`

- [ ] **Step 5.1: Write failing tests**

Create `tests/server/ui-resume.test.ts`:

```typescript
/**
 * Tests that the UI HTML includes resume block CSS and JS
 */
import { getUIHtml } from '../../src/server/ui';

describe('UI resume block', () => {
  let html: string;

  beforeAll(() => { html = getUIHtml(); });

  it('includes .resume-block CSS class', () => {
    expect(html).toContain('.resume-block');
  });

  it('includes .resume-copy-btn CSS class', () => {
    expect(html).toContain('.resume-copy-btn');
  });

  it('includes claude --resume in JS', () => {
    expect(html).toContain('claude --resume');
  });

  it('includes clipboard copy logic', () => {
    expect(html).toContain('navigator.clipboard');
    expect(html).toContain('execCommand');    // fallback
  });

  it('includes "Resume in Claude Code" section title', () => {
    expect(html).toContain('RESUME IN CLAUDE CODE');
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
npx jest tests/server/ui-resume.test.ts --no-coverage
```

Expected: FAIL

- [ ] **Step 5.3: Add resume CSS to `src/server/ui.ts`**

In the `<style>` block, after the `.tag-badge` block you added in Task 4, add:

```css
    /* ── Resume block ─────────────────────────────────────────────── */
    .resume-block {
      background: #1a1a1a; border: 1px solid var(--border);
      border-radius: 6px; padding: 12px 16px; margin-bottom: 16px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .resume-cmd {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }
    .resume-cmd-text {
      font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; color: var(--text);
    }
    .resume-copy-btn {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 4px; padding: 3px 10px; font-size: 11px;
      color: var(--muted); cursor: pointer; flex-shrink: 0;
      transition: color .12s, border-color .12s;
    }
    .resume-copy-btn:hover { color: var(--text); border-color: #555; }
    .resume-hint { font-size: 11px; color: var(--dim); }
```

- [ ] **Step 5.4: Add clipboard helpers to the `<script>` block**

In the `<script>` block, after the `txt()` function definition (near the top of the script), add:

```javascript
/* ─── clipboard helpers ──────────────────────────────────────────────────── */
function copyToClipboard(text, btn) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      showCopied(btn);
    }).catch(function() {
      fallbackCopy(text, btn);
    });
  } else {
    fallbackCopy(text, btn);
  }
}

function fallbackCopy(text, btn) {
  var inp = document.createElement('input');
  inp.style.cssText = 'position:fixed;opacity:0';
  inp.value = text;
  document.body.appendChild(inp);
  inp.select();
  try { document.execCommand('copy'); showCopied(btn); } catch(e) {}
  document.body.removeChild(inp);
}

function showCopied(btn) {
  var orig = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(function() { btn.textContent = orig; }, 1500);
}
```

- [ ] **Step 5.5: Add resume block to `openDetail()` in the `<script>` block**

In `openDetail()`, locate the footer block:

```javascript
    // Footer
    var footer = h('div', { class: 'detail-id' });
    footer.textContent = 'Session ID: ' + s.id;
    body.appendChild(footer);
```

**Insert before the footer block:**

```javascript
    // Resume in Claude Code
    if (s.claudeSessionId) {
      var resumeCmd = 'claude --resume ' + s.claudeSessionId;
      var copyBtn = h('button', {
        class: 'resume-copy-btn',
        text: 'Copy',
        click: function() { copyToClipboard(resumeCmd, copyBtn); }
      });
      var resumeBlock = h('div', { class: 'resume-block' },
        h('div', { class: 'detail-section-title', text: 'RESUME IN CLAUDE CODE' }),
        h('div', { class: 'resume-cmd' },
          h('span', { class: 'resume-cmd-text', text: resumeCmd }),
          copyBtn
        ),
        h('div', { class: 'resume-hint', text: 'Open this session exactly where it was saved' })
      );
      body.appendChild(resumeBlock);
    }
```

- [ ] **Step 5.6: Run all UI tests**

```bash
npx jest tests/server/ --no-coverage
```

Expected: PASS — all tests in `tests/server/` pass (including pre-existing `api.test.ts`)

- [ ] **Step 5.7: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 5.8: Commit**

```bash
git add src/server/ui.ts tests/server/ui-resume.test.ts
git commit -m "feat(ui): add 'Resume in Claude Code' section with copy button to session detail"
```

---

### Task 6: Create slash command skill file

**Files:**
- Create: `~/.claude/skills/sessions-snapshot.md`

> **Note:** This file is written to the user's global `~/.claude/skills/` directory, not the project directory. It is not tracked in this repo.

- [ ] **Step 6.1: Create the skill file**

```bash
mkdir -p ~/.claude/skills
cat > ~/.claude/skills/sessions-snapshot.md << 'EOF'
---
name: sessions-snapshot
description: Save the current Claude Code session before running /clear. Use when the user wants to snapshot their session, or before clearing context.
---

Run this command in the terminal to save the current session:

```bash
cc-sessions save
```

Show the full output to the user. If it prints `✅ Session saved:`, the snapshot was successful and the user can safely run `/clear`. If it prints `⚠️ No session log found`, advise the user to run the command from their project directory.
EOF
```

- [ ] **Step 6.2: Verify file was created**

```bash
cat ~/.claude/skills/sessions-snapshot.md
```

Expected: full skill file content is shown

---

### Task 7: Update `docs/commands.md`

**Files:**
- Modify: `docs/commands.md`

- [ ] **Step 7.1: Add `cc-sessions save` documentation**

Open `docs/commands.md`. Find the `## cc-sessions import` section. Insert the following **before** it:

```markdown
---

## cc-sessions save

Snapshot the current session immediately — run this before `/clear` to preserve your context.

```bash
cc-sessions save [claude-session-id]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `claude-session-id` | Optional. Session UUID to snapshot. Defaults to the most recently active session. |

### Examples

```bash
# Save the current session (most recently active)
cc-sessions save

# Save a specific session by its Claude session ID
cc-sessions save abc123-def456
```

### Output

```
✅ Session saved: abc123-def456 (pre-clear snapshot)
```

### When to use

Run this command before typing `/clear` in Claude Code. The saved snapshot will appear in the sessions UI with a 📌 snapshot badge, and you can resume it later with `claude --resume <id>`.

### Session tags

Sessions saved with this command are tagged `snapshot` in the database. Sessions saved automatically via context compaction are tagged `pre-compact`.

```

- [ ] **Step 7.2: Verify docs build (or just diff)**

```bash
git diff docs/commands.md | head -60
```

Expected: shows the new `cc-sessions save` section added

- [ ] **Step 7.3: Commit**

```bash
git add docs/commands.md
git commit -m "docs: add cc-sessions save command documentation"
```

---

### Task 8: Final integration check

- [ ] **Step 8.1: Build the project**

```bash
npm run build
```

Expected: no TypeScript errors, `dist/` populated

- [ ] **Step 8.2: Run the full test suite with coverage**

```bash
npm test -- --coverage
```

Expected: all tests pass; coverage ≥ 70% on branches/functions/lines/statements

- [ ] **Step 8.3: Verify `cc-sessions save` command works end-to-end**

```bash
node dist/cli.js save --help
```

Expected: shows usage for `save` command

- [ ] **Step 8.4: Verify `cc-sessions notify` command exists**

```bash
node dist/cli.js notify --help
```

Expected: shows usage for `notify` command

- [ ] **Step 8.5: Final commit if any loose ends**

```bash
git status
```

If there are uncommitted changes, commit them. Otherwise:

```bash
git log --oneline -8
```

Expected: shows the new commits from Tasks 1–7 in order

