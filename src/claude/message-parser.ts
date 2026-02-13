import type {
  SDKAssistantMessage,
  SDKResultMessage,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';

export interface ClaudeOutputChunk {
  type: 'text' | 'tool_use' | 'tool_result';
  content: string;
}

export interface ClaudeResult {
  success: boolean;
  text: string;
  durationMs: number;
  totalCostUsd: number;
  numTurns: number;
  errors?: string[];
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

export function parseResultMessage(message: SDKResultMessage): ClaudeResult {
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

export function parseOutputChunk(message: SDKMessage): ClaudeOutputChunk | null {
  switch (message.type) {
    case 'assistant': {
      const text = extractTextFromAssistant(message);
      if (!text) return null;
      return { type: 'text', content: text };
    }

    case 'user': {
      // User messages that contain tool results
      if (message.tool_use_result) {
        const content =
          typeof message.tool_use_result === 'string'
            ? message.tool_use_result
            : JSON.stringify(message.tool_use_result);
        return { type: 'tool_result', content };
      }
      return null;
    }

    default:
      return null;
  }
}
