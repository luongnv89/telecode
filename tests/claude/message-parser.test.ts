import { describe, it, expect } from 'vitest';
import {
  extractTextFromAssistant,
  parseResultMessage,
  parseOutputChunk,
  parseOutputChunks,
  summarizeToolUse,
} from '../../src/claude/message-parser.js';
import type {
  SDKAssistantMessage,
  SDKResultMessage,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';

describe('extractTextFromAssistant', () => {
  it('extracts text from content blocks', () => {
    const message = {
      type: 'assistant' as const,
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'sess-1',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'text' as const, text: 'Hello ' },
          { type: 'text' as const, text: 'world' },
        ],
      },
    } as SDKAssistantMessage;

    expect(extractTextFromAssistant(message)).toBe('Hello world');
  });

  it('filters out non-text blocks', () => {
    const message = {
      type: 'assistant' as const,
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'sess-1',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'text' as const, text: 'Hello' },
          { type: 'tool_use' as const, id: 't1', name: 'test', input: {} },
        ],
      },
    } as SDKAssistantMessage;

    expect(extractTextFromAssistant(message)).toBe('Hello');
  });

  it('returns empty string when no text blocks', () => {
    const message = {
      type: 'assistant' as const,
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'sess-1',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_use' as const, id: 't1', name: 'test', input: {} },
        ],
      },
    } as SDKAssistantMessage;

    expect(extractTextFromAssistant(message)).toBe('');
  });
});

describe('parseResultMessage', () => {
  it('parses success result', () => {
    const message: SDKResultMessage = {
      type: 'result',
      subtype: 'success',
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'sess-1',
      duration_ms: 500,
      duration_api_ms: 400,
      is_error: false,
      num_turns: 2,
      result: 'Task completed',
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null },
      modelUsage: {},
      permission_denials: [],
    };

    const result = parseResultMessage(message);
    expect(result.success).toBe(true);
    expect(result.text).toBe('Task completed');
    expect(result.durationMs).toBe(500);
    expect(result.totalCostUsd).toBe(0.01);
    expect(result.numTurns).toBe(2);
  });

  it('parses error result', () => {
    const message: SDKResultMessage = {
      type: 'result',
      subtype: 'error_during_execution',
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'sess-1',
      duration_ms: 100,
      duration_api_ms: 50,
      is_error: true,
      num_turns: 1,
      total_cost_usd: 0.001,
      usage: { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null },
      modelUsage: {},
      permission_denials: [],
      errors: ['Something went wrong'],
    };

    const result = parseResultMessage(message);
    expect(result.success).toBe(false);
    expect(result.text).toContain('Something went wrong');
    expect(result.errors).toContain('Something went wrong');
  });
});

describe('summarizeToolUse', () => {
  it('summarizes Read with file path', () => {
    expect(summarizeToolUse('Read', { file_path: 'src/index.ts' })).toBe('Read: src/index.ts');
  });

  it('summarizes Edit with file path', () => {
    expect(summarizeToolUse('Edit', { file_path: 'src/config.ts', old_string: 'a', new_string: 'b' }))
      .toBe('Edit: src/config.ts');
  });

  it('summarizes Write with file path', () => {
    expect(summarizeToolUse('Write', { file_path: 'src/new-file.ts', content: '...' }))
      .toBe('Write: src/new-file.ts');
  });

  it('summarizes Read without file path', () => {
    expect(summarizeToolUse('Read', {})).toBe('Read');
  });

  it('summarizes Bash with command', () => {
    expect(summarizeToolUse('Bash', { command: 'npm test' })).toBe('Bash: npm test');
  });

  it('truncates long Bash commands', () => {
    const longCmd = 'a'.repeat(100);
    const result = summarizeToolUse('Bash', { command: longCmd });
    expect(result).toBe(`Bash: ${'a'.repeat(60)}...`);
  });

  it('summarizes Bash without command', () => {
    expect(summarizeToolUse('Bash', {})).toBe('Bash');
  });

  it('summarizes Grep with pattern and path', () => {
    expect(summarizeToolUse('Grep', { pattern: 'TODO', path: 'src/' }))
      .toBe('Grep: TODO in src/');
  });

  it('summarizes Grep with pattern only', () => {
    expect(summarizeToolUse('Grep', { pattern: 'TODO' })).toBe('Grep: TODO');
  });

  it('summarizes Grep without pattern', () => {
    expect(summarizeToolUse('Grep', {})).toBe('Grep');
  });

  it('summarizes Glob with pattern', () => {
    expect(summarizeToolUse('Glob', { pattern: '**/*.ts' })).toBe('Glob: **/*.ts');
  });

  it('summarizes Glob without pattern', () => {
    expect(summarizeToolUse('Glob', {})).toBe('Glob');
  });

  it('summarizes Task with description', () => {
    expect(summarizeToolUse('Task', { description: 'explore codebase' }))
      .toBe('Task: explore codebase');
  });

  it('summarizes Task without description', () => {
    expect(summarizeToolUse('Task', {})).toBe('Task');
  });

  it('returns just the name for unknown tools', () => {
    expect(summarizeToolUse('WebSearch', { query: 'test' })).toBe('WebSearch');
  });
});

describe('parseOutputChunks', () => {
  it('extracts text from assistant message', () => {
    const message = {
      type: 'assistant' as const,
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'sess-1',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'text' as const, text: 'Hello' }],
      },
    } as SDKMessage;

    const chunks = parseOutputChunks(message);
    expect(chunks).toEqual([{ type: 'text', content: 'Hello' }]);
  });

  it('extracts tool_use blocks from assistant message', () => {
    const message = {
      type: 'assistant' as const,
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'sess-1',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_use' as const, id: 't1', name: 'Read', input: { file_path: 'src/index.ts' } },
        ],
      },
    } as SDKMessage;

    const chunks = parseOutputChunks(message);
    expect(chunks).toEqual([{ type: 'tool_use', content: 'Read: src/index.ts' }]);
  });

  it('extracts both text and tool_use from assistant message', () => {
    const message = {
      type: 'assistant' as const,
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'sess-1',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'text' as const, text: 'Let me read the file' },
          { type: 'tool_use' as const, id: 't1', name: 'Read', input: { file_path: 'src/app.ts' } },
        ],
      },
    } as SDKMessage;

    const chunks = parseOutputChunks(message);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'text', content: 'Let me read the file' });
    expect(chunks[1]).toEqual({ type: 'tool_use', content: 'Read: src/app.ts' });
  });

  it('handles tool_progress messages', () => {
    const message = {
      type: 'tool_progress' as const,
      tool_use_id: 'tu-1',
      tool_name: 'Bash',
      parent_tool_use_id: null,
      elapsed_time_seconds: 5,
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'sess-1',
    } as SDKMessage;

    const chunks = parseOutputChunks(message);
    expect(chunks).toEqual([{ type: 'tool_use', content: 'Bash' }]);
  });

  it('returns empty array for system messages', () => {
    const message = {
      type: 'system' as const,
      subtype: 'init' as const,
      session_id: 'sess-1',
    } as SDKMessage;

    expect(parseOutputChunks(message)).toEqual([]);
  });

  it('returns empty array for result messages', () => {
    const message = {
      type: 'result' as const,
      subtype: 'success' as const,
      session_id: 'sess-1',
    } as SDKMessage;

    expect(parseOutputChunks(message)).toEqual([]);
  });

  it('returns empty array for empty assistant text', () => {
    const message = {
      type: 'assistant' as const,
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'sess-1',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'text' as const, text: '' }],
      },
    } as SDKMessage;

    expect(parseOutputChunks(message)).toEqual([]);
  });

  it('handles string content in assistant message', () => {
    const message = {
      type: 'assistant' as const,
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'sess-1',
      parent_tool_use_id: null,
      message: {
        content: 'Hello world',
      },
    } as SDKMessage;

    const chunks = parseOutputChunks(message);
    expect(chunks).toEqual([{ type: 'text', content: 'Hello world' }]);
  });
});

describe('parseOutputChunk (deprecated)', () => {
  it('parses assistant message to text chunk', () => {
    const message = {
      type: 'assistant' as const,
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'sess-1',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'text' as const, text: 'Hello' }],
      },
    } as SDKMessage;

    const chunk = parseOutputChunk(message);
    expect(chunk).toEqual({ type: 'text', content: 'Hello' });
  });

  it('returns null for system messages', () => {
    const message = {
      type: 'system' as const,
      subtype: 'init' as const,
      session_id: 'sess-1',
    } as SDKMessage;

    expect(parseOutputChunk(message)).toBeNull();
  });

  it('returns null for result messages', () => {
    const message = {
      type: 'result' as const,
      subtype: 'success' as const,
      session_id: 'sess-1',
    } as SDKMessage;

    expect(parseOutputChunk(message)).toBeNull();
  });
});
