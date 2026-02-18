import type {
  SDKAssistantMessage,
  SDKResultMessage,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AdapterOutputChunk, AdapterResult } from '../types.js';

export function summarizeToolUse(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
      return input.file_path ? `${name}: ${input.file_path}` : `${name}`;
    case 'Bash':
      if (input.command) {
        const cmd = String(input.command).slice(0, 60);
        return `Bash: ${cmd}${String(input.command).length > 60 ? '...' : ''}`;
      }
      return 'Bash';
    case 'Grep':
      if (input.pattern) {
        const path = input.path ? ` in ${input.path}` : '';
        return `Grep: ${input.pattern}${path}`;
      }
      return 'Grep';
    case 'Glob':
      return input.pattern ? `Glob: ${input.pattern}` : 'Glob';
    case 'Task':
      return input.description ? `Task: ${input.description}` : 'Task';
    default:
      return name;
  }
}

export function extractTextFromAssistant(message: SDKAssistantMessage): string {
  const content = message.message.content;
  if (typeof content === 'string') return content;

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

export function parseResultMessage(message: SDKResultMessage): AdapterResult {
  if (message.subtype === 'success') {
    return {
      success: true,
      text: message.result,
      durationMs: message.duration_ms,
      totalCostUsd: message.total_cost_usd,
      numTurns: message.num_turns,
    };
  }

  return {
    success: false,
    text: message.errors?.join('\n') ?? 'Unknown error',
    durationMs: message.duration_ms,
    totalCostUsd: message.total_cost_usd,
    numTurns: message.num_turns,
    errors: message.errors,
  };
}

export function parseOutputChunks(message: SDKMessage): AdapterOutputChunk[] {
  switch (message.type) {
    case 'assistant': {
      const chunks: AdapterOutputChunk[] = [];
      const content = message.message.content;

      if (typeof content === 'string') {
        if (content) chunks.push({ type: 'text', content });
        return chunks;
      }

      for (const block of content) {
        if (block.type === 'text' && block.text) {
          chunks.push({ type: 'text', content: block.text });
        } else if (block.type === 'tool_use') {
          const summary = summarizeToolUse(block.name, (block.input ?? {}) as Record<string, unknown>);
          chunks.push({ type: 'tool_use', content: summary });
        }
      }
      return chunks;
    }

    case 'tool_progress': {
      const toolMsg = message as { tool_name: string };
      return [{ type: 'tool_use', content: toolMsg.tool_name }];
    }

    case 'user': {
      if (message.tool_use_result) {
        const content =
          typeof message.tool_use_result === 'string'
            ? message.tool_use_result
            : JSON.stringify(message.tool_use_result);
        return [{ type: 'tool_result', content }];
      }
      return [];
    }

    default:
      return [];
  }
}

/** @deprecated Use parseOutputChunks instead */
export function parseOutputChunk(message: SDKMessage): AdapterOutputChunk | null {
  const chunks = parseOutputChunks(message);
  return chunks.length > 0 ? chunks[0] : null;
}
