export type SessionState = 'idle' | 'starting' | 'active' | 'busy' | 'stopping' | 'resetting' | 'stopped';

export interface Session {
  sessionId: string;
  claudeSessionId?: string;
  userId: number;
  chatId: number;
  state: SessionState;
  startedAt: Date;
  lastActivityAt: Date;
}
