/**
 * Tests for extractor functions
 */

import {
  extractFilesCreated,
  extractFilesModified,
  extractFilesDeleted,
  extractTasks
} from '../../src/parser/extractor';
import type { ToolCall } from '../../src/types';

describe('extractFilesCreated', () => {
  it('should extract files from Write tool calls', () => {
    const toolCalls: ToolCall[] = [
      { name: 'Write', input: { path: '/test/file1.ts' }, timestamp: '2025-01-12T10:00:00Z' },
      { name: 'Write', input: { file_path: '/test/file2.ts' }, timestamp: '2025-01-12T10:01:00Z' },
      { name: 'Edit', input: { path: '/test/file3.ts' }, timestamp: '2025-01-12T10:02:00Z' }
    ];

    const files = extractFilesCreated(toolCalls);

    expect(files).toContain('/test/file1.ts');
    expect(files).toContain('/test/file2.ts');
    expect(files).not.toContain('/test/file3.ts');
    expect(files).toHaveLength(2);
  });

  it('should deduplicate file paths', () => {
    const toolCalls: ToolCall[] = [
      { name: 'Write', input: { path: '/test/file.ts' }, timestamp: '2025-01-12T10:00:00Z' },
      { name: 'Write', input: { path: '/test/file.ts' }, timestamp: '2025-01-12T10:01:00Z' }
    ];

    const files = extractFilesCreated(toolCalls);

    expect(files).toHaveLength(1);
  });

  it('should handle create_file tool', () => {
    const toolCalls: ToolCall[] = [
      { name: 'create_file', input: { path: '/test/newfile.ts' }, timestamp: '2025-01-12T10:00:00Z' }
    ];

    const files = extractFilesCreated(toolCalls);

    expect(files).toContain('/test/newfile.ts');
  });
});

describe('extractFilesModified', () => {
  it('should extract files from Edit tool calls', () => {
    const toolCalls: ToolCall[] = [
      { name: 'Edit', input: { path: '/test/modified.ts' }, timestamp: '2025-01-12T10:00:00Z' },
      { name: 'str_replace', input: { file_path: '/test/replaced.ts' }, timestamp: '2025-01-12T10:01:00Z' }
    ];

    const files = extractFilesModified(toolCalls);

    expect(files).toContain('/test/modified.ts');
    expect(files).toContain('/test/replaced.ts');
  });

  it('should handle str_replace_editor tool', () => {
    const toolCalls: ToolCall[] = [
      { name: 'str_replace_editor', input: { path: '/test/file.ts' }, timestamp: '2025-01-12T10:00:00Z' }
    ];

    const files = extractFilesModified(toolCalls);

    expect(files).toContain('/test/file.ts');
  });
});

describe('extractFilesDeleted', () => {
  it('should extract files from Bash rm commands', () => {
    const toolCalls: ToolCall[] = [
      { name: 'Bash', input: { command: 'rm /test/deleted.ts' }, timestamp: '2025-01-12T10:00:00Z' },
      { name: 'Bash', input: { command: 'rm -rf /test/folder' }, timestamp: '2025-01-12T10:01:00Z' }
    ];

    const files = extractFilesDeleted(toolCalls);

    expect(files).toContain('/test/deleted.ts');
    expect(files).toContain('/test/folder');
  });

  it('should handle simple unquoted paths', () => {
    const toolCalls: ToolCall[] = [
      { name: 'Bash', input: { command: 'rm /test/simple-file.ts' }, timestamp: '2025-01-12T10:00:00Z' }
    ];

    const files = extractFilesDeleted(toolCalls);

    expect(files).toContain('/test/simple-file.ts');
  });
});

describe('extractTasks', () => {
  it('should extract TODO items', () => {
    const userMessages = ['TODO: Implement authentication'];
    const assistantMessages = ['I will TODO: add tests later'];

    const tasks = extractTasks(userMessages, assistantMessages);

    expect(tasks.some(t => t.description === 'Implement authentication')).toBe(true);
    expect(tasks.some(t => t.description === 'add tests later')).toBe(true);
  });

  it('should extract checkbox items', () => {
    const userMessages = [
      '- [x] Completed task',
      '- [ ] Pending task'
    ];

    const tasks = extractTasks(userMessages, []);

    const completed = tasks.find(t => t.description === 'Completed task');
    const pending = tasks.find(t => t.description === 'Pending task');

    expect(completed?.status).toBe('completed');
    expect(pending?.status).toBe('pending');
  });

  it('should extract numbered list items that look like tasks', () => {
    const userMessages = [
      '1. Add user authentication',
      '2. Some random text that is not a task',
      '3. Fix the login bug'
    ];

    const tasks = extractTasks(userMessages, []);

    expect(tasks.some(t => t.description.includes('Add user authentication'))).toBe(true);
    expect(tasks.some(t => t.description.includes('Fix the login bug'))).toBe(true);
  });

  it('should deduplicate tasks', () => {
    const userMessages = [
      'TODO: Add tests',
      'TODO: Add tests',
      'TODO: add tests' // Case variation
    ];

    const tasks = extractTasks(userMessages, []);

    // Should only have unique tasks
    const testTasks = tasks.filter(t => t.description.toLowerCase().includes('add tests'));
    expect(testTasks.length).toBeLessThanOrEqual(1);
  });

  it('should return empty array for no tasks', () => {
    const userMessages = ['Just a regular message'];
    const assistantMessages = ['A response without tasks'];

    const tasks = extractTasks(userMessages, assistantMessages);

    expect(tasks).toHaveLength(0);
  });
});
