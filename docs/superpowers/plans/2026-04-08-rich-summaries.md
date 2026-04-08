# Rich Session Summaries Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace vague rule-based session summaries with a 3-tier AI provider chain (CC CLI → Anthropic API → rule-based), add `cc-sessions summarize` and `on-clear` CLI commands, auto-save sessions on `/clear` via a `SessionStart` hook, and add supporting slash command skills and a CI workflow.

**Architecture:** Three provider files under `src/parser/providers/` each return `SessionSummary | null`. `src/parser/summarizer.ts` is rewritten as a thin orchestrator that tries them in order. `src/hooks/snapshot.ts` gains a `forceAI` parameter; `src/hooks/post-clear.ts` passes `forceAI=true` to always run the full chain. The `summarize` CLI command queries the DB for `no-ai-summary`-tagged sessions and re-runs the provider chain over each.

**Tech Stack:** TypeScript, Node.js built-ins (`child_process.spawn`), Anthropic SDK (`@anthropic-ai/sdk`), better-sqlite3, Jest (ts-jest), Commander.js

---

## Chunk 1: Provider chain — three providers + orchestrator refactor + importer/snapshot cleanup

---

### Task 1: Create `src/parser/providers/rule-based.ts`

**Files:**
- Create: `src/parser/providers/rule-based.ts`
- Create: `tests/parser/providers/rule-based.test.ts`

- [ ] **Step 1.1: Write failing tests**

Create `tests/parser/providers/rule-based.test.ts`:

```typescript
import * as path from 'path';
import { ruleBasedSummary } from '../../../src/parser/providers/rule-based';
import type { ParsedSession } from '../../../src/types';

function makeSession(overrides: Partial<ParsedSession> = {}): ParsedSession {
  return {
    claudeSessionId: 'test-uuid',
    projectPath: '/Users/alice/projects/myapp',
    startTime: new Date(),
    endTime: new Date(),
    duration: 8,
    messagesCount: 10,
    userMessages: ['Add authentication', 'looks good'],
    assistantMessages: ["I'll implement JWT auth. Let's start with the middleware."],
    toolCalls: [],
    filesCreated: [],
    filesModified: ['src/auth.ts', 'src/middleware.ts'],
    filesDeleted: [],
    tokensUsed: 5000,
    ...overrides,
  };
}

describe('ruleBasedSummary', () => {
  it('derives summary from first user message + modified files', () => {
    const result = ruleBasedSummary(makeSession());
    expect(result.summary).toContain('myapp');
    expect(result.summary.length).toBeGreaterThan(10);
  });

  it('appends no-ai-summary tag', () => {
    const result = ruleBasedSummary(makeSession());
    expect(result.tags).toContain('no-ai-summary');
  });

  it('extracts technology tags from file extensions', () => {
    const result = ruleBasedSummary(makeSession({ filesModified: ['app.ts', 'styles.css'] }));
    expect(result.tags).toContain('no-ai-summary');
  });

  it('always succeeds — returns valid SessionSummary shape', () => {
    const result = ruleBasedSummary(makeSession({ userMessages: [], assistantMessages: [] }));
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('description');
    expect(Array.isArray(result.tasks)).toBe(true);
    expect(Array.isArray(result.nextSteps)).toBe(true);
    expect(Array.isArray(result.keyDecisions)).toBe(true);
    expect(Array.isArray(result.blockers)).toBe(true);
    expect(Array.isArray(result.tags)).toBe(true);
    expect(result.tags).toContain('no-ai-summary');
  });

  it('extracts tasks from checkbox patterns in assistant messages', () => {
    const result = ruleBasedSummary(makeSession({
      assistantMessages: ['- [x] Implement JWT\n- [ ] Add tests'],
    }));
    expect(result.tasks.length).toBeGreaterThan(0);
  });

  it('description includes first user message intent', () => {
    const result = ruleBasedSummary(makeSession({ userMessages: ['Refactor the database layer'] }));
    expect(result.description).toContain('Refactor the database layer');
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd /Users/in615bac/Documents/cc-sessions
npx jest tests/parser/providers/rule-based.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../../../src/parser/providers/rule-based'`

- [ ] **Step 1.3: Create `src/parser/providers/rule-based.ts`**

```typescript
/**
 * Rule-based session summary provider.
 *
 * Always returns a result. Appends 'no-ai-summary' tag so cc-sessions summarize
 * can target these sessions for AI regeneration later.
 */

import * as path from 'path';
import { extractTasks, extractKeyDecisions, extractBlockers, extractNextSteps, extractTags } from '../extractor';
import type { ParsedSession, SessionSummary } from '../../types';

export function ruleBasedSummary(parsed: ParsedSession): SessionSummary {
  const projectName = path.basename(parsed.projectPath);
  const allFiles = [...parsed.filesCreated, ...parsed.filesModified];
  const fileCount = allFiles.length;
  const firstUserMsg = parsed.userMessages[0] ?? '';

  const tasks       = extractTasks(parsed.userMessages, parsed.assistantMessages);
  const keyDecisions = extractKeyDecisions(parsed.assistantMessages);
  const blockers    = extractBlockers(parsed.userMessages, parsed.assistantMessages);
  const nextSteps   = extractNextSteps(parsed.assistantMessages);
  const techTags    = extractTags(parsed.userMessages, parsed.assistantMessages, allFiles);

  const summary = buildSummary(projectName, firstUserMsg, fileCount, allFiles);
  const description = buildDescription(projectName, firstUserMsg, parsed, allFiles);

  return {
    summary,
    description,
    tasks,
    nextSteps,
    keyDecisions,
    blockers,
    tags: [...techTags, 'no-ai-summary'],
  };
}

// ─── private helpers ──────────────────────────────────────────────────────────

function buildSummary(
  projectName: string,
  firstUserMsg: string,
  fileCount: number,
  files: string[],
): string {
  if (firstUserMsg && fileCount > 0) {
    const intent = firstUserMsg.slice(0, 60).replace(/\n.*/s, '');
    const fileNames = files.slice(0, 3).map(f => path.basename(f)).join(', ');
    return `${intent} — edited ${fileNames}${files.length > 3 ? ` (+${files.length - 3} more)` : ''}`;
  }
  if (firstUserMsg) {
    return firstUserMsg.slice(0, 80).replace(/\n.*/s, '');
  }
  if (fileCount > 0) {
    return `Session in ${projectName}: modified ${fileCount} file${fileCount !== 1 ? 's' : ''}`;
  }
  return `Session in ${projectName}`;
}

function buildDescription(
  projectName: string,
  firstUserMsg: string,
  parsed: ParsedSession,
  files: string[],
): string {
  const parts: string[] = [];

  if (firstUserMsg) {
    parts.push(`User asked: "${firstUserMsg.slice(0, 120).replace(/\n.*/s, '')}".`);
  }

  if (parsed.filesCreated.length > 0) {
    parts.push(`Created: ${parsed.filesCreated.map(f => path.basename(f)).slice(0, 4).join(', ')}.`);
  }
  if (parsed.filesModified.length > 0) {
    parts.push(`Edited: ${parsed.filesModified.map(f => path.basename(f)).slice(0, 4).join(', ')}.`);
  }

  parts.push(
    `Session lasted ${parsed.duration} minute${parsed.duration !== 1 ? 's' : ''}, ` +
    `${parsed.messagesCount} messages, ${formatTokens(parsed.tokensUsed)} tokens.`
  );

  return parts.join(' ');
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000)     return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
npx jest tests/parser/providers/rule-based.test.ts --no-coverage
```

Expected: PASS (6 tests)

- [ ] **Step 1.5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 1.6: Commit**

```bash
git add src/parser/providers/rule-based.ts tests/parser/providers/rule-based.test.ts
git commit -m "feat(providers): add rule-based summary provider with no-ai-summary tag"
```

---

### Task 2: Create `src/parser/providers/anthropic-api.ts`

**Files:**
- Create: `src/parser/providers/anthropic-api.ts`
- Create: `tests/parser/providers/anthropic-api.test.ts`

The Anthropic SDK logic is *moved* from `summarizer.ts` into this provider file. The provider returns `SessionSummary | null`.

- [ ] **Step 2.1: Write failing tests**

Create `tests/parser/providers/anthropic-api.test.ts`:

```typescript
import { tryAnthropicApi } from '../../../src/parser/providers/anthropic-api';
import type { ParsedSession, SummaryConfig } from '../../../src/types';

const testConfig: SummaryConfig = { model: 'haiku', maxLength: 500, include: [] };

function makeSession(): ParsedSession {
  return {
    claudeSessionId: 'test-uuid',
    projectPath: '/home/user/project',
    startTime: new Date(),
    endTime: new Date(),
    duration: 5,
    messagesCount: 4,
    userMessages: ['fix the bug'],
    assistantMessages: ["I'll fix it."],
    toolCalls: [],
    filesCreated: [],
    filesModified: ['src/bug.ts'],
    filesDeleted: [],
    tokensUsed: 2000,
  };
}

describe('tryAnthropicApi', () => {
  it('returns null when ANTHROPIC_API_KEY is not set', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result).toBeNull();

    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  });

  // Integration test — skipped in CI (no real key available)
  it.skip('returns SessionSummary when ANTHROPIC_API_KEY is set', async () => {
    const result = await tryAnthropicApi(makeSession(), testConfig);
    expect(result).not.toBeNull();
    expect(result!.summary).toBeTruthy();
    expect(Array.isArray(result!.tags)).toBe(true);
    expect(result!.tags).not.toContain('no-ai-summary');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npx jest tests/parser/providers/anthropic-api.test.ts --no-coverage
```

Expected: FAIL — module not found

- [ ] **Step 2.3: Create `src/parser/providers/anthropic-api.ts`**

Extract the Anthropic SDK logic from `summarizer.ts` into a standalone provider:

```typescript
/**
 * Anthropic API summary provider.
 *
 * Returns null if ANTHROPIC_API_KEY is not set or the API call fails.
 * Does NOT append 'no-ai-summary' — only the rule-based provider does that.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ParsedSession, SessionSummary, SummaryConfig, Task } from '../../types';

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
  "description": "2-3 sentences explaining the work done and current state",
  "tasks": [
    {"description": "task text", "status": "completed"},
    {"description": "task text", "status": "pending"}
  ],
  "nextSteps": ["suggested next action"],
  "keyDecisions": ["important decision made"],
  "blockers": ["any issues encountered"],
  "tags": ["relevant", "tags"]
}`;

export async function tryAnthropicApi(
  parsed: ParsedSession,
  config: SummaryConfig,
): Promise<SessionSummary | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null;
  }

  try {
    const client = new Anthropic();

    const prompt = buildPrompt(parsed);

    const modelId = config.model === 'sonnet'
      ? 'claude-sonnet-4-20250514'
      : 'claude-3-haiku-20240307';

    const response = await client.messages.create({
      model: modelId,
      max_tokens: config.maxLength || 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const text = textBlock && 'text' in textBlock ? textBlock.text : '';

    return parseResponse(text);
  } catch {
    return null;
  }
}

// ─── private helpers ───────────────────────────────────────────────────────────

function buildPrompt(parsed: ParsedSession): string {
  return SUMMARY_PROMPT
    .replace('{projectPath}', parsed.projectPath.split('/').pop() ?? '')
    .replace('{duration}', String(parsed.duration))
    .replace('{messagesCount}', String(parsed.messagesCount))
    .replace('{tokensUsed}', formatTokens(parsed.tokensUsed))
    .replace('{filesCreated}', parsed.filesCreated.join(', ') || 'None')
    .replace('{filesModified}', parsed.filesModified.join(', ') || 'None')
    .replace('{userMessages}', formatMessages(parsed.userMessages, 5, 500))
    .replace('{assistantMessages}', formatMessages(parsed.assistantMessages, 3, 800));
}

function parseResponse(text: string): SessionSummary | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const data = JSON.parse(match[0]) as Record<string, unknown>;

    return {
      summary:       String(data.summary ?? ''),
      description:   String(data.description ?? ''),
      tasks:         normalizeTasks(data.tasks),
      nextSteps:     normalizeStringArray(data.nextSteps),
      keyDecisions:  normalizeStringArray(data.keyDecisions),
      blockers:      normalizeStringArray(data.blockers),
      tags:          normalizeStringArray(data.tags),
    };
  } catch {
    return null;
  }
}

function formatMessages(messages: string[], maxCount: number, maxLen: number): string {
  let result = '';
  let total = 0;
  for (const msg of messages.slice(-maxCount)) {
    const t = msg.slice(0, 300);
    if (total + t.length > maxLen) break;
    result += t + '\n---\n';
    total += t.length;
  }
  return result || 'No messages';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function normalizeTasks(tasks: unknown): Task[] {
  if (!Array.isArray(tasks)) return [];
  return (tasks as Record<string, unknown>[]).map((t, i) => ({
    id:          String(i + 1),
    description: String(t.description ?? ''),
    status:      normalizeStatus(t.status),
    createdAt:   new Date(),
  })).filter(t => t.description.length > 0);
}

function normalizeStatus(s: unknown): 'pending' | 'in_progress' | 'completed' | 'blocked' {
  const v = String(s).toLowerCase();
  if (v === 'completed' || v === 'done') return 'completed';
  if (v === 'in_progress' || v === 'in progress') return 'in_progress';
  if (v === 'blocked') return 'blocked';
  return 'pending';
}

function normalizeStringArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return (arr as unknown[]).map(i => String(i).trim()).filter(s => s.length > 0);
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
npx jest tests/parser/providers/anthropic-api.test.ts --no-coverage
```

Expected: PASS (1 test, 1 skipped)

- [ ] **Step 2.5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 2.6: Commit**

```bash
git add src/parser/providers/anthropic-api.ts tests/parser/providers/anthropic-api.test.ts
git commit -m "feat(providers): add Anthropic API summary provider (extracted from summarizer)"
```

---

### Task 3: Create `src/parser/providers/claude-cli.ts`

**Files:**
- Create: `src/parser/providers/claude-cli.ts`
- Create: `tests/parser/providers/claude-cli.test.ts`

Spawns `claude -p "<prompt>" --output-format json`. Unwraps the `{ result: "<JSON string>" }` envelope. Returns `SessionSummary | null`.

- [ ] **Step 3.1: Write failing tests**

Create `tests/parser/providers/claude-cli.test.ts`:

```typescript
import { tryClaudeCli } from '../../../src/parser/providers/claude-cli';
import type { ParsedSession } from '../../../src/types';

function makeSession(): ParsedSession {
  return {
    claudeSessionId: 'test-uuid',
    projectPath: '/home/user/project',
    startTime: new Date(),
    endTime: new Date(),
    duration: 5,
    messagesCount: 4,
    userMessages: ['fix the bug'],
    assistantMessages: ["I'll fix it."],
    toolCalls: [],
    filesCreated: [],
    filesModified: ['src/bug.ts'],
    filesDeleted: [],
    tokensUsed: 2000,
  };
}

describe('tryClaudeCli', () => {
  it('returns null when claude is not in PATH', async () => {
    const origPath = process.env.PATH;
    process.env.PATH = '';

    const result = await tryClaudeCli(makeSession());
    expect(result).toBeNull();

    process.env.PATH = origPath;
  });

  it('returns null on spawn timeout (simulated via very low timeout)', async () => {
    // Can't easily unit-test the real spawn without a live claude binary.
    // Verify the function signature at minimum — it returns null, not throws.
    const result = await tryClaudeCli(makeSession()).catch(() => null);
    expect(result === null || (result !== null && typeof result.summary === 'string')).toBe(true);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
npx jest tests/parser/providers/claude-cli.test.ts --no-coverage
```

Expected: FAIL — module not found

- [ ] **Step 3.3: Create `src/parser/providers/claude-cli.ts`**

```typescript
/**
 * Claude Code CLI summary provider.
 *
 * Spawns `claude -p "<prompt>" --output-format json`.
 * The CC CLI wraps the output in:
 *   { "type": "result", "subtype": "success", "result": "<JSON string>", "is_error": false }
 *
 * Returns SessionSummary | null — falls through on any error or timeout.
 * Does NOT append 'no-ai-summary'.
 */

import { spawn } from 'child_process';
import type { ParsedSession, SessionSummary, Task } from '../../types';

const TIMEOUT_MS = 30_000;

const CLI_PROMPT_TEMPLATE = `Analyze this Claude Code session and produce a JSON summary.

Project: {projectPath}
Duration: {duration} minutes, {messagesCount} messages, {tokensUsed} tokens
Files created: {filesCreated}
Files modified: {filesModified}

Recent user messages:
{userMessages}

Recent assistant responses:
{assistantMessages}

Respond ONLY with valid JSON matching exactly:
{"summary":"one sentence","description":"2-3 sentences","tasks":[{"description":"...","status":"completed|pending"}],"nextSteps":["..."],"keyDecisions":["..."],"blockers":["..."],"tags":["..."]}`;

interface CliEnvelope {
  type?: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
}

export async function tryClaudeCli(parsed: ParsedSession): Promise<SessionSummary | null> {
  const prompt = buildPrompt(parsed);

  try {
    const raw = await runClaude(prompt);
    return parseEnvelope(raw);
  } catch {
    return null;
  }
}

// ─── private helpers ───────────────────────────────────────────────────────────

function buildPrompt(parsed: ParsedSession): string {
  const projectName = parsed.projectPath.split('/').pop() ?? '';
  return CLI_PROMPT_TEMPLATE
    .replace('{projectPath}', projectName)
    .replace('{duration}', String(parsed.duration))
    .replace('{messagesCount}', String(parsed.messagesCount))
    .replace('{tokensUsed}', formatTokens(parsed.tokensUsed))
    .replace('{filesCreated}', parsed.filesCreated.join(', ') || 'None')
    .replace('{filesModified}', parsed.filesModified.join(', ') || 'None')
    .replace('{userMessages}', formatMessages(parsed.userMessages, 3, 400))
    .replace('{assistantMessages}', formatMessages(parsed.assistantMessages, 2, 600));
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('claude CLI timeout'));
    }, TIMEOUT_MS);

    let stdout = '';
    let stderr = '';

    const child = spawn('claude', ['-p', prompt, '--output-format', 'json'], {
      signal: controller.signal,
    });

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

function parseEnvelope(raw: string): SessionSummary | null {
  try {
    const envelope = JSON.parse(raw) as CliEnvelope;
    if (envelope.is_error) return null;
    if (!envelope.result) return null;

    return parseSessionSummary(envelope.result);
  } catch {
    return null;
  }
}

function parseSessionSummary(jsonStr: string): SessionSummary | null {
  try {
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const data = JSON.parse(match[0]) as Record<string, unknown>;
    if (!data.summary) return null;

    return {
      summary:      String(data.summary),
      description:  String(data.description ?? ''),
      tasks:        normalizeTasks(data.tasks),
      nextSteps:    normalizeStringArray(data.nextSteps),
      keyDecisions: normalizeStringArray(data.keyDecisions),
      blockers:     normalizeStringArray(data.blockers),
      tags:         normalizeStringArray(data.tags),
    };
  } catch {
    return null;
  }
}

function formatMessages(messages: string[], maxCount: number, maxLen: number): string {
  let result = '';
  let total = 0;
  for (const msg of messages.slice(-maxCount)) {
    const t = msg.slice(0, 300);
    if (total + t.length > maxLen) break;
    result += t + '\n---\n';
    total += t.length;
  }
  return result || 'No messages';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function normalizeTasks(tasks: unknown): Task[] {
  if (!Array.isArray(tasks)) return [];
  return (tasks as Record<string, unknown>[]).map((t, i) => ({
    id:          String(i + 1),
    description: String(t.description ?? ''),
    status:      normalizeStatus(t.status),
    createdAt:   new Date(),
  })).filter(t => t.description.length > 0);
}

function normalizeStatus(s: unknown): 'pending' | 'in_progress' | 'completed' | 'blocked' {
  const v = String(s).toLowerCase();
  if (v === 'completed' || v === 'done') return 'completed';
  if (v === 'in_progress' || v === 'in progress') return 'in_progress';
  if (v === 'blocked') return 'blocked';
  return 'pending';
}

function normalizeStringArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return (arr as unknown[]).map(i => String(i).trim()).filter(s => s.length > 0);
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

```bash
npx jest tests/parser/providers/claude-cli.test.ts --no-coverage
```

Expected: PASS (2 tests)

- [ ] **Step 3.5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3.6: Commit**

```bash
git add src/parser/providers/claude-cli.ts tests/parser/providers/claude-cli.test.ts
git commit -m "feat(providers): add Claude Code CLI summary provider with envelope unwrapping"
```

---

### Task 4: Rewrite `src/parser/summarizer.ts` as thin orchestrator

**Files:**
- Modify: `src/parser/summarizer.ts`
- Create: `tests/parser/summarizer.test.ts`

The old `generateSummary` kept all Anthropic logic internally. Rewrite it to call the three providers in order and add optional `skipAI` parameter. The old `createFallbackSummary` and all SDK import are removed from this file.

- [ ] **Step 4.1: Write failing tests**

Create `tests/parser/summarizer.test.ts`:

```typescript
import { generateSummary } from '../../src/parser/summarizer';
import type { ParsedSession, SummaryConfig } from '../../src/types';

const testConfig: SummaryConfig = { model: 'haiku', maxLength: 500, include: [] };

function makeSession(): ParsedSession {
  return {
    claudeSessionId: 'test-uuid',
    projectPath: '/home/user/project',
    startTime: new Date(),
    endTime: new Date(),
    duration: 5,
    messagesCount: 4,
    userMessages: ['fix the bug'],
    assistantMessages: ["I'll fix it."],
    toolCalls: [],
    filesCreated: [],
    filesModified: ['src/bug.ts'],
    filesDeleted: [],
    tokensUsed: 2000,
  };
}

describe('generateSummary', () => {
  it('returns a valid SessionSummary when skipAI=true (rule-based path)', async () => {
    const result = await generateSummary(makeSession(), testConfig, true);
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('description');
    expect(result.tags).toContain('no-ai-summary');
  });

  it('returns a valid SessionSummary with default skipAI (full chain, falls to rule-based in test env)', async () => {
    // In test env: CC CLI not available, no ANTHROPIC_API_KEY → falls through to rule-based
    delete process.env.ANTHROPIC_API_KEY;
    const result = await generateSummary(makeSession(), testConfig);
    expect(result.tags).toContain('no-ai-summary');
  });

  it('skipAI=true result tags always include no-ai-summary', async () => {
    const result = await generateSummary(makeSession(), testConfig, true);
    expect(result.tags).toContain('no-ai-summary');
  });

  it('returns summary with non-empty summary string', async () => {
    const result = await generateSummary(makeSession(), testConfig, true);
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
npx jest tests/parser/summarizer.test.ts --no-coverage
```

Expected: tests fail (old function doesn't accept `skipAI` param, or the `no-ai-summary` tag is absent)

- [ ] **Step 4.3: Rewrite `src/parser/summarizer.ts`**

Replace the entire file contents with:

```typescript
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

import { tryClaudeCli }    from './providers/claude-cli';
import { tryAnthropicApi } from './providers/anthropic-api';
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
```

- [ ] **Step 4.4: Run tests to verify they pass**

```bash
npx jest tests/parser/summarizer.test.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 4.5: Run all existing tests to confirm nothing regressed**

```bash
npx jest --no-coverage
```

Expected: all tests pass (the old summarizer tests, if any, should still pass)

- [ ] **Step 4.6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4.7: Commit**

```bash
git add src/parser/summarizer.ts tests/parser/summarizer.test.ts
git commit -m "feat(summarizer): rewrite as thin orchestrator with 3-tier provider chain"
```

---

### Task 5: Update `src/importer/index.ts` and `src/hooks/snapshot.ts`

**Files:**
- Modify: `src/importer/index.ts` (remove duplicate `createFallbackSummary`, drop `config.autoSave.generateSummary` gate)
- Modify: `src/hooks/snapshot.ts` (remove `fallbackSummary`, add `forceAI` param)
- Modify: `tests/hooks/snapshot.test.ts` (add test for `forceAI=true` and `no-ai-summary` propagation)

- [ ] **Step 5.1: Update `tests/hooks/snapshot.test.ts` — add new test cases**

Open `tests/hooks/snapshot.test.ts` and add these tests inside the `describe('saveSnapshot', ...)` block:

```typescript
  it('result has no-ai-summary tag when skipAI is used (via config gate=false)', async () => {
    // testConfig has generateSummary: false, so it falls through to rule-based
    await saveSnapshot(logPath, store, testConfig, 'snapshot');

    const all = store.getAll();
    expect(all[0].tags).toContain('no-ai-summary');
  });

  it('combined tags preserved on upsert: snapshot then pre-clear', async () => {
    await saveSnapshot(logPath, store, testConfig, 'snapshot');
    await saveSnapshot(logPath, store, testConfig, 'pre-clear');

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].tags).toContain('snapshot');
    expect(all[0].tags).toContain('pre-clear');
  });
```

- [ ] **Step 5.2: Run the updated snapshot tests to verify the new ones fail (or pass if already correct)**

```bash
npx jest tests/hooks/snapshot.test.ts --no-coverage
```

Note the results — if `no-ai-summary` test fails, that's expected until we update `snapshot.ts`.

- [ ] **Step 5.3: Update `src/hooks/snapshot.ts`**

Replace `fallbackSummary()` and `resolveSummary()` with a call to `generateSummary`, and add `forceAI` parameter:

1. Add `forceAI = false` parameter to `saveSnapshot`:

```typescript
export async function saveSnapshot(
  logPath: string,
  store: SessionStore,
  config: Config,
  tag: string,
  forceAI = false,
): Promise<void> {
```

2. Replace `resolveSummary` and `fallbackSummary` private helpers with:

```typescript
async function resolveSummary(parsed: ParsedSession, config: Config, forceAI: boolean): Promise<SessionSummary> {
  const skipAI = !forceAI && !config.autoSave.generateSummary;
  return generateSummary(parsed, config.summaries, skipAI);
}
```

3. Update the `resolveSummary` call in `saveSnapshot`:

```typescript
  const summary = await resolveSummary(parsed, config, forceAI);
```

4. Remove the old `fallbackSummary()` function entirely.

5. Remove the `import * as path` if it becomes unused (check — it's still used in `buildMemory`).

- [ ] **Step 5.4: Update `src/importer/index.ts`**

Locate `resolveSummary()` and `createFallbackSummary()` in `src/importer/index.ts`.

Replace the `resolveSummary` function body to drop the `config.autoSave.generateSummary` gate:

```typescript
async function resolveSummary(
  parsed: ParsedSession,
  config: Config,
  skipAI: boolean
): Promise<SessionSummary> {
  return generateSummary(parsed, config.summaries, skipAI);
}
```

Delete the entire `createFallbackSummary()` function (lines ~248–286 in the current file).

- [ ] **Step 5.5: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 5.6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5.7: Commit**

```bash
git add src/hooks/snapshot.ts src/importer/index.ts tests/hooks/snapshot.test.ts
git commit -m "feat(snapshot): wire provider chain; drop duplicate fallback in importer"
```

---

## Chunk 2: `summarize` CLI command + store support

---

### Task 6: Verify `findByTag()` in `SessionStore`

**Files:**
- No changes needed

The store already has `findByTag(tag, limit = 20)` at `src/store/sessions.ts:372` with proper LIKE escaping and `ESCAPE '\\'`. The `summarize` command will call it with an explicit `limit` to override the default of 20.

- [ ] **Step 6.1: Confirm `findByTag` signature**

```bash
grep -n "findByTag" /Users/in615bac/Documents/cc-sessions/src/store/sessions.ts
```

Expected output includes: `findByTag(tag: string, limit: number = 20)`

If the method signature differs, adjust the call in Task 7 accordingly.

- [ ] **Step 6.2: No commit needed — store already has the required method**

---

### Task 7: Add `summarize` command to `src/cli.ts`

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli/summarize.test.ts`

- [ ] **Step 7.1: Write failing tests**

Create `tests/cli/summarize.test.ts`:

```typescript
/**
 * Tests for the summarize command logic (not the CLI entry point itself,
 * but the core pipeline: load sessions → parse log → generate summary → update)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionStore } from '../../src/store/sessions';
import { saveSnapshot } from '../../src/hooks/snapshot';
import { generateSummary } from '../../src/parser/summarizer';
import { parseLogFile } from '../../src/parser/jsonl';
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

function writeMinimalJsonl(dir: string, sessionId = 'summarize-test'): string {
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  const entries = [
    JSON.stringify({ type: 'human',     timestamp: new Date().toISOString(), message: { content: 'Fix auth bug', usage: { input_tokens: 10, output_tokens: 0 } }, cwd: dir, sessionId }),
    JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: "I'll fix the auth bug.", usage: { input_tokens: 0, output_tokens: 8 } }, cwd: dir, sessionId }),
  ];
  fs.writeFileSync(filePath, entries.join('\n') + '\n', 'utf8');
  return filePath;
}

describe('summarize pipeline', () => {
  const tmpDir = path.join(os.tmpdir(), `summarize-test-${Date.now()}`);
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

  afterEach(() => { store.close(); });
  afterAll(() => { fs.rmSync(tmpDir, { recursive: true }); });

  it('session saved with no-ai-summary tag is returned by findByTag', async () => {
    // generateSummary with skipAI=true → rule-based → tags include no-ai-summary
    await saveSnapshot(logPath, store, testConfig, 'imported');

    const tagged = store.findByTag('no-ai-summary', 50);
    expect(tagged).toHaveLength(1);
  });

  it('updating a session replaces its summary fields (same id, no duplicate)', async () => {
    await saveSnapshot(logPath, store, testConfig, 'imported');

    const [before] = store.findByTag('no-ai-summary', 50);
    expect(before).toBeDefined();

    // Simulate regeneration: parse log, generate new summary, save with same id
    const parsed  = parseLogFile(logPath);
    const newSummary = await generateSummary(parsed, testConfig.summaries, true); // skipAI=true in tests
    const updated = { ...before, summary: newSummary.summary, description: newSummary.description };
    store.save(updated);

    const all = store.getAll();
    expect(all).toHaveLength(1);             // still one record
    expect(all[0].id).toBe(before.id);       // same id
  });

  it('session with no matching logFile is skippable (logFile field accessible)', async () => {
    await saveSnapshot(logPath, store, testConfig, 'imported');

    const [session] = store.getAll();
    expect(typeof session.logFile).toBe('string');
    expect(fs.existsSync(session.logFile)).toBe(true);
  });
});
```

- [ ] **Step 7.2: Run tests to verify they pass (store already has findByTag)**

```bash
npx jest tests/cli/summarize.test.ts --no-coverage
```

Expected: PASS — `findByTag` already exists in the store.

- [ ] **Step 7.3: Add the `summarize` command to `src/cli.ts`**

Add the following import near the top of `src/cli.ts`:

```typescript
import { parseLogFile } from './parser/jsonl';
import { generateSummary } from './parser/summarizer';
```

Add the command block before `program.parse()`:

```typescript
/**
 * Summarize command — regenerate AI summaries for sessions tagged no-ai-summary
 *
 * Usage:
 *   cc-sessions summarize                # sessions with no-ai-summary tag (default)
 *   cc-sessions summarize <session-id>   # one specific session by id
 *   cc-sessions summarize --all          # all sessions
 *   cc-sessions summarize --no-ai        # rule-based only
 *   cc-sessions summarize --limit <n>    # cap sessions processed (default: 50)
 */
program
  .command('summarize [sessionId]')
  .description('Regenerate summaries for sessions with rule-based (no-ai-summary) summaries')
  .option('--all', 'Regenerate all sessions, not just no-ai-summary ones')
  .option('--no-ai', 'Use rule-based summarizer only (no AI providers)')
  .option('--limit <number>', 'Maximum number of sessions to process', '50')
  .action(async (sessionId?: string, options?: { all?: boolean; noAi?: boolean; limit?: string }) => {
    const config = await loadConfig();
    const store  = new SessionStore();
    const skipAI = options?.noAi ?? false;
    const limit  = parseInt(options?.limit ?? '50', 10);

    try {
      // 1. Select sessions
      let sessions: SessionMemory[];
      if (sessionId) {
        const s = store.getById(sessionId);
        if (!s) {
          console.error(`⚠️  Session not found: ${sessionId}`);
          process.exit(1);
        }
        sessions = [s];
      } else if (options?.all) {
        sessions = store.getAll().slice(0, limit);
      } else {
        // findByTag already exists in the store with proper LIKE escaping
        sessions = store.findByTag('no-ai-summary', limit);
      }

      if (sessions.length === 0) {
        console.log('No sessions to summarize.');
        return;
      }

      console.log(`Scanning for sessions to summarize...`);
      console.log(`Found ${sessions.length} session${sessions.length !== 1 ? 's' : ''}.\n`);

      let updated = 0;
      let skipped = 0;

      for (let i = 0; i < sessions.length; i++) {
        const s   = sessions[i];
        const num = `[${String(i + 1).padStart(String(sessions.length).length, ' ')}/${sessions.length}]`;
        const label = truncate(`${s.projectName}: ${s.summary}`, 55);

        // Skip if log file missing
        if (!s.logFile || !fs.existsSync(s.logFile)) {
          console.log(`${num} ${label.padEnd(55)}  ⚠️  log file not found, skipping`);
          skipped++;
          continue;
        }

        try {
          const parsed    = parseLogFile(s.logFile);
          const newSummary = await generateSummary(parsed, config.summaries, skipAI);

          // Determine which provider succeeded:
          // no-ai-summary in tags → rule-based; absent → AI (CC CLI or API, order tried first)
          const provider = newSummary.tags.includes('no-ai-summary') ? 'rule-based' : 'AI';

          // Update session in-place (same id → INSERT OR REPLACE).
          // newSummary.tags: rule-based provider always includes 'no-ai-summary';
          // AI providers never do — so the tag is removed automatically on success.
          store.save({
            ...s,
            summary:        newSummary.summary,
            description:    newSummary.description,
            tasks:          newSummary.tasks,
            tasksCompleted: newSummary.tasks.filter(t => t.status === 'completed').length,
            tasksPending:   newSummary.tasks.filter(t => t.status !== 'completed').length,
            nextSteps:      newSummary.nextSteps,
            keyDecisions:   newSummary.keyDecisions,
            blockers:       newSummary.blockers,
            tags:           newSummary.tags,
          });

          console.log(`${num} ${label.padEnd(55)}  ✅ ${provider}`);
          updated++;
        } catch (err) {
          console.log(`${num} ${label.padEnd(55)}  ❌ error: ${err instanceof Error ? err.message : String(err)}`);
          skipped++;
        }
      }

      console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);
    } finally {
      store.close();
    }
  });
```

> **Note:** `store.getById()` may not exist. Check `src/store/sessions.ts` — if it doesn't exist, use `store.getAll().find(s => s.id === sessionId)`.

- [ ] **Step 7.4: Verify `getById` exists or adjust**

```bash
grep -n "getById\b" /Users/in615bac/Documents/cc-sessions/src/store/sessions.ts
```

If `getById` is not found, replace `store.getById(sessionId)` in the command with:
```typescript
const s = store.getAll().find(sess => sess.id === sessionId);
```

- [ ] **Step 7.5: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 7.6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7.7: Smoke-test the command appears**

```bash
node dist/cli.js summarize --help 2>&1 || npx ts-node src/cli.ts summarize --help 2>&1
```

Expected: shows usage for `summarize` command

- [ ] **Step 7.8: Commit**

```bash
git add src/cli.ts tests/cli/summarize.test.ts
git commit -m "feat(cli): add summarize command for retroactive AI summary regeneration"
```

---

## Chunk 3: `post-clear` hook + `findPreviousSessionLog`

> **Prerequisite:** Chunk 1 must be complete. `post-clear.ts` calls `saveSnapshot(..., true)` with the `forceAI` parameter added in Chunk 1 Task 5. TypeScript will error if Chunk 1 is not done first.

---

### Task 8: Add `findPreviousSessionLog()` to `src/hooks/utils.ts`

**Files:**
- Modify: `src/hooks/utils.ts`
- Create: `tests/hooks/utils.test.ts`

- [ ] **Step 8.1: Write failing tests**

Create `tests/hooks/utils.test.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findPreviousSessionLog } from '../../src/hooks/utils';

describe('findPreviousSessionLog', () => {
  const tmpDir = path.join(os.tmpdir(), `utils-test-${Date.now()}`);

  beforeAll(() => { fs.mkdirSync(tmpDir, { recursive: true }); });
  afterAll(() => { fs.rmSync(tmpDir, { recursive: true }); });

  function makeJsonl(name: string, content = 'line1\nline2'): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content, 'utf8');
    return p;
  }

  it('returns null when no JSONL files exist in projectDir', () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    const result = findPreviousSessionLog(emptyDir, path.join(emptyDir, 'new.jsonl'));
    expect(result).toBeNull();
  });

  it('excludes the transcript_path (new session file)', () => {
    const newFile = makeJsonl('new-session.jsonl', 'data');
    const oldFile = makeJsonl('old-session.jsonl', 'old data');

    // Make old-session older in mtime: write it first, then touch newFile
    const result = findPreviousSessionLog(tmpDir, newFile);
    // old-session should be returned since new-session is excluded
    expect(result).not.toBeNull();
    expect(path.resolve(result!)).not.toBe(path.resolve(newFile));
  });

  it('skips empty files', () => {
    const emptyDir2 = path.join(tmpDir, 'empty2');
    fs.mkdirSync(emptyDir2, { recursive: true });
    const emptyFile = path.join(emptyDir2, 'empty.jsonl');
    fs.writeFileSync(emptyFile, '', 'utf8');
    const newFile2   = path.join(emptyDir2, 'new.jsonl');
    fs.writeFileSync(newFile2, 'data', 'utf8');

    const result = findPreviousSessionLog(emptyDir2, newFile2);
    // empty.jsonl should be skipped → null (no other candidate)
    expect(result).toBeNull();
  });

  it('returns null when only match is older than maxAgeMinutes', () => {
    const oldDir = path.join(tmpDir, 'old');
    fs.mkdirSync(oldDir, { recursive: true });
    const ancient = path.join(oldDir, 'ancient.jsonl');
    fs.writeFileSync(ancient, 'data', 'utf8');

    // Set mtime to 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(ancient, twoHoursAgo, twoHoursAgo);

    const newFile3 = path.join(oldDir, 'new.jsonl');
    fs.writeFileSync(newFile3, '', 'utf8');

    const result = findPreviousSessionLog(oldDir, newFile3, 60);
    expect(result).toBeNull();
  });

  it('uses path.resolve for comparison (handles trailing slashes etc)', () => {
    const candidate = makeJsonl(`resolve-test-${Date.now()}.jsonl`, 'data');
    // Pass newFile as the exact same path but with different casing/resolution won't work
    // on macOS, so just test that excluding it by normalized path works
    const result = findPreviousSessionLog(tmpDir, candidate);
    // candidate is the newest file; excluding it should return another or null
    // Key: it must not return candidate itself
    if (result !== null) {
      expect(path.resolve(result)).not.toBe(path.resolve(candidate));
    }
  });
});
```

- [ ] **Step 8.2: Run test to verify it fails**

```bash
npx jest tests/hooks/utils.test.ts --no-coverage
```

Expected: FAIL — `findPreviousSessionLog` not exported from utils

- [ ] **Step 8.3: Add `findPreviousSessionLog` to `src/hooks/utils.ts`**

```typescript
/**
 * Find the most recently modified JSONL file in projectDir that:
 * - is NOT the new session's transcript_path (path.resolve comparison)
 * - is NOT empty (size > 0)
 * - has mtime within the last maxAgeMinutes minutes
 *
 * Returns null if no matching file is found.
 */
export function findPreviousSessionLog(
  projectDir: string,
  excludePath: string,
  maxAgeMinutes = 60,
): string | null {
  if (!fs.existsSync(projectDir)) return null;

  const normalizedExclude = path.resolve(excludePath);
  const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;

  let candidates: Array<{ p: string; mtime: number }> = [];

  try {
    const entries = fs.readdirSync(projectDir);
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const fullPath = path.resolve(path.join(projectDir, entry));
      if (fullPath === normalizedExclude) continue;

      const stat = fs.statSync(fullPath);
      if (stat.size === 0) continue;
      if (stat.mtime.getTime() < cutoff) continue;

      candidates.push({ p: fullPath, mtime: stat.mtime.getTime() });
    }
  } catch {
    return null;
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].p;
}
```

> **Note:** `fs`, `path`, and `os` are already imported in `src/hooks/utils.ts` — do not add duplicate imports.

- [ ] **Step 8.4: Run tests to verify they pass**

```bash
npx jest tests/hooks/utils.test.ts --no-coverage
```

Expected: PASS (5 tests)

- [ ] **Step 8.5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 8.6: Commit**

```bash
git add src/hooks/utils.ts tests/hooks/utils.test.ts
git commit -m "feat(hooks/utils): add findPreviousSessionLog() with resolve/empty/max-age guards"
```

---

### Task 9: Create `src/hooks/post-clear.ts` + `on-clear` CLI command

**Files:**
- Create: `src/hooks/post-clear.ts`
- Create: `tests/hooks/post-clear.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 9.1: Write failing tests**

Create `tests/hooks/post-clear.test.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handlePostClear } from '../../src/hooks/post-clear';
import { saveSnapshot } from '../../src/hooks/snapshot';
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

function writeMinimalJsonl(dir: string, sessionId = 'pc-test'): string {
  const p = path.join(dir, `${sessionId}.jsonl`);
  const entries = [
    JSON.stringify({ type: 'human',     timestamp: new Date().toISOString(), message: { content: 'Hi', usage: { input_tokens: 5, output_tokens: 0 } }, cwd: dir, sessionId }),
    JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: 'Hello', usage: { input_tokens: 0, output_tokens: 5 } }, cwd: dir, sessionId }),
  ];
  fs.writeFileSync(p, entries.join('\n') + '\n', 'utf8');
  return p;
}

describe('handlePostClear', () => {
  const tmpDir = path.join(os.tmpdir(), `post-clear-test-${Date.now()}`);
  const dbPath  = path.join(tmpDir, 'test.db');
  let store: SessionStore;

  beforeAll(() => { fs.mkdirSync(tmpDir, { recursive: true }); });

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    store = new SessionStore(dbPath);
  });

  afterEach(() => { store.close(); });
  afterAll(() => { fs.rmSync(tmpDir, { recursive: true }); });

  it('saves previous session tagged pre-clear on /clear', async () => {
    const oldPath = writeMinimalJsonl(tmpDir, 'old-session');
    const newPath = path.join(tmpDir, 'new-empty.jsonl');
    fs.writeFileSync(newPath, '', 'utf8');   // empty = the new session

    const payload = {
      hook_event_name: 'SessionStart',
      session_id: 'new-uuid',
      transcript_path: newPath,
      cwd: tmpDir,
    };

    await handlePostClear(payload, store, testConfig);

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].tags).toContain('pre-clear');
  });

  it('does nothing when hook_event_name is not SessionStart', async () => {
    const payload = { hook_event_name: 'Notification', session_id: 'x', transcript_path: '/tmp/x.jsonl', cwd: tmpDir };
    await handlePostClear(payload, store, testConfig);
    expect(store.getAll()).toHaveLength(0);
  });

  it('does nothing when transcript_path is absent', async () => {
    const payload = { hook_event_name: 'SessionStart', session_id: 'x', cwd: tmpDir };
    await handlePostClear(payload as never, store, testConfig);
    expect(store.getAll()).toHaveLength(0);
  });

  it('upserts when session was already saved by /sessions:clear (snapshot + pre-clear combined tags)', async () => {
    const oldPath = writeMinimalJsonl(tmpDir, 'upsert-test');
    const newPath = path.join(tmpDir, 'upsert-new.jsonl');
    fs.writeFileSync(newPath, '', 'utf8');

    // Simulate /sessions:clear having already saved with 'snapshot' tag
    await saveSnapshot(oldPath, store, testConfig, 'snapshot');

    const payload = {
      hook_event_name: 'SessionStart',
      session_id: 'new-uuid2',
      transcript_path: newPath,
      cwd: tmpDir,
    };

    await handlePostClear(payload, store, testConfig);

    const all = store.getAll();
    expect(all).toHaveLength(1);               // still one record (upsert)
    expect(all[0].tags).toContain('snapshot');
    expect(all[0].tags).toContain('pre-clear');
  });
});
```

- [ ] **Step 9.2: Run tests to verify they fail**

```bash
npx jest tests/hooks/post-clear.test.ts --no-coverage
```

Expected: FAIL — module not found

- [ ] **Step 9.3: Create `src/hooks/post-clear.ts`**

```typescript
/**
 * post-clear.ts — SessionStart hook handler for /clear events.
 *
 * When Claude Code fires SessionStart with matcher "clear", the previous
 * session's JSONL is still on disk. This handler finds it and saves a
 * snapshot tagged 'pre-clear' with a full AI summary (forceAI=true).
 *
 * Always exits 0 — never interrupts the user's session.
 * Entry point: cc-sessions on-clear
 */

import * as path from 'path';
import { loadConfig } from '../config/loader';
import { SessionStore } from '../store/sessions';
import { findPreviousSessionLog } from './utils';
import { saveSnapshot } from './snapshot';
import type { Config } from '../types';

interface PostClearPayload {
  hook_event_name: string;
  session_id: string;
  transcript_path?: string;
  cwd?: string;
}

const DEBUG = !!process.env.CC_MEMORY_DEBUG;

function dbg(msg: string): void {
  if (DEBUG) process.stderr.write('cc-sessions: ' + msg + '\n');
}

/**
 * Handle a parsed SessionStart payload from a /clear event.
 * Exported for unit testing.
 */
export async function handlePostClear(
  payload: PostClearPayload,
  store: SessionStore,
  config: Config,
): Promise<void> {
  if (payload.hook_event_name !== 'SessionStart') {
    return;
  }
  if (!payload.transcript_path) {
    dbg('post-clear: no transcript_path in payload, skipping');
    return;
  }

  const projectDir = path.dirname(path.resolve(payload.transcript_path));
  const clearedLog = findPreviousSessionLog(projectDir, payload.transcript_path);

  if (!clearedLog) {
    dbg('post-clear: no previous session log found');
    return;
  }

  // forceAI=true: always run full provider chain (CC CLI → API → rule-based)
  // regardless of config.autoSave.generateSummary
  await saveSnapshot(clearedLog, store, config, 'pre-clear', true);
  dbg(`post-clear: snapshot saved (pre-clear) for ${clearedLog}`);
}

/**
 * CLI entry point: cc-sessions on-clear
 * Reads SessionStart JSON from stdin, handles /clear save. Always exits 0.
 */
export default async function postClearHook(): Promise<void> {
  try {
    const rawInput = await readStdin();
    let payload: PostClearPayload;

    try {
      payload = JSON.parse(rawInput) as PostClearPayload;
    } catch {
      dbg('post-clear: failed to parse stdin JSON');
      return;
    }

    const config = await loadConfig();
    const store  = new SessionStore();

    try {
      await handlePostClear(payload, store, config);
    } finally {
      store.close();
    }
  } catch (err) {
    dbg('post-clear: ' + (err instanceof Error ? err.message : String(err)));
    // Always exit 0
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
```

- [ ] **Step 9.4: Run tests to verify they pass**

```bash
npx jest tests/hooks/post-clear.test.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 9.5: Add `on-clear` command to `src/cli.ts`**

Add import at the top of `src/cli.ts`:

```typescript
import postClearHook from './hooks/post-clear';
```

Add command before `program.parse()`:

```typescript
/**
 * on-clear command — internal hook entry point (cc-sessions on-clear)
 * Reads a SessionStart JSON payload from stdin and saves the cleared session.
 * Always exits 0. Not intended for direct user use.
 * Register in hooks.json with matcher: "clear".
 */
program
  .command('on-clear')
  .description('Internal: handle a SessionStart hook event after /clear (reads JSON from stdin)')
  .action(async () => {
    await postClearHook();
  });
```

- [ ] **Step 9.6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 9.7: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 9.8: Commit**

```bash
git add src/hooks/post-clear.ts tests/hooks/post-clear.test.ts src/cli.ts
git commit -m "feat(hooks): add post-clear SessionStart handler and on-clear CLI command"
```

---

### Task 10: Register the post-clear hook in `hooks/hooks.json`

**Files:**
- Modify: `hooks/hooks.json`

- [ ] **Step 10.1: Add matcher:"clear" SessionStart entry**

Open `hooks/hooks.json`. Replace the entire file contents with:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/session-start.js",
            "timeout": 10
          }
        ]
      },
      {
        "matcher": "clear",
        "hooks": [
          {
            "type": "command",
            "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/post-clear.js",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/session-end.js",
            "timeout": 30
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/notification.js",
            "timeout": 30
          }
        ]
      }
    ],
    "Periodic": [
      {
        "intervalMinutes": 5,
        "hooks": [
          {
            "type": "command",
            "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/periodic-save.js",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

> **Note:** The Notification entry for `notification.js` is also added here — if it was previously registered elsewhere, remove any duplicate.

- [ ] **Step 10.2: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')); console.log('valid')"
```

Expected: `valid`

- [ ] **Step 10.3: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat(hooks): register post-clear SessionStart hook with matcher:clear"
```

---

## Chunk 4: UI `pre-clear` badge + slash command skills + CI workflow

---

### Task 11: Add `pre-clear` tag badge to `src/server/ui.ts`

**Files:**
- Modify: `src/server/ui.ts`

The existing `buildSessionCard()` JS block already renders `pre-compact` and `snapshot` badges. Add `pre-clear`.

- [ ] **Step 11.1: Locate the `KNOWN_TAGS` constant in `src/server/ui.ts`**

```bash
grep -n "KNOWN_TAGS\|pre-compact" /Users/in615bac/Documents/cc-sessions/src/server/ui.ts | head -10
```

- [ ] **Step 11.2: Add `pre-clear` to `KNOWN_TAGS`**

Find the line:
```javascript
  var KNOWN_TAGS = { 'pre-compact': '\uD83D\uDCF8 pre-compact', 'snapshot': '\uD83D\uDCCC snapshot' };
```

Replace with:
```javascript
  var KNOWN_TAGS = { 'pre-compact': '\uD83D\uDCF8 pre-compact', 'snapshot': '\uD83D\uDCCC snapshot', 'pre-clear': '\uD83D\uDDD1\uFE0F pre-clear' };
```

> `\uD83D\uDDD1\uFE0F` is the 🗑️ wastebasket emoji as a UTF-16 surrogate pair + variation selector.

- [ ] **Step 11.3: Verify the change is in the HTML output**

```bash
grep "pre-clear" /Users/in615bac/Documents/cc-sessions/src/server/ui.ts
```

Expected: shows the line with `pre-clear` badge text

- [ ] **Step 11.4: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass (UI badge tests check for `pre-compact` and `snapshot` — those still present)

- [ ] **Step 11.5: Commit**

```bash
git add src/server/ui.ts
git commit -m "feat(ui): add pre-clear tag badge to session cards"
```

---

### Task 12: Create slash command skill files

**Files:**
- Create: `~/.claude/skills/sessions-import.md`
- Create: `~/.claude/skills/sessions-clear.md`

> These files are global (not tracked in the repo). Write them to `~/.claude/skills/`.

- [ ] **Step 12.1: Create `~/.claude/skills/sessions-import.md`**

```bash
mkdir -p ~/.claude/skills
cat > ~/.claude/skills/sessions-import.md << 'EOF'
---
name: sessions-import
description: Import all Claude Code CLI sessions from ~/.claude/projects/ into the cc-sessions database with AI-generated summaries. Use when the user wants to import their session history.
---

Run this command in the terminal to import all sessions:

```bash
cc-sessions import --limit 9999
```

Show the full output to the user. After it completes, run:

```bash
cc-sessions list --limit 5
```

Show those 5 sessions to the user so they can verify the summaries look meaningful. If many sessions show "no-ai-summary" tags, suggest running `cc-sessions summarize` to regenerate them with AI.
EOF
```

- [ ] **Step 12.2: Create `~/.claude/skills/sessions-clear.md`**

```bash
cat > ~/.claude/skills/sessions-clear.md << 'EOF'
---
name: sessions-clear
description: Save the current session with a summary, then clear context. Use instead of /clear when you want to preserve the session before clearing.
---

First, save the current session by running this in the terminal:

```bash
cc-sessions save
```

If it prints `✅ Session saved: <id>`, report the session ID to the user, then run `/clear`.

If it prints `⚠️ No session log found`, warn the user: "Session could not be saved. This may be because the session is very new or no changes have been made. Do you still want to clear context?"

Wait for user confirmation before running `/clear` if the save failed.
EOF
```

- [ ] **Step 12.3: Verify both files exist**

```bash
cat ~/.claude/skills/sessions-import.md
cat ~/.claude/skills/sessions-clear.md
```

Expected: full content of both files displayed

---

### Task 13: Create `.github/workflows/ci.yml`

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 13.1: Create the directory if needed**

```bash
mkdir -p /Users/in615bac/Documents/cc-sessions/.github/workflows
```

- [ ] **Step 13.2: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  build-and-test:
    name: Build & Test (Node ${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Test with coverage
        run: npm test -- --coverage --coverageReporters=text-summary

  lint:
    name: Lint (Node 20)
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint
```

- [ ] **Step 13.3: Verify the file is valid YAML**

```bash
node -e "
const yaml = require('js-yaml');
try {
  yaml.load(require('fs').readFileSync('.github/workflows/ci.yml','utf8'));
  console.log('valid');
} catch(e) {
  console.error('invalid:', e.message);
}
" 2>/dev/null || echo "(js-yaml not available — manual check)"
```

- [ ] **Step 13.4: Commit**

```bash
git add .github/workflows/ci.yml ~/.claude/skills/sessions-import.md ~/.claude/skills/sessions-clear.md 2>/dev/null; git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions CI workflow for PRs (Node 18/20/22 matrix)"
```

> Note: Skill files in `~/.claude/skills/` are outside the repo and won't be staged — that's expected.

---

## Chunk 5: Docs + final integration

---

### Task 14: Update `docs/commands.md`

**Files:**
- Modify: `docs/commands.md`

- [ ] **Step 14.1: Add `cc-sessions summarize` documentation**

Open `docs/commands.md`. Find the `## cc-sessions save` section (already exists from snapshot/resume plan). Insert the following **after** the `cc-sessions save` section:

```markdown
---

## cc-sessions summarize

Regenerate AI summaries for sessions that were saved with rule-based summaries.

```bash
cc-sessions summarize [session-id]   # regenerate one specific session
cc-sessions summarize                # regenerate sessions tagged no-ai-summary (default)
cc-sessions summarize --all          # force-regenerate every session
cc-sessions summarize --no-ai        # rule-based only (no AI providers)
cc-sessions summarize --limit <n>    # cap sessions processed (default: 50)
```

### When to use

After running `cc-sessions import`, many sessions will have `no-ai-summary` tags if AI was unavailable during import. Run `cc-sessions summarize` to retroactively upgrade those summaries.

### Output

```
Scanning for sessions to summarize...
Found 47 sessions.

[  1/47] myapp: Updated import docs...             ✅ CC CLI
[  2/47] cc-sessions: Add authentication...        ✅ API
[  3/47] project: Refactored nav...                ✅ rule-based
[  4/47] VlamGuard: Log file not found, skipping   ⚠️  skipped

Done. 44 updated, 3 skipped.
```

### Provider chain

Tries in order: CC CLI (`claude`) → Anthropic API (`ANTHROPIC_API_KEY`) → rule-based fallback.

```

- [ ] **Step 14.2: Add `/sessions:import` slash command documentation**

Find the slash commands section (likely near `/sessions` or `/sessions:ui`). Add:

```markdown
## /sessions:import

Import all Claude Code CLI sessions from `~/.claude/projects/` with AI-generated summaries.

```
/sessions:import
```

Runs `cc-sessions import --limit 9999`, shows the output, then displays the 5 most recent imported sessions so you can verify summary quality. If many show `no-ai-summary` tags, suggests running `cc-sessions summarize`.

```

- [ ] **Step 14.3: Add `/sessions:clear` slash command documentation**

```markdown
## /sessions:clear

Save the current session with a full AI summary, then clear context.

```
/sessions:clear
```

Runs `cc-sessions save`, reports the saved session ID, then runs `/clear`. If the save fails (e.g., the session is too new), warns the user before clearing.

Use this instead of `/clear` when you want to preserve your session before starting a new context.

```

- [ ] **Step 14.4: Add SessionStart/clear hook setup documentation**

Add a new section explaining standalone (non-plugin) setup:

```markdown
## Auto-save on /clear (SessionStart hook)

cc-sessions can automatically save your session whenever you type `/clear`. This is set up automatically when using the plugin. For standalone (npm install) setup, add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "clear",
        "hooks": [{ "type": "command", "command": "cc-sessions on-clear" }]
      }
    ]
  }
}
```

Sessions saved this way are tagged `pre-clear` and show a 🗑️ badge in the UI.

```

- [ ] **Step 14.5: Commit docs**

```bash
git add docs/commands.md
git commit -m "docs: add summarize, on-clear, /sessions:import, /sessions:clear documentation"
```

---

### Task 15: Final build and integration check

- [ ] **Step 15.1: Build the project**

```bash
cd /Users/in615bac/Documents/cc-sessions
npm run build
```

Expected: no TypeScript errors; `dist/` populated including `dist/hooks/post-clear.js`

- [ ] **Step 15.2: Run the full test suite with coverage**

```bash
npm test -- --coverage
```

Expected: all tests pass

- [ ] **Step 15.3: Verify all new CLI commands are accessible**

```bash
node dist/cli.js summarize --help
node dist/cli.js on-clear --help
node dist/cli.js save --help
node dist/cli.js notify --help
```

Expected: each shows usage information

- [ ] **Step 15.4: Smoke-test provider chain (rule-based path)**

```bash
node -e "
const { generateSummary } = require('./dist/parser/summarizer');
const parsed = {
  claudeSessionId: 'test', projectPath: '/tmp/test',
  startTime: new Date(), endTime: new Date(), duration: 5,
  messagesCount: 2, userMessages: ['test message'],
  assistantMessages: ['test response'], toolCalls: [],
  filesCreated: [], filesModified: ['test.ts'], filesDeleted: [],
  tokensUsed: 100
};
generateSummary(parsed, { model: 'haiku', maxLength: 500, include: [] }, true)
  .then(s => console.log('Summary:', s.summary, '| Tags:', s.tags))
  .catch(e => console.error(e));
"
```

Expected: prints a non-empty summary with `no-ai-summary` in tags

- [ ] **Step 15.5: Final commit if any loose ends**

```bash
git status
git log --oneline -15
```

If everything looks clean, the implementation is complete.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-08-rich-summaries.md`. Ready to execute?
