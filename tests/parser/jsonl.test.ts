/**
 * Tests for JSONL parser
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseLogFile } from '../../src/parser/jsonl';

describe('parseLogFile', () => {
  const testDir = path.join(os.tmpdir(), 'cc-sessions-test');
  const testLogFile = path.join(testDir, 'test-session.jsonl');

  beforeAll(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('should parse a valid JSONL file', () => {
    const logContent = [
      JSON.stringify({
        type: 'human',
        timestamp: '2025-01-12T10:00:00Z',
        content: 'Hello, can you help me?',
        cwd: '/test/project'
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2025-01-12T10:00:10Z',
        message: {
          content: 'Of course! How can I help you today?',
          usage: { input_tokens: 50, output_tokens: 20 }
        }
      }),
      JSON.stringify({
        type: 'tool_use',
        timestamp: '2025-01-12T10:01:00Z',
        name: 'Write',
        input: { path: '/test/project/newfile.ts', content: 'console.log("hello")' }
      })
    ].join('\n');

    fs.writeFileSync(testLogFile, logContent);

    const parsed = parseLogFile(testLogFile);

    expect(parsed.messagesCount).toBe(2);
    expect(parsed.userMessages).toHaveLength(1);
    expect(parsed.assistantMessages).toHaveLength(1);
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.filesCreated).toContain('/test/project/newfile.ts');
    expect(parsed.tokensUsed).toBe(70);
    expect(parsed.projectPath).toBe('/test/project');
  });

  it('should handle empty files', () => {
    const emptyFile = path.join(testDir, 'empty.jsonl');
    fs.writeFileSync(emptyFile, '');

    const parsed = parseLogFile(emptyFile);

    expect(parsed.messagesCount).toBe(0);
    expect(parsed.userMessages).toHaveLength(0);
    expect(parsed.toolCalls).toHaveLength(0);
  });

  it('should skip malformed JSON lines', () => {
    const mixedContent = [
      JSON.stringify({ type: 'human', timestamp: '2025-01-12T10:00:00Z', content: 'Valid message' }),
      'not valid json',
      JSON.stringify({ type: 'assistant', timestamp: '2025-01-12T10:00:10Z', message: { content: 'Response' } }),
      '{ broken json',
    ].join('\n');

    const mixedFile = path.join(testDir, 'mixed.jsonl');
    fs.writeFileSync(mixedFile, mixedContent);

    const parsed = parseLogFile(mixedFile);

    expect(parsed.messagesCount).toBe(2);
    expect(parsed.userMessages).toHaveLength(1);
    expect(parsed.assistantMessages).toHaveLength(1);
  });

  it('should extract tool calls from assistant content blocks', () => {
    const logContent = [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2025-01-12T10:00:00Z',
        message: {
          content: [
            { type: 'text', text: 'Let me create that file for you.' },
            { type: 'tool_use', name: 'Write', input: { path: '/test/file.ts' } },
            { type: 'tool_use', name: 'Edit', input: { path: '/test/other.ts' } }
          ]
        }
      })
    ].join('\n');

    const toolCallFile = path.join(testDir, 'toolcalls.jsonl');
    fs.writeFileSync(toolCallFile, logContent);

    const parsed = parseLogFile(toolCallFile);

    expect(parsed.toolCalls).toHaveLength(2);
    expect(parsed.filesCreated).toContain('/test/file.ts');
    expect(parsed.filesModified).toContain('/test/other.ts');
  });

  it('should throw error for non-existent file', () => {
    expect(() => {
      parseLogFile('/nonexistent/file.jsonl');
    }).toThrow('Log file not found');
  });

  it('should calculate correct duration', () => {
    const logContent = [
      JSON.stringify({
        type: 'human',
        timestamp: '2025-01-12T10:00:00Z',
        content: 'Start'
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2025-01-12T10:45:00Z',
        message: { content: 'End after 45 minutes' }
      })
    ].join('\n');

    const durationFile = path.join(testDir, 'duration.jsonl');
    fs.writeFileSync(durationFile, logContent);

    const parsed = parseLogFile(durationFile);

    expect(parsed.duration).toBe(45);
  });

  it('should detect deleted files from Bash rm commands', () => {
    const logContent = [
      JSON.stringify({
        type: 'tool_use',
        timestamp: '2025-01-12T10:00:00Z',
        name: 'Bash',
        input: { command: 'rm -rf /test/old-file.ts' }
      })
    ].join('\n');

    const deleteFile = path.join(testDir, 'delete.jsonl');
    fs.writeFileSync(deleteFile, logContent);

    const parsed = parseLogFile(deleteFile);

    expect(parsed.filesDeleted).toContain('/test/old-file.ts');
  });
});
