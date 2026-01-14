/**
 * Data extractors for Claude Code session logs
 *
 * Extracts structured data like files, tasks, and context from parsed sessions.
 */

import type { ToolCall, Task } from '../types';

/**
 * Extract files that were created during a session
 */
export function extractFilesCreated(toolCalls: ToolCall[]): string[] {
  const files: string[] = [];
  const createTools = ['Write', 'create_file', 'write_file'];

  for (const call of toolCalls) {
    if (!createTools.includes(call.name)) continue;

    const filePath = getFilePath(call);
    if (filePath) {
      files.push(filePath);
    }
  }

  return [...new Set(files)];
}

/**
 * Extract files that were modified during a session
 */
export function extractFilesModified(toolCalls: ToolCall[]): string[] {
  const files: string[] = [];
  const modifyTools = ['Edit', 'str_replace', 'str_replace_editor', 'edit_file', 'patch'];

  for (const call of toolCalls) {
    if (!modifyTools.includes(call.name)) continue;

    const filePath = getFilePath(call);
    if (filePath) {
      files.push(filePath);
    }
  }

  return [...new Set(files)];
}

/**
 * Extract files that were deleted during a session
 */
export function extractFilesDeleted(toolCalls: ToolCall[]): string[] {
  const files: string[] = [];

  for (const call of toolCalls) {
    // Check for delete tool
    if (call.name === 'delete_file' || call.name === 'remove_file') {
      const filePath = getFilePath(call);
      if (filePath) {
        files.push(filePath);
      }
      continue;
    }

    // Check for rm commands in Bash
    if (call.name === 'Bash' || call.name === 'bash' || call.name === 'run_terminal_cmd') {
      const command = call.input.command as string | undefined;
      if (!command) continue;

      // Match rm commands with various flags
      const rmPatterns = [
        /rm\s+(?:-[rf]+\s+)?["']?([^\s"']+)["']?/g,
        /rm\s+(?:-[rf]+\s+)?([^\s]+)/g
      ];

      for (const pattern of rmPatterns) {
        let match;
        while ((match = pattern.exec(command)) !== null) {
          if (match[1] && !match[1].startsWith('-')) {
            files.push(match[1]);
          }
        }
      }
    }
  }

  return [...new Set(files)];
}

/**
 * Extract tasks from user and assistant messages
 *
 * Looks for patterns like:
 * - TODO: ...
 * - Task: ...
 * - [ ] ... (unchecked)
 * - [x] ... (checked)
 * - Numbered lists (1. ...)
 */
export function extractTasks(userMessages: string[], assistantMessages: string[]): Task[] {
  const tasks: Task[] = [];
  const allMessages = [...userMessages, ...assistantMessages];
  let taskId = 0;

  for (const message of allMessages) {
    // Extract TODO items
    const todoMatches = message.matchAll(/TODO:\s*(.+?)(?:\n|$)/gi);
    for (const match of todoMatches) {
      tasks.push(createTask(String(++taskId), match[1].trim(), 'pending'));
    }

    // Extract Task: items
    const taskMatches = message.matchAll(/Task:\s*(.+?)(?:\n|$)/gi);
    for (const match of taskMatches) {
      tasks.push(createTask(String(++taskId), match[1].trim(), 'pending'));
    }

    // Extract checkbox items
    const checkboxMatches = message.matchAll(/\[([ xX])\]\s*(.+?)(?:\n|$)/g);
    for (const match of checkboxMatches) {
      const isCompleted = match[1].toLowerCase() === 'x';
      tasks.push(createTask(
        String(++taskId),
        match[2].trim(),
        isCompleted ? 'completed' : 'pending'
      ));
    }

    // Extract numbered list items (likely tasks if in context)
    const numberedMatches = message.matchAll(/^\d+\.\s+(.+?)(?:\n|$)/gm);
    for (const match of numberedMatches) {
      // Only add if it looks like a task (starts with action verb)
      const item = match[1].trim();
      if (looksLikeTask(item)) {
        tasks.push(createTask(String(++taskId), item, 'pending'));
      }
    }
  }

  // Deduplicate by description
  const seen = new Set<string>();
  return tasks.filter(task => {
    const key = task.description.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Extract the main goal/objective from user messages
 */
export function extractMainGoal(userMessages: string[]): string | null {
  if (userMessages.length === 0) return null;

  // The first substantial user message usually contains the main goal
  for (const message of userMessages) {
    const cleaned = message.trim();
    if (cleaned.length > 10 && cleaned.length < 500) {
      return cleaned;
    }
  }

  return userMessages[0]?.trim() || null;
}

/**
 * Extract key decisions from assistant messages
 */
export function extractKeyDecisions(assistantMessages: string[]): string[] {
  const decisions: string[] = [];

  const decisionPatterns = [
    /I(?:'ll| will)\s+(.+?)(?:\.|$)/gi,
    /Let(?:'s| us)\s+(.+?)(?:\.|$)/gi,
    /We should\s+(.+?)(?:\.|$)/gi,
    /I recommend\s+(.+?)(?:\.|$)/gi,
    /I suggest\s+(.+?)(?:\.|$)/gi,
    /The best approach is to\s+(.+?)(?:\.|$)/gi
  ];

  for (const message of assistantMessages) {
    for (const pattern of decisionPatterns) {
      const matches = message.matchAll(pattern);
      for (const match of matches) {
        const decision = match[1].trim();
        if (decision.length > 10 && decision.length < 200) {
          decisions.push(decision);
        }
      }
    }
  }

  // Deduplicate and limit
  return [...new Set(decisions)].slice(0, 10);
}

/**
 * Extract blockers/issues from messages
 */
export function extractBlockers(userMessages: string[], assistantMessages: string[]): string[] {
  const blockers: string[] = [];
  const allMessages = [...userMessages, ...assistantMessages];

  const blockerPatterns = [
    /(?:error|issue|problem|bug|fail(?:ed|ure)?|broken|doesn't work|can't|cannot):\s*(.+?)(?:\.|$)/gi,
    /blocked by\s+(.+?)(?:\.|$)/gi,
    /waiting (?:for|on)\s+(.+?)(?:\.|$)/gi,
    /need(?:s)? to\s+(.+?)(?:\s+first)?(?:\.|$)/gi
  ];

  for (const message of allMessages) {
    for (const pattern of blockerPatterns) {
      const matches = message.matchAll(pattern);
      for (const match of matches) {
        const blocker = match[1].trim();
        if (blocker.length > 5 && blocker.length < 200) {
          blockers.push(blocker);
        }
      }
    }
  }

  return [...new Set(blockers)].slice(0, 5);
}

/**
 * Extract suggested next steps from assistant messages
 */
export function extractNextSteps(assistantMessages: string[]): string[] {
  const steps: string[] = [];

  const nextStepPatterns = [
    /next(?:,| step| we should| you should)\s+(.+?)(?:\.|$)/gi,
    /then(?:,| we (?:can|should)| you (?:can|should))\s+(.+?)(?:\.|$)/gi,
    /after that(?:,| we (?:can|should)| you (?:can|should))\s+(.+?)(?:\.|$)/gi,
    /you(?:'ll| will) need to\s+(.+?)(?:\.|$)/gi,
    /remaining (?:task|work|step)s?:?\s*(.+?)(?:\.|$)/gi
  ];

  for (const message of assistantMessages) {
    for (const pattern of nextStepPatterns) {
      const matches = message.matchAll(pattern);
      for (const match of matches) {
        const step = match[1].trim();
        if (step.length > 10 && step.length < 200) {
          steps.push(step);
        }
      }
    }
  }

  return [...new Set(steps)].slice(0, 5);
}

/**
 * Extract tags/topics from messages
 */
export function extractTags(userMessages: string[], assistantMessages: string[], filesModified: string[]): string[] {
  const tags: string[] = [];

  // Common technology/framework patterns
  const techPatterns = [
    /\b(react|vue|angular|svelte|next\.?js|nuxt|remix)\b/gi,
    /\b(typescript|javascript|python|rust|go|java|ruby|php)\b/gi,
    /\b(node\.?js|deno|bun)\b/gi,
    /\b(docker|kubernetes|k8s|terraform|aws|gcp|azure)\b/gi,
    /\b(mongodb|postgres|mysql|redis|sqlite)\b/gi,
    /\b(api|rest|graphql|grpc)\b/gi,
    /\b(testing|test|jest|vitest|pytest|unittest)\b/gi,
    /\b(ci|cd|github|gitlab|jenkins)\b/gi
  ];

  const allMessages = [...userMessages, ...assistantMessages];

  for (const message of allMessages) {
    for (const pattern of techPatterns) {
      const matches = message.matchAll(pattern);
      for (const match of matches) {
        tags.push(match[1].toLowerCase());
      }
    }
  }

  // Extract from file extensions
  for (const file of filesModified) {
    const ext = file.split('.').pop()?.toLowerCase();
    if (ext) {
      const extTags: Record<string, string> = {
        'ts': 'typescript',
        'tsx': 'typescript',
        'js': 'javascript',
        'jsx': 'javascript',
        'py': 'python',
        'rs': 'rust',
        'go': 'go',
        'java': 'java',
        'rb': 'ruby',
        'php': 'php'
      };
      if (extTags[ext]) {
        tags.push(extTags[ext]);
      }
    }
  }

  return [...new Set(tags)].slice(0, 10);
}

// Helper functions

function getFilePath(call: ToolCall): string | null {
  const filePath = call.input.path ||
    call.input.file_path ||
    call.input.file ||
    call.input.filename ||
    call.input.target;

  return typeof filePath === 'string' ? filePath : null;
}

function createTask(id: string, description: string, status: 'pending' | 'in_progress' | 'completed' | 'blocked'): Task {
  return {
    id,
    description,
    status,
    createdAt: new Date()
  };
}

function looksLikeTask(text: string): boolean {
  const actionVerbs = [
    'add', 'create', 'implement', 'fix', 'update', 'remove', 'delete',
    'refactor', 'test', 'write', 'build', 'deploy', 'configure', 'setup',
    'install', 'migrate', 'upgrade', 'check', 'verify', 'review', 'debug'
  ];

  const firstWord = text.split(/\s+/)[0]?.toLowerCase();
  return actionVerbs.some(verb => firstWord === verb || firstWord === verb + 's');
}
