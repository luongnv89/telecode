import type { AdapterOutputChunk } from '../types.js';

export interface ParsedOpencodeEvent {
  type: 'chunk' | 'done';
  chunk?: AdapterOutputChunk;
  finalText?: string;
  cost?: number;
  tokens?: { input: number; output: number };
}

/**
 * Parse an OpenCode SSE event into the adapter's chunk format.
 *
 * OpenCode event types from @opencode-ai/sdk:
 * - message.part.updated: streaming text/tool progress with delta field
 * - session.status: idle/busy/retry transitions
 * - session.idle: session finished processing
 * - session.error: error occurred
 * - permission.updated: tool requesting permission
 */
export function parseOpencodeEvent(event: unknown): ParsedOpencodeEvent | null {
  if (!event || typeof event !== 'object') return null;
  const ev = event as Record<string, unknown>;

  switch (ev['type']) {
    case 'message.part.updated': {
      const properties = ev['properties'] as Record<string, unknown> | undefined;
      if (!properties) return null;

      const part = properties['part'] as Record<string, unknown> | undefined;
      if (!part) return null;

      const delta = typeof properties['delta'] === 'string' ? properties['delta'] : undefined;

      if (part['type'] === 'text') {
        const content = delta ?? (typeof part['text'] === 'string' ? part['text'] : '');
        if (content) {
          return { type: 'chunk', chunk: { type: 'text', content } };
        }
        return null;
      }

      if (part['type'] === 'tool') {
        const state = part['state'] as Record<string, unknown> | undefined;
        const title = typeof state?.['title'] === 'string' ? state['title'] : undefined;
        const toolId = typeof part['toolID'] === 'string' ? part['toolID'] : 'tool';
        const status = typeof state?.['status'] === 'string' ? state['status'] : '';

        if (status === 'running' || status === 'pending') {
          return { type: 'chunk', chunk: { type: 'tool_use', content: title ?? toolId } };
        }

        if (status === 'completed') {
          const output = typeof state?.['output'] === 'string' ? state['output'] : '';
          return { type: 'chunk', chunk: { type: 'tool_result', content: output.slice(0, 200) } };
        }

        if (status === 'error') {
          const error = typeof state?.['error'] === 'string' ? state['error'] : 'Tool error';
          return { type: 'chunk', chunk: { type: 'tool_result', content: `Error: ${error}` } };
        }

        return null;
      }

      if (part['type'] === 'reasoning') {
        // Skip reasoning parts — they are model-internal thinking
        return null;
      }

      return null;
    }

    case 'message.updated': {
      const properties = ev['properties'] as Record<string, unknown> | undefined;
      if (!properties) return null;

      const info = properties['info'] as Record<string, unknown> | undefined;
      if (!info) return null;

      // Check if this is a completed assistant message
      if (info['role'] === 'assistant' && info['finish']) {
        const cost = typeof info['cost'] === 'number' ? info['cost'] : 0;
        const tokens = info['tokens'] as Record<string, number> | undefined;
        return {
          type: 'done',
          cost,
          tokens: tokens ? { input: tokens['input'] ?? 0, output: tokens['output'] ?? 0 } : undefined,
        };
      }

      return null;
    }

    case 'session.idle':
      return { type: 'done' };

    case 'session.status': {
      const properties = ev['properties'] as Record<string, unknown> | undefined;
      if (!properties) return null;

      const status = properties['status'] as Record<string, unknown> | undefined;
      if (status && status['type'] === 'idle') {
        return { type: 'done' };
      }

      return null;
    }

    case 'session.error': {
      const properties = ev['properties'] as Record<string, unknown> | undefined;
      const error = typeof properties?.['error'] === 'string' ? properties['error'] : 'Unknown OpenCode error';
      return {
        type: 'done',
        finalText: `Error: ${error}`,
      };
    }

    default:
      return null;
  }
}
