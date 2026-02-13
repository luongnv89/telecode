import { describe, it, expect } from 'vitest';
import {
  extractTextFromAssistant,
  parseResultMessage,
  parseOutputChunk,
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

describe('parseOutputChunk', () => {
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
