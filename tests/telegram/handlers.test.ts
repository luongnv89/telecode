import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCommandHandlers, type HandlerDeps } from '../../src/telegram/commands/handlers.js';
import type { ClaudeAdapter } from '../../src/claude/adapter.js';
import type { TelegramSender } from '../../src/telegram/sender.js';
import type { AuditWriter } from '../../src/audit/writer.js';
import type { SessionManager } from '../../src/claude/session-manager.js';
import type { ValidatedCommand } from '../../src/types/commands.js';
import type { ResponseEnvelope } from '../../src/types/envelope.js';
import type { Session } from '../../src/types/session.js';
import { TelecodeError } from '../../src/types/errors.js';

// ---- Helpers ----

function makeCommand(
  type: string,
  overrides?: Partial<ValidatedCommand['context']> & { prompt?: string },
): ValidatedCommand {
  const base: ValidatedCommand['context'] = {
    userId: 123,
    chatId: 456,
    messageId: 1,
    timestamp: new Date(),
    rawText: `/${type}${overrides?.prompt ? ' ' + overrides.prompt : ''}`,
    ...overrides,
  };

  if (type === 'send') {
    return {
      command: { type: 'send', prompt: overrides?.prompt ?? 'hello' },
      context: base,
    };
  }

  return {
    command: { type } as any,
    context: base,
  };
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    sessionId: 'sess-001',
    claudeSessionId: 'claude-001',
    userId: 123,
    chatId: 456,
    state: 'active',
    startedAt: new Date('2025-01-01T00:00:00Z'),
    lastActivityAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function createMockAdapter(): ClaudeAdapter {
  return {
    startSession: vi.fn().mockResolvedValue({ claudeSessionId: 'claude-001' }),
    sendPrompt: vi.fn().mockResolvedValue({
      success: true,
      text: 'Claude says hello',
      durationMs: 150,
      totalCostUsd: 0.002,
      numTurns: 1,
    }),
    stopSession: vi.fn().mockResolvedValue(undefined),
    resetSession: vi.fn().mockResolvedValue({ claudeSessionId: 'claude-002' }),
    getStatus: vi.fn().mockReturnValue({ claudeSessionId: 'claude-001', state: 'active' }),
  };
}

function createMockSender(): TelegramSender {
  return {
    sendResponse: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAuditWriter(): AuditWriter {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockSessionManager(session: Session | null = null): SessionManager {
  let currentSession = session;
  return {
    getSession: vi.fn(() => currentSession),
    isActive: vi.fn(() => currentSession !== null && currentSession.state !== 'stopped'),
    startSession: vi.fn(async (userId: number, chatId: number) => {
      currentSession = makeSession({ userId, chatId });
      return currentSession;
    }),
    stopSession: vi.fn(async () => {
      if (currentSession) currentSession.state = 'stopped';
      currentSession = null;
    }),
    resetSession: vi.fn(async () => {
      currentSession = makeSession({ sessionId: 'sess-002', claudeSessionId: 'claude-002' });
      return currentSession;
    }),
    updateState: vi.fn((state) => {
      if (currentSession) currentSession.state = state;
    }),
  } as unknown as SessionManager;
}

// ---- Tests ----

describe('command handlers', () => {
  let adapter: ClaudeAdapter;
  let sender: TelegramSender;
  let auditWriter: AuditWriter;
  let sessionManager: SessionManager;
  let deps: HandlerDeps;

  beforeEach(() => {
    adapter = createMockAdapter();
    sender = createMockSender();
    auditWriter = createMockAuditWriter();
    sessionManager = createMockSessionManager();
    deps = { claudeAdapter: adapter, sessionManager, sender, auditWriter };
  });

  describe('/start_session', () => {
    it('creates a session and returns ack', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      const result = await handlers.start_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('ack');
      if (result!.type === 'ack') {
        expect(result!.commandType).toBe('start_session');
      }
      expect(sessionManager.startSession).toHaveBeenCalledWith(123, 456);
    });

    it('opens audit writer with session info', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      await handlers.start_session(cmd);

      expect(auditWriter.open).toHaveBeenCalled();
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'session_started' }),
      );
    });

    it('returns error when session already active', async () => {
      (sessionManager.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('A session is already active. Stop it first or use /new_session.'),
      );

      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      const result = await handlers.start_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.message).toContain('already active');
      }
    });

    it('handles TelecodeError with proper code', async () => {
      (sessionManager.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        new TelecodeError('Session locked', 'SESSION_LOCKED', { recoverable: true }),
      );

      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      const result = await handlers.start_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('SESSION_LOCKED');
      }
    });
  });

  describe('/send', () => {
    it('calls adapter.sendPrompt and returns result', async () => {
      sessionManager = createMockSessionManager(makeSession());
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('send', { prompt: 'write a test' });

      const result = await handlers.send(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toBe('Claude says hello');
      }
      expect(adapter.sendPrompt).toHaveBeenCalledWith(
        'sess-001',
        'write a test',
        expect.any(Function),
      );
    });

    it('returns error when no session is active', async () => {
      // sessionManager default has no session
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('send', { prompt: 'hello' });

      const result = await handlers.send(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('SESSION_NOT_FOUND');
      }
    });

    it('returns error for wrong command type', async () => {
      const handlers = createCommandHandlers(deps);
      // Simulate a misrouted command
      const cmd: ValidatedCommand = {
        command: { type: 'status' },
        context: {
          userId: 123,
          chatId: 456,
          messageId: 1,
          timestamp: new Date(),
          rawText: '/status',
        },
      };

      const result = await handlers.send(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('INTERNAL_ERROR');
      }
    });

    it('updates state to busy then back to active', async () => {
      sessionManager = createMockSessionManager(makeSession());
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('send', { prompt: 'hello' });

      await handlers.send(cmd);

      expect(sessionManager.updateState).toHaveBeenCalledWith('busy');
      expect(sessionManager.updateState).toHaveBeenCalledWith('active');
    });

    it('writes audit events for command and output', async () => {
      sessionManager = createMockSessionManager(makeSession());
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('send', { prompt: 'hello' });

      await handlers.send(cmd);

      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'command_received', commandType: 'send' }),
      );
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'output_delivered' }),
      );
    });

    it('sends progress chunks via sender', async () => {
      sessionManager = createMockSessionManager(makeSession());
      // Override sendPrompt to call onChunk
      (adapter.sendPrompt as ReturnType<typeof vi.fn>).mockImplementation(
        async (_sid: string, _prompt: string, onChunk?: (chunk: any) => void) => {
          if (onChunk) {
            onChunk({ type: 'text', content: 'partial response' });
          }
          return {
            success: true,
            text: 'full response',
            durationMs: 100,
            totalCostUsd: 0.001,
            numTurns: 1,
          };
        },
      );
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('send', { prompt: 'hello' });

      await handlers.send(cmd);

      expect(sender.sendResponse).toHaveBeenCalledWith(
        456,
        expect.objectContaining({ type: 'progress', text: 'partial response' }),
      );
    });

    it('returns CLAUDE_ERROR when adapter result is not successful', async () => {
      sessionManager = createMockSessionManager(makeSession());
      (adapter.sendPrompt as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        text: 'Something went wrong',
        durationMs: 50,
        totalCostUsd: 0,
        numTurns: 0,
        errors: ['Something went wrong'],
      });
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('send', { prompt: 'hello' });

      const result = await handlers.send(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('CLAUDE_ERROR');
        expect(result!.message).toBe('Something went wrong');
      }
    });

    it('recovers state to active when adapter throws', async () => {
      sessionManager = createMockSessionManager(makeSession());
      (adapter.sendPrompt as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection lost'),
      );
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('send', { prompt: 'hello' });

      const result = await handlers.send(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      // State should be reset to active after error
      expect(sessionManager.updateState).toHaveBeenLastCalledWith('active');
    });
  });

  describe('/status', () => {
    it('returns status with active session info', async () => {
      const session = makeSession();
      sessionManager = createMockSessionManager(session);
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('status');

      const result = await handlers.status(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('status');
      if (result!.type === 'status') {
        expect(result!.sessionActive).toBe(true);
        expect(result!.sessionId).toBe('sess-001');
        expect(result!.state).toBe('active');
        expect(result!.uptime).toBeDefined();
      }
    });

    it('returns status with no active session', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('status');

      const result = await handlers.status(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('status');
      if (result!.type === 'status') {
        expect(result!.sessionActive).toBe(false);
        expect(result!.sessionId).toBeUndefined();
      }
    });

    it('falls back to claude adapter state when no session', async () => {
      (adapter.getStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        claudeSessionId: undefined,
        state: 'idle',
      });
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('status');

      const result = await handlers.status(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('status');
      if (result!.type === 'status') {
        expect(result!.state).toBe('idle');
      }
    });
  });

  describe('/stop', () => {
    it('stops the session and closes audit writer', async () => {
      sessionManager = createMockSessionManager(makeSession());
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('stop');

      const result = await handlers.stop(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('ack');
      if (result!.type === 'ack') {
        expect(result!.commandType).toBe('stop');
      }
      expect(sessionManager.stopSession).toHaveBeenCalled();
      expect(auditWriter.close).toHaveBeenCalled();
    });

    it('writes session_stopped audit event', async () => {
      sessionManager = createMockSessionManager(makeSession());
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('stop');

      await handlers.stop(cmd);

      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'session_stopped', sessionId: 'sess-001' }),
      );
    });

    it('handles stop when no session exists gracefully', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('stop');

      const result = await handlers.stop(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('ack');
      expect(sessionManager.stopSession).toHaveBeenCalled();
      expect(auditWriter.close).toHaveBeenCalled();
      // Should NOT have written audit event since there was no session
      expect(auditWriter.write).not.toHaveBeenCalled();
    });

    it('returns error envelope when stopSession throws', async () => {
      sessionManager = createMockSessionManager(makeSession());
      (sessionManager.stopSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        new TelecodeError('Claude timeout', 'CLAUDE_TIMEOUT'),
      );
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('stop');

      const result = await handlers.stop(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('CLAUDE_TIMEOUT');
      }
    });
  });

  describe('/new_session', () => {
    it('resets session and returns ack', async () => {
      sessionManager = createMockSessionManager(makeSession());
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('new_session');

      const result = await handlers.new_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('ack');
      if (result!.type === 'ack') {
        expect(result!.commandType).toBe('new_session');
      }
      expect(sessionManager.resetSession).toHaveBeenCalled();
    });

    it('writes session_reset audit event for old session', async () => {
      sessionManager = createMockSessionManager(makeSession());
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('new_session');

      await handlers.new_session(cmd);

      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'session_reset', sessionId: 'sess-001' }),
      );
    });

    it('closes old audit writer and opens new one', async () => {
      sessionManager = createMockSessionManager(makeSession());
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('new_session');

      await handlers.new_session(cmd);

      expect(auditWriter.close).toHaveBeenCalled();
      expect(auditWriter.open).toHaveBeenCalled();
    });

    it('opens new audit writer with new session_started event', async () => {
      sessionManager = createMockSessionManager(makeSession());
      deps = { ...deps, sessionManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('new_session');

      await handlers.new_session(cmd);

      // session_reset for old, then session_started for new
      const writeCalls = (auditWriter.write as ReturnType<typeof vi.fn>).mock.calls;
      expect(writeCalls).toHaveLength(2);
      expect(writeCalls[0][0].event).toBe('session_reset');
      expect(writeCalls[1][0].event).toBe('session_started');
    });

    it('returns error when no session to reset', async () => {
      (sessionManager.resetSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('No active session to reset.'),
      );

      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('new_session');

      const result = await handlers.new_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.message).toContain('No active session');
      }
    });
  });

  describe('error handling', () => {
    it('maps TelecodeError codes correctly', async () => {
      (sessionManager.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        new TelecodeError('Not found', 'SESSION_NOT_FOUND'),
      );

      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      const result = await handlers.start_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('SESSION_NOT_FOUND');
      }
    });

    it('maps unknown TelecodeError codes to INTERNAL_ERROR', async () => {
      (sessionManager.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        new TelecodeError('Config bad', 'CONFIG_ERROR'),
      );

      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      const result = await handlers.start_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('INTERNAL_ERROR');
      }
    });

    it('wraps plain Error in INTERNAL_ERROR envelope', async () => {
      (sessionManager.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('something broke'),
      );

      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      const result = await handlers.start_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('INTERNAL_ERROR');
        expect(result!.message).toBe('something broke');
      }
    });

    it('handles non-Error throws', async () => {
      (sessionManager.startSession as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      const result = await handlers.start_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('INTERNAL_ERROR');
        expect(result!.message).toBe('An unexpected error occurred');
      }
    });
  });
});
