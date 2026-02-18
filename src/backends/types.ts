import type { SessionState } from '../types/session.js';

export type BackendType = 'claude' | 'opencode' | 'codex';

export interface AdapterOutputChunk {
  type: 'text' | 'tool_use' | 'tool_result';
  content: string;
}

export interface AdapterResult {
  success: boolean;
  text: string;
  durationMs: number;
  totalCostUsd: number;
  numTurns: number;
  errors?: string[];
}

export interface AdapterSessionInfo {
  backendSessionId?: string;
  state: SessionState;
}

export interface CodingAdapter {
  readonly backendType: BackendType;
  startSession(): Promise<{ backendSessionId: string }>;
  attachSession(backendSessionId: string): Promise<{ backendSessionId: string }>;
  sendPrompt(
    sessionId: string,
    prompt: string,
    onChunk?: (chunk: AdapterOutputChunk) => void,
  ): Promise<AdapterResult>;
  stopSession(): Promise<void>;
  resetSession(): Promise<{ backendSessionId: string }>;
  getStatus(): AdapterSessionInfo;
}
