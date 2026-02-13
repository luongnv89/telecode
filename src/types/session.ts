export type SessionState = 'idle' | 'active' | 'busy' | 'stopped';

export interface Session {
  sessionId: string;
  claudeSessionId?: string;
  userId: number;
  chatId: number;
  state: SessionState;
  startedAt: Date;
  lastActivityAt: Date;
}
