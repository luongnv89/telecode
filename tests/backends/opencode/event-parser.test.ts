import { describe, it, expect } from 'vitest';
import { parseOpencodeEvent } from '../../../src/backends/opencode/event-parser.js';

describe('parseOpencodeEvent', () => {
  describe('null / invalid input', () => {
    it('returns null for null', () => {
      expect(parseOpencodeEvent(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(parseOpencodeEvent(undefined)).toBeNull();
    });

    it('returns null for non-object', () => {
      expect(parseOpencodeEvent('string')).toBeNull();
      expect(parseOpencodeEvent(42)).toBeNull();
      expect(parseOpencodeEvent(true)).toBeNull();
    });

    it('returns null for empty object', () => {
      expect(parseOpencodeEvent({})).toBeNull();
    });

    it('returns null for unknown event type', () => {
      expect(parseOpencodeEvent({ type: 'unknown.event' })).toBeNull();
    });
  });

  describe('message.part.updated — text parts', () => {
    it('returns text chunk from delta field', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: { type: 'text' },
          delta: 'Hello world',
        },
      };
      const result = parseOpencodeEvent(event);
      expect(result).toEqual({
        type: 'chunk',
        chunk: { type: 'text', content: 'Hello world' },
      });
    });

    it('falls back to part.text when delta is missing', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: { type: 'text', text: 'Fallback text' },
        },
      };
      const result = parseOpencodeEvent(event);
      expect(result).toEqual({
        type: 'chunk',
        chunk: { type: 'text', content: 'Fallback text' },
      });
    });

    it('prefers delta over part.text', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: { type: 'text', text: 'full text' },
          delta: 'delta text',
        },
      };
      const result = parseOpencodeEvent(event);
      expect(result).toEqual({
        type: 'chunk',
        chunk: { type: 'text', content: 'delta text' },
      });
    });

    it('returns null for empty text content', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: { type: 'text', text: '' },
        },
      };
      expect(parseOpencodeEvent(event)).toBeNull();
    });

    it('returns null when properties is missing', () => {
      expect(parseOpencodeEvent({ type: 'message.part.updated' })).toBeNull();
    });

    it('returns null when part is missing', () => {
      const event = {
        type: 'message.part.updated',
        properties: {},
      };
      expect(parseOpencodeEvent(event)).toBeNull();
    });
  });

  describe('message.part.updated — tool parts', () => {
    it('returns tool_use for running tool with title', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            toolID: 'bash_123',
            state: { title: 'Running bash', status: 'running' },
          },
        },
      };
      const result = parseOpencodeEvent(event);
      expect(result).toEqual({
        type: 'chunk',
        chunk: { type: 'tool_use', content: 'Running bash' },
      });
    });

    it('returns tool_use for pending tool, falls back to toolID', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            toolID: 'read_file',
            state: { status: 'pending' },
          },
        },
      };
      const result = parseOpencodeEvent(event);
      expect(result).toEqual({
        type: 'chunk',
        chunk: { type: 'tool_use', content: 'read_file' },
      });
    });

    it('returns tool_result for completed tool with label and output', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            toolID: 'bash_123',
            state: { status: 'completed', output: 'command output here' },
          },
        },
      };
      const result = parseOpencodeEvent(event);
      expect(result?.chunk?.type).toBe('tool_result');
      expect(result?.chunk?.content).toContain('bash_123');
      expect(result?.chunk?.content).toContain('✓');
      expect(result?.chunk?.content).toContain('command output here');
    });

    it('truncates tool output in completed result', () => {
      const longOutput = 'x'.repeat(300);
      const event = {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            toolID: 'bash_123',
            state: { status: 'completed', output: longOutput },
          },
        },
      };
      const result = parseOpencodeEvent(event);
      // Output is truncated to 150 chars + label prefix
      expect(result?.chunk?.content).toContain('✓');
      expect(result!.chunk!.content.length).toBeLessThan(200);
    });

    it('returns tool_result with error label for errored tool', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            toolID: 'bash_123',
            state: { status: 'error', error: 'command not found' },
          },
        },
      };
      const result = parseOpencodeEvent(event);
      expect(result?.chunk?.type).toBe('tool_result');
      expect(result?.chunk?.content).toContain('bash_123');
      expect(result?.chunk?.content).toContain('✗');
      expect(result?.chunk?.content).toContain('command not found');
    });

    it('returns null for tool with unknown status', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            toolID: 'bash_123',
            state: { status: 'unknown_status' },
          },
        },
      };
      expect(parseOpencodeEvent(event)).toBeNull();
    });

    it('returns null for tool with no state', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: { type: 'tool', toolID: 'bash_123' },
        },
      };
      expect(parseOpencodeEvent(event)).toBeNull();
    });

    it('uses "tool" as default toolID when toolID is missing', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            state: { status: 'running' },
          },
        },
      };
      const result = parseOpencodeEvent(event);
      expect(result).toEqual({
        type: 'chunk',
        chunk: { type: 'tool_use', content: 'tool' },
      });
    });
  });

  describe('message.part.updated — reasoning parts', () => {
    it('returns null for reasoning parts', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: { type: 'reasoning', text: 'internal thinking' },
        },
      };
      expect(parseOpencodeEvent(event)).toBeNull();
    });
  });

  describe('message.part.updated — unknown part types', () => {
    it('returns null for unknown part type', () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          part: { type: 'image', url: 'http://example.com/img.png' },
        },
      };
      expect(parseOpencodeEvent(event)).toBeNull();
    });
  });

  describe('message.updated', () => {
    it('returns done with cost and tokens for completed assistant message', () => {
      const event = {
        type: 'message.updated',
        properties: {
          info: {
            role: 'assistant',
            finish: true,
            cost: 0.042,
            tokens: { input: 1000, output: 500 },
          },
        },
      };
      const result = parseOpencodeEvent(event);
      expect(result).toEqual({
        type: 'done',
        cost: 0.042,
        tokens: { input: 1000, output: 500 },
      });
    });

    it('returns null for non-finished assistant message', () => {
      const event = {
        type: 'message.updated',
        properties: {
          info: { role: 'assistant', finish: false },
        },
      };
      expect(parseOpencodeEvent(event)).toBeNull();
    });

    it('returns null for non-assistant role', () => {
      const event = {
        type: 'message.updated',
        properties: {
          info: { role: 'user', finish: true },
        },
      };
      expect(parseOpencodeEvent(event)).toBeNull();
    });

    it('returns null when properties is missing', () => {
      expect(parseOpencodeEvent({ type: 'message.updated' })).toBeNull();
    });

    it('returns null when info is missing', () => {
      const event = { type: 'message.updated', properties: {} };
      expect(parseOpencodeEvent(event)).toBeNull();
    });

    it('returns done with zero cost when cost is missing', () => {
      const event = {
        type: 'message.updated',
        properties: {
          info: { role: 'assistant', finish: true },
        },
      };
      const result = parseOpencodeEvent(event);
      expect(result).toEqual({
        type: 'done',
        cost: 0,
        tokens: undefined,
      });
    });
  });

  describe('session.idle', () => {
    it('returns done', () => {
      const result = parseOpencodeEvent({ type: 'session.idle' });
      expect(result).toEqual({ type: 'done' });
    });
  });

  describe('session.status', () => {
    it('returns done when status type is idle', () => {
      const event = {
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      };
      const result = parseOpencodeEvent(event);
      expect(result).toEqual({ type: 'done' });
    });

    it('returns null when status type is busy', () => {
      const event = {
        type: 'session.status',
        properties: {
          status: { type: 'busy' },
        },
      };
      expect(parseOpencodeEvent(event)).toBeNull();
    });

    it('returns null when properties is missing', () => {
      expect(parseOpencodeEvent({ type: 'session.status' })).toBeNull();
    });

    it('returns null when status is missing', () => {
      const event = { type: 'session.status', properties: {} };
      expect(parseOpencodeEvent(event)).toBeNull();
    });
  });

  describe('session.error', () => {
    it('returns done with error text', () => {
      const event = {
        type: 'session.error',
        properties: { error: 'rate limit exceeded' },
      };
      const result = parseOpencodeEvent(event);
      expect(result).toEqual({
        type: 'done',
        finalText: 'Error: rate limit exceeded',
      });
    });

    it('uses default error message when error string is missing', () => {
      const event = { type: 'session.error', properties: {} };
      const result = parseOpencodeEvent(event);
      expect(result).toEqual({
        type: 'done',
        finalText: 'Error: Unknown OpenCode error',
      });
    });

    it('uses default error message when properties is missing', () => {
      const event = { type: 'session.error' };
      const result = parseOpencodeEvent(event);
      expect(result).toEqual({
        type: 'done',
        finalText: 'Error: Unknown OpenCode error',
      });
    });
  });
});
