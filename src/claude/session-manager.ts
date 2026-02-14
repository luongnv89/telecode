import { v4 as uuidv4 } from 'uuid';
import type { Session, SessionState } from '../types/session.js';
import type { ClaudeAdapter } from './adapter.js';

/** A recorded state transition for audit/query purposes. */
export interface StateTransition {
  from: SessionState | 'none';
  to: SessionState;
  timestamp: Date;
  sessionId: string;
}

export class SessionManager {
  private session: Session | null = null;
  private adapter: ClaudeAdapter;
  private transitions: StateTransition[] = [];

  constructor(adapter: ClaudeAdapter) {
    this.adapter = adapter;
  }

  getSession(): Session | null {
    return this.session;
  }

  isActive(): boolean {
    return this.session !== null && this.session.state !== 'stopped';
  }

  /** Return the full list of state transitions (for audit queries). */
  getTransitions(): StateTransition[] {
    return [...this.transitions];
  }

  /** Return transitions for a specific session ID. */
  getTransitionsForSession(sessionId: string): StateTransition[] {
    return this.transitions.filter((t) => t.sessionId === sessionId);
  }

  async startSession(
    userId: number,
    chatId: number,
    workingDirectory: string = process.cwd(),
    name?: string,
  ): Promise<Session> {
    if (this.isActive()) {
      throw new Error('A session is already active. Stop it first or use /new_session.');
    }

    const sessionId = uuidv4();
    const now = new Date();

    this.session = {
      sessionId,
      userId,
      chatId,
      state: 'starting',
      startedAt: now,
      lastActivityAt: now,
      workingDirectory,
      name,
    };

    this.recordTransition('none', 'starting', sessionId);

    const claudeSession = await this.adapter.startSession();
    this.session.claudeSessionId = claudeSession.claudeSessionId;
    this.session.state = 'active';
    this.recordTransition('starting', 'active', sessionId);

    return this.session;
  }

  async resumeSession(
    userId: number,
    chatId: number,
    workingDirectory: string,
    claudeSessionIdToResume: string,
    name?: string,
  ): Promise<Session> {
    if (this.isActive()) {
      throw new Error('A session is already active. Stop it first.');
    }

    const sessionId = uuidv4();
    const now = new Date();

    this.session = {
      sessionId,
      userId,
      chatId,
      state: 'starting',
      startedAt: now,
      lastActivityAt: now,
      workingDirectory,
      name,
    };

    this.recordTransition('none', 'starting', sessionId);

    const claudeSession = await this.adapter.attachSession(claudeSessionIdToResume);
    this.session.claudeSessionId = claudeSession.claudeSessionId;
    this.session.state = 'active';
    this.recordTransition('starting', 'active', sessionId);

    return this.session;
  }

  async stopSession(): Promise<void> {
    if (!this.session) return;

    const { sessionId, state } = this.session;
    this.session.state = 'stopping';
    this.recordTransition(state, 'stopping', sessionId);

    await this.adapter.stopSession();

    this.recordTransition('stopping', 'stopped', sessionId);
    this.session.state = 'stopped';
    this.session = null;
  }

  async resetSession(): Promise<Session> {
    if (!this.session) {
      throw new Error('No active session to reset.');
    }

    const { userId, chatId, sessionId, state, workingDirectory, name } = this.session;
    this.recordTransition(state, 'resetting', sessionId);

    await this.stopSession();
    return this.startSession(userId, chatId, workingDirectory, name);
  }

  updateState(state: SessionState): void {
    if (this.session) {
      const prevState = this.session.state;
      this.session.state = state;
      this.session.lastActivityAt = new Date();
      this.recordTransition(prevState, state, this.session.sessionId);
    }
  }

  private recordTransition(from: SessionState | 'none', to: SessionState, sessionId: string): void {
    this.transitions.push({
      from,
      to,
      timestamp: new Date(),
      sessionId,
    });
  }
}
