import type { CodingAdapter, AdapterOutputChunk, AdapterResult, AdapterSessionInfo } from '../types.js';

export interface CodexAdapterConfig {
  cwd?: string;
}

export function createCodexAdapter(_config: CodexAdapterConfig): CodingAdapter {
  return {
    backendType: 'codex' as const,

    async startSession(): Promise<{ backendSessionId: string }> {
      throw new Error('Codex backend is not yet implemented');
    },

    async attachSession(_backendSessionId: string): Promise<{ backendSessionId: string }> {
      throw new Error('Codex backend is not yet implemented');
    },

    async sendPrompt(
      _sessionId: string,
      _prompt: string,
      _onChunk?: (chunk: AdapterOutputChunk) => void,
    ): Promise<AdapterResult> {
      throw new Error('Codex backend is not yet implemented');
    },

    async stopSession(): Promise<void> {
      throw new Error('Codex backend is not yet implemented');
    },

    async resetSession(): Promise<{ backendSessionId: string }> {
      throw new Error('Codex backend is not yet implemented');
    },

    getStatus(): AdapterSessionInfo {
      return { state: 'idle' };
    },
  };
}
