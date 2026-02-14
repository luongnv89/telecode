import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKMessage,
  SDKResultMessage,
  Query,
} from '@anthropic-ai/claude-agent-sdk';
import type { SessionState } from '../types/session.js';
import { parseOutputChunk, parseResultMessage, type ClaudeOutputChunk, type ClaudeResult } from './message-parser.js';

export interface ClaudeSessionConfig {
  model?: string;
  cwd?: string;
  allowedTools?: string[];
}

export interface ClaudeSessionInfo {
  sessionId?: string;
  claudeSessionId?: string;
  state: SessionState;
}

export interface ClaudeAdapter {
  startSession(): Promise<{ claudeSessionId: string }>;
  attachSession(claudeSessionId: string): Promise<{ claudeSessionId: string }>;
  sendPrompt(
    sessionId: string,
    prompt: string,
    onChunk?: (chunk: ClaudeOutputChunk) => void,
  ): Promise<ClaudeResult>;
  stopSession(): Promise<void>;
  resetSession(): Promise<{ claudeSessionId: string }>;
  getStatus(): ClaudeSessionInfo;
}

export function createClaudeAdapter(config: ClaudeSessionConfig): ClaudeAdapter {
  let claudeSessionId: string | undefined;
  let state: SessionState = 'idle';
  let currentQuery: Query | null = null;

  return {
    async startSession(): Promise<{ claudeSessionId: string }> {
      state = 'active';

      // Make an initial query to establish session
      const q = query({
        prompt: 'Hello. Ready for instructions.',
        options: {
          model: config.model,
          cwd: config.cwd,
          allowedTools: config.allowedTools,
        },
      });

      for await (const message of q) {
        if (message.type === 'system' && message.subtype === 'init') {
          claudeSessionId = message.session_id;
        }
      }

      if (!claudeSessionId) {
        state = 'idle';
        throw new Error('Failed to establish Claude session — no session ID received');
      }

      return { claudeSessionId };
    },

    async attachSession(targetClaudeSessionId: string): Promise<{ claudeSessionId: string }> {
      state = 'active';

      // Use resume to reconnect to an existing Claude session
      const q = query({
        prompt: 'Session resumed. Ready for instructions.',
        options: {
          model: config.model,
          resume: targetClaudeSessionId,
        },
      });

      for await (const message of q) {
        if ('session_id' in message && message.session_id) {
          claudeSessionId = message.session_id;
        }
      }

      if (!claudeSessionId) {
        state = 'idle';
        throw new Error('Failed to attach to Claude session — no session ID received');
      }

      return { claudeSessionId };
    },

    async sendPrompt(
      _sessionId: string,
      prompt: string,
      onChunk?: (chunk: ClaudeOutputChunk) => void,
    ): Promise<ClaudeResult> {
      if (!claudeSessionId) {
        throw new Error('No active Claude session. Call startSession() first.');
      }

      state = 'busy';
      let resultMessage: SDKResultMessage | undefined;

      const q = query({
        prompt,
        options: {
          model: config.model,
          resume: claudeSessionId,
        },
      });
      currentQuery = q;

      for await (const message of q) {
        // Update session ID in case it changed
        if ('session_id' in message && message.session_id) {
          claudeSessionId = message.session_id;
        }

        if (message.type === 'result') {
          resultMessage = message;
        } else if (onChunk) {
          const chunk = parseOutputChunk(message);
          if (chunk) onChunk(chunk);
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
      claudeSessionId = undefined;
      state = 'idle';
    },

    async resetSession(): Promise<{ claudeSessionId: string }> {
      await this.stopSession();
      return this.startSession();
    },

    getStatus(): ClaudeSessionInfo {
      return {
        claudeSessionId,
        state,
      };
    },
  };
}
