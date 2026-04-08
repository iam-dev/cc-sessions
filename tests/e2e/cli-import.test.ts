/**
 * End-to-end tests for `cc-sessions import`
 *
 * These tests compile the project, then exercise the fully assembled CLI binary
 * via child_process — verifying the import command's observable behaviour from
 * a user's perspective.
 */

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionStore } from '../../src/store/sessions';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '../../');
const CLI_ENTRY = path.join(PROJECT_ROOT, 'dist', 'cli.js');
const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write a minimal JSONL session file that cc-sessions can parse.
 */
function writeTestJsonl(
  dir: string,
  sessionId: string,
  projectPath: string,
  messageCount = 2
): void {
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  const lines: string[] = [];

  lines.push(
    JSON.stringify({
      type: 'system',
      timestamp: new Date('2024-06-01T10:00:00Z').toISOString(),
      cwd: projectPath,
      sessionId,
    })
  );

  for (let i = 0; i < messageCount; i++) {
    const isHuman = i % 2 === 0;
    lines.push(
      JSON.stringify({
        type: isHuman ? 'human' : 'assistant',
        timestamp: new Date('2024-06-01T10:00:00Z').toISOString(),
        content: isHuman ? `User message ${i}` : undefined,
        message: isHuman
          ? undefined
          : {
              content: `Assistant reply ${i}`,
              usage: { input_tokens: 100, output_tokens: 50 },
            },
        sessionId,
      })
    );
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

/**
 * Run the CLI binary with the given arguments using spawnSync (no shell
 * interpolation — safe against injection even with path arguments).
 */
function runCLI(
  args: string[],
  envOverrides: Record<string, string> = {}
): { stdout: string; stderr: string; exitCode: number } {
  const result = child_process.spawnSync(
    process.execPath, // node binary — no shell involved
    [CLI_ENTRY, ...args],
    {
      encoding: 'utf-8',
      timeout: TIMEOUT_MS,
      env: { ...process.env, ...envOverrides },
    }
  );

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Setup: compile once before all tests
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Build the project so dist/cli.js exists
  const build = child_process.spawnSync(
    process.execPath,
    [path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsc'), '--project', path.join(PROJECT_ROOT, 'tsconfig.json')],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
      env: process.env,
    }
  );

  if (build.status !== 0) {
    // Fallback: try npm script
    child_process.spawnSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'build'],
      {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        timeout: 60_000,
        shell: false,
      }
    );
  }
}, 70_000);

// ---------------------------------------------------------------------------
// E2E test suite
// ---------------------------------------------------------------------------

describe('cc-sessions import (E2E)', () => {
  // Each test may compile + spawn multiple node processes
  jest.setTimeout(TIMEOUT_MS);
  let tmpDir: string;
  let claudeProjectsDir: string;

  /** DB path as the CLI will actually write it: $HOME/.cc-sessions/index.db */
  function actualDbPath(): string {
    return path.join(tmpDir, '.cc-sessions', 'index.db');
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-import-'));

    // Build the fake ~/.claude/projects/ directory structure
    claudeProjectsDir = path.join(tmpDir, '.claude', 'projects');
    const projectA = path.join(claudeProjectsDir, encodeURIComponent('/home/user/project-alpha'));
    const projectB = path.join(claudeProjectsDir, encodeURIComponent('/home/user/project-beta'));
    fs.mkdirSync(projectA, { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });

    writeTestJsonl(projectA, 'e2e-sess-a1', '/home/user/project-alpha', 4);
    writeTestJsonl(projectA, 'e2e-sess-a2', '/home/user/project-alpha', 2);
    writeTestJsonl(projectB, 'e2e-sess-b1', '/home/user/project-beta', 6);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Shared env ────────────────────────────────────────────────────────────

  function cliEnv(): Record<string, string> {
    return { HOME: tmpDir };
  }

  // ── Tests ─────────────────────────────────────────────────────────────────

  it('exits 0 and reports how many sessions were imported', () => {
    const { stdout, exitCode } = runCLI(['import', '--no-ai'], cliEnv());

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/3 imported/);
    expect(stdout).toMatch(/0 already in database/);
  });

  it('shows all skipped on second import run', () => {
    runCLI(['import', '--no-ai'], cliEnv());

    const { stdout, exitCode } = runCLI(['import', '--no-ai'], cliEnv());

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/0 imported/);
    expect(stdout).toMatch(/3 already in database/);
  });

  it('--dry-run does not persist sessions', () => {
    const { stdout, exitCode } = runCLI(['import', '--no-ai', '--dry-run'], cliEnv());

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/DRY RUN/i);
    expect(stdout).toMatch(/would be imported/);

    // Verify nothing was written to the DB
    const store = new SessionStore(actualDbPath());
    expect(store.getStats().totalSessions).toBe(0);
    store.close();
  });

  it('--limit restricts the number of sessions processed', () => {
    const { stdout, exitCode } = runCLI(['import', '--no-ai', '--limit', '1'], cliEnv());

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/1 imported/);
  });

  it('--project filters by project path substring', () => {
    const { stdout, exitCode } = runCLI(
      ['import', '--no-ai', '--project', 'project-alpha'],
      cliEnv()
    );

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/2 imported/);
  });

  it('--since filters out older sessions', () => {
    // All test sessions have timestamps in 2024-06-01; cutoff is 2025-01-01
    const { stdout, exitCode } = runCLI(
      ['import', '--no-ai', '--since', '2025-01-01'],
      cliEnv()
    );

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/0 imported/);
  });

  it('exits non-zero for an invalid --limit value', () => {
    const { exitCode } = runCLI(['import', '--limit', 'notanumber'], cliEnv());
    expect(exitCode).not.toBe(0);
  });

  it('exits non-zero for an invalid --since value', () => {
    const { exitCode } = runCLI(['import', '--since', 'not-a-date'], cliEnv());
    expect(exitCode).not.toBe(0);
  });

  it('exits 0 gracefully when ~/.claude/projects/ does not exist', () => {
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-empty-'));
    try {
      const { stdout, exitCode } = runCLI(['import', '--no-ai'], {
        HOME: emptyHome,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/No Claude Code sessions found/i);
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  it('imported sessions appear in cc-sessions list', () => {
    runCLI(['import', '--no-ai'], cliEnv());

    const { stdout, exitCode } = runCLI(['list'], cliEnv());

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/3 of 3 sessions/);
  });
});
