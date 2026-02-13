import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../src/claude/session-manager.js';
import type { ClaudeAdapter } from '../../src/claude/adapter.js';

function createMockAdapter(): ClaudeAdapter {
  return {
    startSession: vi.fn().mockResolvedValue({ claudeSessionId: 'claude-abc' }),
    sendPrompt: vi.fn().mockResolvedValue({
      success: true,
      text: 'ok',
      durationMs: 50,
      totalCostUsd: 0,
      numTurns: 1,
    }),
    stopSession: vi.fn().mockResolvedValue(undefined),
    resetSession: vi.fn().mockResolvedValue({ claudeSessionId: 'claude-def' }),
    getStatus: vi.fn().mockReturnValue({ claudeSessionId: undefined, state: 'idle' }),
  };
}

describe('SessionManager', () => {
  let adapter: ClaudeAdapter;
  let mgr: SessionManager;

  beforeEach(() => {
    adapter = createMockAdapter();
    mgr = new SessionManager(adapter);
  });

  describe('startSession', () => {
    it('creates a session with correct user and chat', async () => {
      const session = await mgr.startSession(42, 100);

      expect(session.userId).toBe(42);
      expect(session.chatId).toBe(100);
      expect(session.state).toBe('active');
      expect(session.claudeSessionId).toBe('claude-abc');
      expect(session.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('calls adapter.startSession', async () => {
      await mgr.startSession(1, 1);
      expect(adapter.startSession).toHaveBeenCalledOnce();
    });

    it('throws when a session is already active', async () => {
      await mgr.startSession(1, 1);
      await expect(mgr.startSession(2, 2)).rejects.toThrow('already active');
    });

    it('records starting → active transitions', async () => {
      await mgr.startSession(1, 1);
      const transitions = mgr.getTransitions();

      expect(transitions.length).toBeGreaterThanOrEqual(2);
      expect(transitions[0].from).toBe('none');
      expect(transitions[0].to).toBe('starting');
      expect(transitions[1].from).toBe('starting');
      expect(transitions[1].to).toBe('active');
    });
  });

  describe('stopSession', () => {
    it('stops the session and clears it', async () => {
      await mgr.startSession(1, 1);
      await mgr.stopSession();

      expect(mgr.getSession()).toBeNull();
      expect(mgr.isActive()).toBe(false);
    });

    it('calls adapter.stopSession', async () => {
      await mgr.startSession(1, 1);
      await mgr.stopSession();
      expect(adapter.stopSession).toHaveBeenCalledOnce();
    });

    it('does nothing when no session exists', async () => {
      await mgr.stopSession();
      expect(adapter.stopSession).not.toHaveBeenCalled();
    });

    it('records stopping → stopped transitions', async () => {
      await mgr.startSession(1, 1);
      await mgr.stopSession();

      const transitions = mgr.getTransitions();
      const stoppingT = transitions.find((t) => t.to === 'stopping');
      const stoppedT = transitions.find((t) => t.to === 'stopped');

      expect(stoppingT).toBeDefined();
      expect(stoppedT).toBeDefined();
      expect(stoppingT!.from).toBe('active');
      expect(stoppedT!.from).toBe('stopping');
    });
  });

  describe('resetSession', () => {
    it('stops old session and starts new one', async () => {
      const first = await mgr.startSession(1, 1);
      const second = await mgr.resetSession();

      expect(second.sessionId).not.toBe(first.sessionId);
      expect(second.userId).toBe(1);
      expect(second.chatId).toBe(1);
      expect(second.state).toBe('active');
    });

    it('throws when no session exists', async () => {
      await expect(mgr.resetSession()).rejects.toThrow('No active session');
    });

    it('records resetting transition', async () => {
      await mgr.startSession(1, 1);
      await mgr.resetSession();

      const transitions = mgr.getTransitions();
      const resettingT = transitions.find((t) => t.to === 'resetting');
      expect(resettingT).toBeDefined();
    });
  });

  describe('isActive', () => {
    it('returns false when no session', () => {
      expect(mgr.isActive()).toBe(false);
    });

    it('returns true when session is active', async () => {
      await mgr.startSession(1, 1);
      expect(mgr.isActive()).toBe(true);
    });

    it('returns false after session is stopped', async () => {
      await mgr.startSession(1, 1);
      await mgr.stopSession();
      expect(mgr.isActive()).toBe(false);
    });
  });

  describe('updateState', () => {
    it('updates session state and records transition', async () => {
      await mgr.startSession(1, 1);
      mgr.updateState('busy');

      expect(mgr.getSession()?.state).toBe('busy');

      const transitions = mgr.getTransitions();
      const busyT = transitions.find((t) => t.to === 'busy');
      expect(busyT).toBeDefined();
      expect(busyT!.from).toBe('active');
    });

    it('does nothing when no session exists', () => {
      // Should not throw
      mgr.updateState('busy');
      expect(mgr.getSession()).toBeNull();
    });
  });

  describe('getTransitions', () => {
    it('returns empty array initially', () => {
      expect(mgr.getTransitions()).toEqual([]);
    });

    it('returns a copy (not a reference)', async () => {
      await mgr.startSession(1, 1);
      const t1 = mgr.getTransitions();
      const t2 = mgr.getTransitions();
      expect(t1).toEqual(t2);
      expect(t1).not.toBe(t2);
    });
  });

  describe('getTransitionsForSession', () => {
    it('filters transitions by session ID', async () => {
      const first = await mgr.startSession(1, 1);
      const firstId = first.sessionId;
      await mgr.stopSession();

      const second = await mgr.startSession(1, 1);
      const secondId = second.sessionId;

      const firstTransitions = mgr.getTransitionsForSession(firstId);
      const secondTransitions = mgr.getTransitionsForSession(secondId);

      expect(firstTransitions.every((t) => t.sessionId === firstId)).toBe(true);
      expect(secondTransitions.every((t) => t.sessionId === secondId)).toBe(true);
      expect(firstTransitions.length).toBeGreaterThan(0);
      expect(secondTransitions.length).toBeGreaterThan(0);
    });

    it('returns empty array for unknown session ID', () => {
      expect(mgr.getTransitionsForSession('nonexistent')).toEqual([]);
    });
  });
});
