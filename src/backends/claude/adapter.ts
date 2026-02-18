import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKResultMessage,
  Query,
  CanUseTool,
} from '@anthropic-ai/claude-agent-sdk';
import type { CodingAdapter, AdapterOutputChunk, AdapterResult, AdapterSessionInfo } from '../types.js';
import type { SessionState } from '../../types/session.js';
import { parseOutputChunks, parseResultMessage } from './message-parser.js';

export interface ClaudeAdapterConfig {
  model?: string;
  cwd?: string;
  allowedTools?: string[];
  canUseTool?: CanUseTool;
}

export function createClaudeAdapter(config: ClaudeAdapterConfig): CodingAdapter {
  let backendSessionId: string | undefined;
  let state: SessionState = 'idle';
  let currentQuery: Query | null = null;

  return {
    backendType: 'claude' as const,

    async startSession(): Promise<{ backendSessionId: string }> {
      state = 'active';

      const q = query({
        prompt: 'Hello. Ready for instructions.',
        options: {
          model: config.model,
          cwd: config.cwd,
          allowedTools: config.allowedTools,
          canUseTool: config.canUseTool,
        },
      });

      for await (const message of q) {
        if (message.type === 'system' && message.subtype === 'init') {
          backendSessionId = message.session_id;
        }
      }

      if (!backendSessionId) {
        state = 'idle';
        throw new Error('Failed to establish Claude session — no session ID received');
      }

      return { backendSessionId };
    },

    async attachSession(targetId: string): Promise<{ backendSessionId: string }> {
      state = 'active';

      const q = query({
        prompt: 'Session resumed. Ready for instructions.',
        options: {
          model: config.model,
          resume: targetId,
          canUseTool: config.canUseTool,
        },
      });

      for await (const message of q) {
        if ('session_id' in message && message.session_id) {
          backendSessionId = message.session_id;
        }
      }

      if (!backendSessionId) {
        state = 'idle';
        throw new Error('Failed to attach to Claude session — no session ID received');
      }

      return { backendSessionId };
    },

    async sendPrompt(
      _sessionId: string,
      prompt: string,
      onChunk?: (chunk: AdapterOutputChunk) => void,
    ): Promise<AdapterResult> {
      if (!backendSessionId) {
        throw new Error('No active Claude session. Call startSession() first.');
      }

      state = 'busy';
      let resultMessage: SDKResultMessage | undefined;

      const q = query({
        prompt,
        options: {
          model: config.model,
          resume: backendSessionId,
          canUseTool: config.canUseTool,
        },
      });
      currentQuery = q;

      for await (const message of q) {
        if ('session_id' in message && message.session_id) {
          backendSessionId = message.session_id;
        }

        if (message.type === 'result') {
          resultMessage = message;
        } else if (onChunk) {
          const chunks = parseOutputChunks(message);
          for (const chunk of chunks) {
            onChunk(chunk);
          }
        }
      }

      currentQuery = null;
      state = 'active';

      if (!resultMessage) {
        return {
          success: false,
          text: 'No result received from Claude',
          durationMs: 0,
          totalCostUsd: 0,
          numTurns: 0,
          errors: ['No result message in response stream'],
        };
      }

      return parseResultMessage(resultMessage);
    },

    async stopSession(): Promise<void> {
      if (currentQuery) {
        await currentQuery.interrupt();
        currentQuery = null;
      }
      backendSessionId = undefined;
      state = 'idle';
    },

    async resetSession(): Promise<{ backendSessionId: string }> {
      await this.stopSession();
      return this.startSession();
    },

    getStatus(): AdapterSessionInfo {
      return {
        backendSessionId,
        state,
      };
    },
  };
}
