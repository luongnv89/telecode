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
        const toolId = typeof part['toolID'] === 'string' ? part['toolID'] : '';
        const toolName = typeof part['toolName'] === 'string' ? part['toolName'] : '';
        const status = typeof state?.['status'] === 'string' ? state['status'] : '';

        // Build the most descriptive label we can from the event
        const label = title || summarizeOpencodeTool(toolName || toolId, state) || toolName || toolId || 'tool';

        if (status === 'running' || status === 'pending') {
          return { type: 'chunk', chunk: { type: 'tool_use', content: label } };
        }

        if (status === 'completed') {
          const output = typeof state?.['output'] === 'string' ? state['output'] : '';
          const summary = output
            ? `${label} ✓ ${output.slice(0, 150).replace(/\n/g, ' ')}`
            : `${label} ✓`;
          return { type: 'chunk', chunk: { type: 'tool_result', content: summary } };
        }

        if (status === 'error') {
          const error = typeof state?.['error'] === 'string' ? state['error'] : 'Tool error';
          return { type: 'chunk', chunk: { type: 'tool_result', content: `${label} ✗ ${error}` } };
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

/**
 * Attempt to build a human-readable summary from an OpenCode tool's state.
 * OpenCode tools may carry input/arguments in state metadata.
 */
function summarizeOpencodeTool(
  toolName: string,
  state: Record<string, unknown> | undefined,
): string {
  if (!state) return '';

  const input = state['input'] as Record<string, unknown> | undefined;
  const metadata = state['metadata'] as Record<string, unknown> | undefined;
  const args = input || metadata;

  const name = toolName.replace(/^(tool_|mcp_)/, '');

  if (!args) return name || '';

  // Common tool patterns (similar to Claude's tool names)
  const filePath = args['file_path'] ?? args['path'] ?? args['filePath'];
  const command = args['command'] ?? args['cmd'];
  const pattern = args['pattern'] ?? args['query'];

  if (filePath && typeof filePath === 'string') {
    const action = name || 'File';
    return `${action}: ${filePath}`;
  }
  if (command && typeof command === 'string') {
    const cmd = String(command).slice(0, 80);
    return `${name || 'Shell'}: ${cmd}${String(command).length > 80 ? '...' : ''}`;
  }
  if (pattern && typeof pattern === 'string') {
    return `${name || 'Search'}: ${pattern}`;
  }

  return name || '';
}
