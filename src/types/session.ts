export type SessionState = 'idle' | 'starting' | 'active' | 'busy' | 'stopping' | 'resetting' | 'stopped';

export interface Session {
  sessionId: string;
  claudeSessionId?: string;
  userId: number;
  chatId: number;
  state: SessionState;
  startedAt: Date;
  lastActivityAt: Date;
  workingDirectory: string;
  name?: string;
}

/** Serializable session metadata for JSON persistence. */
export interface SessionMetadata {
  sessionId: string;
  claudeSessionId?: string;
  name?: string;
  workingDirectory: string;
  userId: number;
  chatId: number;
  startedAt: string;
  lastActivityAt: string;
}

/** Persisted state for the full session registry. */
export interface PersistedRegistryState {
  sessions: SessionMetadata[];
  focusMap: Record<number, string>;
  version: number;
}
