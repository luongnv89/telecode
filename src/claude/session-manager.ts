import { v4 as uuidv4 } from 'uuid';
import type { Session, SessionState } from '../types/session.js';
import type { ClaudeAdapter } from './adapter.js';

export class SessionManager {
  private session: Session | null = null;
  private adapter: ClaudeAdapter;

  constructor(adapter: ClaudeAdapter) {
    this.adapter = adapter;
  }

  getSession(): Session | null {
    return this.session;
  }

  isActive(): boolean {
    return this.session !== null && this.session.state !== 'stopped';
  }

  async startSession(userId: number, chatId: number): Promise<Session> {
    if (this.isActive()) {
      throw new Error('A session is already active. Stop it first or use /new_session.');
    }

    const sessionId = uuidv4();
    const now = new Date();

    this.session = {
      sessionId,
      userId,
      chatId,
      state: 'active',
      startedAt: now,
      lastActivityAt: now,
    };

    const claudeSession = await this.adapter.startSession();
    this.session.claudeSessionId = claudeSession.claudeSessionId;

    return this.session;
  }

  async stopSession(): Promise<void> {
    if (!this.session) return;

    await this.adapter.stopSession();
    this.session.state = 'stopped';
    this.session = null;
  }

  async resetSession(): Promise<Session> {
    if (!this.session) {
      throw new Error('No active session to reset.');
    }

    const { userId, chatId } = this.session;
    await this.stopSession();
    return this.startSession(userId, chatId);
  }

  updateState(state: SessionState): void {
    if (this.session) {
      this.session.state = state;
      this.session.lastActivityAt = new Date();
    }
  }
}
