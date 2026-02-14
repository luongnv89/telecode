import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCommandHandlers, type HandlerDeps } from '../../src/telegram/commands/handlers.js';
import type { TelegramSender } from '../../src/telegram/sender.js';
import type { AuditWriter } from '../../src/audit/writer.js';
import type { ValidatedCommand, ClaudeCodeCommand } from '../../src/types/commands.js';
import type { SessionRegistry, RegistryEntry } from '../../src/session/registry.js';
import type { FocusManager } from '../../src/session/focus-manager.js';
import type { SessionPersistence } from '../../src/session/persistence.js';
import type { Session } from '../../src/types/session.js';
import type { ClaudeAdapter } from '../../src/claude/adapter.js';
import type { LockManager } from '../../src/lock/manager.js';
import type { SessionManager } from '../../src/claude/session-manager.js';
import { TelecodeError } from '../../src/types/errors.js';
import { createLockManager } from '../../src/lock/manager.js';

// ---- Helpers ----

function makeCommand(
  type: string,
  overrides?: Partial<ValidatedCommand['context']> & {
    prompt?: string;
    ccCommand?: ClaudeCodeCommand;
    workingDir?: string;
    name?: string;
    target?: string;
    path?: string;
  },
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

  if (type === 'claude_command') {
    return {
      command: { type: 'claude_command', ccCommand: overrides?.ccCommand ?? 'compact' },
      context: base,
    };
  }

  if (type === 'start_session') {
    return {
      command: {
        type: 'start_session',
        workingDir: overrides?.workingDir,
        name: overrides?.name,
      },
      context: base,
    };
  }

  if (type === 'switch_session') {
    return {
      command: { type: 'switch_session', target: overrides?.target ?? 'my-project' },
      context: base,
    };
  }

  if (type === 'remove_session') {
    return {
      command: { type: 'remove_session', target: overrides?.target ?? 'my-project' },
      context: base,
    };
  }

  if (type === 'attach') {
    return {
      command: { type: 'attach', target: overrides?.target ?? '1' },
      context: base,
    };
  }

  if (type === 'cd') {
    return {
      command: { type: 'cd', path: overrides?.path ?? process.cwd() },
      context: base,
    };
  }

  if (type === 'goto') {
    return {
      command: { type: 'goto', target: overrides?.target ?? '1' },
      context: base,
    };
  }

  if (type === 'resume') {
    return {
      command: { type: 'resume', target: overrides?.target },
      context: base,
    };
  }

  if (type === 'bookmark') {
    return {
      command: { type: 'bookmark', name: overrides?.name ?? 'test', path: overrides?.path ?? '/tmp' },
      context: base,
    };
  }

  if (type === 'open_bookmark') {
    return {
      command: { type: 'open_bookmark', name: overrides?.name ?? 'test' },
      context: base,
    };
  }

  if (type === 'unbookmark') {
    return {
      command: { type: 'unbookmark', name: overrides?.name ?? 'test' },
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
    workingDirectory: process.cwd(),
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
    startSession: vi.fn(async (userId: number, chatId: number, workingDirectory?: string, name?: string) => {
      currentSession = makeSession({ userId, chatId, workingDirectory: workingDirectory ?? process.cwd(), name });
      return currentSession;
    }),
    stopSession: vi.fn(async () => {
      if (currentSession) currentSession.state = 'stopped';
      currentSession = null;
    }),
    resetSession: vi.fn(async () => {
      const wd = currentSession?.workingDirectory ?? process.cwd();
      const name = currentSession?.name;
      currentSession = makeSession({
        sessionId: 'sess-002',
        claudeSessionId: 'claude-002',
        workingDirectory: wd,
        name,
      });
      return currentSession;
    }),
    updateState: vi.fn((state) => {
      if (currentSession) currentSession.state = state;
    }),
    getTransitions: vi.fn(() => []),
    getTransitionsForSession: vi.fn(() => []),
  } as unknown as SessionManager;
}

function createMockEntry(session: Session | null = null): RegistryEntry {
  const adapter = createMockAdapter();
  const manager = createMockSessionManager(session);
  const lock = createLockManager();
  if (session) {
    lock.acquire(session.userId, session.chatId, session.sessionId);
  }
  return {
    manager,
    adapter,
    lock,
    workingDirectory: session?.workingDirectory ?? process.cwd(),
    name: session?.name,
  };
}

function createMockRegistry(entries?: Map<string, RegistryEntry>): SessionRegistry {
  const entryMap = entries ?? new Map<string, RegistryEntry>();
  return {
    maxSessions: 5,
    size: entryMap.size,
    createSession: vi.fn(async (userId: number, chatId: number, workingDirectory: string, name?: string) => {
      const session = makeSession({ userId, chatId, workingDirectory, name });
      const entry = createMockEntry(session);
      entryMap.set(session.sessionId, entry);
      return session;
    }),
    getEntry: vi.fn((sessionId: string) => entryMap.get(sessionId)),
    getSession: vi.fn((sessionId: string) => {
      const entry = entryMap.get(sessionId);
      return entry?.manager.getSession() ?? null;
    }),
    findSession: vi.fn(),
    findSessionId: vi.fn((target: string) => {
      if (entryMap.has(target)) return target;
      for (const [id, entry] of entryMap) {
        if (entry.name === target) return id;
      }
      return undefined;
    }),
    listSessions: vi.fn(() => []),
    removeSession: vi.fn(async (sessionId: string) => {
      entryMap.delete(sessionId);
    }),
    removeAllSessions: vi.fn(),
    getAllEntries: vi.fn(() => entryMap),
  } as unknown as SessionRegistry;
}

function createMockFocusManager(): FocusManager {
  const focusMap = new Map<number, string>();
  return {
    setFocus: vi.fn((userId: number, sessionId: string) => {
      focusMap.set(userId, sessionId);
      return true;
    }),
    getFocusedSessionId: vi.fn((userId: number) => focusMap.get(userId)),
    clearFocus: vi.fn((userId: number) => focusMap.delete(userId)),
    isFocusedBy: vi.fn(),
    clearFocusForSession: vi.fn((sessionId: string) => {
      for (const [userId, id] of focusMap) {
        if (id === sessionId) focusMap.delete(userId);
      }
    }),
    getFocusMap: vi.fn(() => Object.fromEntries(focusMap)),
    restoreFocusMap: vi.fn(),
  } as unknown as FocusManager;
}

function createMockPersistence(): SessionPersistence {
  return {
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    scheduleSave: vi.fn(),
    cancelPendingSave: vi.fn(),
  } as unknown as SessionPersistence;
}

// ---- Tests ----

describe('command handlers', () => {
  let sender: TelegramSender;
  let auditWriter: AuditWriter;
  let sessionRegistry: SessionRegistry;
  let focusManager: FocusManager;
  let persistence: SessionPersistence;
  let deps: HandlerDeps;

  beforeEach(() => {
    sender = createMockSender();
    auditWriter = createMockAuditWriter();
    sessionRegistry = createMockRegistry();
    focusManager = createMockFocusManager();
    persistence = createMockPersistence();
    deps = { sessionRegistry, focusManager, persistence, sender, auditWriter };
  });

  describe('/start_session', () => {
    it('creates a session and returns result with session info', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      const result = await handlers.start_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('result');
      expect(sessionRegistry.createSession).toHaveBeenCalled();
    });

    it('auto-focuses the new session', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      await handlers.start_session(cmd);

      expect(focusManager.setFocus).toHaveBeenCalledWith(123, 'sess-001');
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

    it('writes lock_acquired audit event', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      await handlers.start_session(cmd);

      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'lock_acquired' }),
      );
    });

    it('schedules persistence save', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      await handlers.start_session(cmd);

      expect(persistence.scheduleSave).toHaveBeenCalled();
    });

    it('returns error when max sessions reached', async () => {
      (sessionRegistry.createSession as any).mockRejectedValue(
        new Error('Maximum 5 concurrent sessions reached.'),
      );
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session');

      const result = await handlers.start_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.message).toContain('Maximum 5');
      }
    });

    it('returns error for invalid working directory', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('start_session', { workingDir: '/nonexistent/path/12345' });

      const result = await handlers.start_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('INVALID_WORKING_DIR');
      }
    });
  });

  describe('/send', () => {
    it('sends to focused session and returns result', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('send', { prompt: 'write a test' });

      const result = await handlers.send(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toBe('Claude says hello');
      }
      expect(entry.adapter.sendPrompt).toHaveBeenCalledWith('sess-001', 'write a test');
    });

    it('returns NO_FOCUSED_SESSION when no session is focused', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('send', { prompt: 'hello' });

      const result = await handlers.send(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('NO_FOCUSED_SESSION');
      }
    });

    it('returns SESSION_LOCKED when different user tries to send', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      // User 999 has focus on this session but doesn't own the lock
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('send', { prompt: 'hello', userId: 999, chatId: 888 });

      const result = await handlers.send(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('SESSION_LOCKED');
      }
    });

    it('returns error for wrong command type', async () => {
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');
      deps = { ...deps, focusManager };
      const handlers = createCommandHandlers(deps);
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
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('send', { prompt: 'hello' });

      await handlers.send(cmd);

      expect(entry.manager.updateState).toHaveBeenCalledWith('busy');
      expect(entry.manager.updateState).toHaveBeenCalledWith('active');
    });

    it('writes audit events for command and output', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
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

    it('returns CLAUDE_ERROR when adapter result is not successful', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      (entry.adapter.sendPrompt as any).mockResolvedValue({
        success: false,
        text: 'Something went wrong',
        durationMs: 50,
        totalCostUsd: 0,
        numTurns: 0,
        errors: ['Something went wrong'],
      });
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
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
  });

  describe('/status', () => {
    it('returns status with active session info', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('status');

      const result = await handlers.status(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('status');
      if (result!.type === 'status') {
        expect(result!.sessionActive).toBe(true);
        expect(result!.sessionId).toBe('sess-001');
        expect(result!.state).toBe('active');
        expect(result!.locked).toBe(true);
        expect(result!.lockOwnerUserId).toBe(123);
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
        expect(result!.locked).toBe(false);
      }
    });
  });

  describe('/stop', () => {
    it('stops the focused session, releases lock, and closes audit writer', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('stop');

      const result = await handlers.stop(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('ack');
      if (result!.type === 'ack') {
        expect(result!.commandType).toBe('stop');
      }
      expect(sessionRegistry.removeSession).toHaveBeenCalledWith('sess-001');
      expect(auditWriter.close).toHaveBeenCalled();
    });

    it('writes session_stopped and lock_released audit events', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('stop');

      await handlers.stop(cmd);

      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'session_stopped', sessionId: 'sess-001' }),
      );
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'lock_released', sessionId: 'sess-001' }),
      );
    });

    it('rejects stop from different user', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('stop', { userId: 999, chatId: 888 });

      const result = await handlers.stop(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('SESSION_LOCKED');
      }
    });

    it('returns NO_FOCUSED_SESSION when no session is focused', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('stop');

      const result = await handlers.stop(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('NO_FOCUSED_SESSION');
      }
    });
  });

  describe('/new_session', () => {
    it('resets focused session and returns ack', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('new_session');

      const result = await handlers.new_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('ack');
      if (result!.type === 'ack') {
        expect(result!.commandType).toBe('new_session');
      }
      expect(entry.manager.resetSession).toHaveBeenCalled();
    });

    it('returns NO_FOCUSED_SESSION when no session is focused', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('new_session');

      const result = await handlers.new_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('NO_FOCUSED_SESSION');
      }
    });

    it('rejects reset from different user', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('new_session', { userId: 999, chatId: 888 });

      const result = await handlers.new_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('SESSION_LOCKED');
      }
    });

    it('writes session_reset audit event and opens new audit file', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('new_session');

      await handlers.new_session(cmd);

      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'session_reset', sessionId: 'sess-001' }),
      );
      expect(auditWriter.close).toHaveBeenCalled();
      expect(auditWriter.open).toHaveBeenCalled();
    });
  });

  describe('/sessions (list_sessions)', () => {
    it('returns empty message when no sessions exist', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('list_sessions');

      const result = await handlers.list_sessions(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('No active sessions');
      }
    });

    it('returns session list with focused indicator', async () => {
      (sessionRegistry.listSessions as any).mockReturnValue([
        {
          sessionId: 'sess-001',
          name: 'api',
          workingDirectory: '/projects/api',
          state: 'active',
          startedAt: new Date(),
          isFocused: true,
        },
        {
          sessionId: 'sess-002',
          name: 'web',
          workingDirectory: '/projects/web',
          state: 'active',
          startedAt: new Date(),
          isFocused: false,
        },
      ]);
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('list_sessions');

      const result = await handlers.list_sessions(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('Sessions (2/5)');
        expect(result!.text).toContain('(api)');
        expect(result!.text).toContain('(web)');
        expect(result!.text).toContain('> 1.'); // focused indicator
      }
    });
  });

  describe('/switch', () => {
    it('switches focus to target session', async () => {
      (sessionRegistry.findSessionId as any).mockReturnValue('sess-002');
      const entry2 = createMockEntry(makeSession({ sessionId: 'sess-002' }));
      (sessionRegistry.getEntry as any).mockReturnValue(entry2);

      deps = { ...deps, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('switch_session', { target: 'web' });

      const result = await handlers.switch_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('result');
      expect(focusManager.setFocus).toHaveBeenCalledWith(123, 'sess-002');
    });

    it('returns error for non-existent session', async () => {
      (sessionRegistry.findSessionId as any).mockReturnValue(undefined);

      deps = { ...deps, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('switch_session', { target: 'nonexistent' });

      const result = await handlers.switch_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('SESSION_NOT_FOUND');
      }
    });
  });

  describe('/remove', () => {
    it('removes session and clears focus', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      (sessionRegistry.findSessionId as any).mockReturnValue('sess-001');
      (sessionRegistry.getEntry as any).mockReturnValue(entry);

      deps = { ...deps, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('remove_session', { target: 'my-project' });

      const result = await handlers.remove_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('result');
      expect(sessionRegistry.removeSession).toHaveBeenCalledWith('sess-001');
      expect(focusManager.clearFocusForSession).toHaveBeenCalledWith('sess-001');
    });

    it('returns error for non-existent session', async () => {
      (sessionRegistry.findSessionId as any).mockReturnValue(undefined);

      deps = { ...deps, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('remove_session', { target: 'nonexistent' });

      const result = await handlers.remove_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('SESSION_NOT_FOUND');
      }
    });

    it('rejects removal by non-owner', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      (sessionRegistry.findSessionId as any).mockReturnValue('sess-001');
      (sessionRegistry.getEntry as any).mockReturnValue(entry);

      deps = { ...deps, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('remove_session', { target: 'my-project', userId: 999, chatId: 888 });

      const result = await handlers.remove_session(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('SESSION_LOCKED');
      }
    });
  });

  describe('/cc_* (claude_command)', () => {
    it('sends Claude Code command as prompt and returns result', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('claude_command', { ccCommand: 'compact' });

      const result = await handlers.claude_command(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toBe('Claude says hello');
      }
      expect(entry.adapter.sendPrompt).toHaveBeenCalledWith('sess-001', '/compact');
    });

    it('returns NO_FOCUSED_SESSION when no session is focused', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('claude_command', { ccCommand: 'compact' });

      const result = await handlers.claude_command(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('NO_FOCUSED_SESSION');
      }
    });

    it('writes audit events with cc_ prefixed commandType', async () => {
      const session = makeSession();
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      focusManager = createMockFocusManager();
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');

      deps = { ...deps, sessionRegistry, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('claude_command', { ccCommand: 'compact' });

      await handlers.claude_command(cmd);

      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'command_received', commandType: 'cc_compact' }),
      );
    });
  });

  describe('error handling', () => {
    it('maps TelecodeError codes correctly', async () => {
      (sessionRegistry.createSession as any).mockRejectedValue(
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

    it('wraps plain Error in INTERNAL_ERROR envelope', async () => {
      (sessionRegistry.createSession as any).mockRejectedValue(
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
      (sessionRegistry.createSession as any).mockRejectedValue('string error');

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

  describe('/discover', () => {
    it('returns error when discovery is not configured', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('discover');

      const result = await handlers.discover(cmd);

      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('DISCOVERY_ERROR');
      }
    });

    it('returns empty message when no sessions discovered', async () => {
      const mockDiscovery = { scan: vi.fn().mockResolvedValue([]) };
      deps = { ...deps, sessionDiscovery: mockDiscovery };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('discover');

      const result = await handlers.discover(cmd);

      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('No running Claude Code sessions');
      }
    });

    it('lists discovered sessions', async () => {
      const mockDiscovery = {
        scan: vi.fn().mockResolvedValue([
          {
            claudeSessionId: '12345678-1234-1234-1234-123456789abc',
            projectPath: '/Users/test/project',
            lastModified: new Date(),
            fileName: '12345678-1234-1234-1234-123456789abc.jsonl',
          },
        ]),
      };
      deps = { ...deps, sessionDiscovery: mockDiscovery };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('discover');

      const result = await handlers.discover(cmd);

      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('Discovered 1 session');
        expect(result!.text).toContain('/Users/test/project');
        expect(result!.text).toContain('/attach');
      }
    });
  });

  describe('/attach', () => {
    it('returns error when discovery is not configured', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('attach', { target: '1' });

      const result = await handlers.attach(cmd);

      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('DISCOVERY_ERROR');
      }
    });

    it('returns error when no sessions are discoverable', async () => {
      const mockDiscovery = { scan: vi.fn().mockResolvedValue([]) };
      deps = { ...deps, sessionDiscovery: mockDiscovery };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('attach', { target: '1' });

      const result = await handlers.attach(cmd);

      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('ATTACH_FAILED');
      }
    });

    it('attaches to session by index', async () => {
      const discovered = [{
        claudeSessionId: '12345678-1234-1234-1234-123456789abc',
        projectPath: '/Users/test/project',
        lastModified: new Date(),
        fileName: '12345678-1234-1234-1234-123456789abc.jsonl',
      }];
      const mockDiscovery = { scan: vi.fn().mockResolvedValue(discovered) };
      (sessionRegistry as any).attachSession = vi.fn().mockResolvedValue(makeSession());
      deps = { ...deps, sessionDiscovery: mockDiscovery };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('attach', { target: '1' });

      const result = await handlers.attach(cmd);

      expect(result!.type).toBe('result');
      expect((sessionRegistry as any).attachSession).toHaveBeenCalledWith(
        123, 456, '12345678-1234-1234-1234-123456789abc', '/Users/test/project',
      );
    });
  });

  describe('/cd', () => {
    it('returns error for non-existent directory', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('cd', { path: '/nonexistent/path/12345' });

      const result = await handlers.cd(cmd);

      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('INVALID_WORKING_DIR');
      }
    });

    it('switches to existing session if one exists for the directory', async () => {
      const session = makeSession({ workingDirectory: process.cwd() });
      const entry = createMockEntry(session);
      const entryMap = new Map([['sess-001', entry]]);
      sessionRegistry = createMockRegistry(entryMap);
      deps = { ...deps, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('cd', { path: process.cwd() });

      const result = await handlers.cd(cmd);

      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('Switched to existing session');
      }
    });

    it('creates new session if no existing session for directory', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('cd', { path: process.cwd() });

      const result = await handlers.cd(cmd);

      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('Created session');
      }
      expect(sessionRegistry.createSession).toHaveBeenCalled();
    });
  });

  describe('/goto', () => {
    it('switches focus by name', async () => {
      (sessionRegistry.findSessionId as any).mockReturnValue('sess-002');
      const entry2 = createMockEntry(makeSession({ sessionId: 'sess-002' }));
      (sessionRegistry.getEntry as any).mockReturnValue(entry2);

      deps = { ...deps, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('goto', { target: 'web' });

      const result = await handlers.goto(cmd);

      expect(result!.type).toBe('result');
      expect(focusManager.setFocus).toHaveBeenCalledWith(123, 'sess-002');
    });

    it('switches focus by 1-based index', async () => {
      (sessionRegistry.findSessionId as any).mockReturnValue(undefined);
      (sessionRegistry.listSessions as any).mockReturnValue([
        { sessionId: 'sess-001', name: 'api', workingDirectory: '/api', state: 'active', startedAt: new Date(), isFocused: false },
        { sessionId: 'sess-002', name: 'web', workingDirectory: '/web', state: 'active', startedAt: new Date(), isFocused: false },
      ]);

      deps = { ...deps, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('goto', { target: '2' });

      const result = await handlers.goto(cmd);

      expect(result!.type).toBe('result');
      expect(focusManager.setFocus).toHaveBeenCalledWith(123, 'sess-002');
    });

    it('returns error for non-existent target', async () => {
      (sessionRegistry.findSessionId as any).mockReturnValue(undefined);
      (sessionRegistry.listSessions as any).mockReturnValue([]);

      deps = { ...deps, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('goto', { target: 'nonexistent' });

      const result = await handlers.goto(cmd);

      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('SESSION_NOT_FOUND');
      }
    });
  });

  describe('/back', () => {
    it('returns error when no history exists', async () => {
      (focusManager as any).popFocus = vi.fn().mockReturnValue(undefined);
      deps = { ...deps, focusManager };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('back');

      const result = await handlers.back(cmd);

      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('SESSION_NOT_FOUND');
        expect(result!.message).toContain('No previous session');
      }
    });

    it('returns to previous session when history exists', async () => {
      const entry = createMockEntry(makeSession({ sessionId: 'sess-001' }));
      (focusManager as any).popFocus = vi.fn().mockReturnValue('sess-001');
      (sessionRegistry.getEntry as any).mockReturnValue(entry);
      deps = { ...deps, focusManager, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('back');

      const result = await handlers.back(cmd);

      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('Returned to session');
      }
    });
  });

  describe('/resume', () => {
    it('resumes specific session by name', async () => {
      (sessionRegistry.findSessionId as any).mockReturnValue('sess-001');
      const entry = createMockEntry(makeSession({ sessionId: 'sess-001' }));
      (sessionRegistry.getEntry as any).mockReturnValue(entry);
      deps = { ...deps, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('resume', { target: 'api' });

      const result = await handlers.resume(cmd);

      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('Resumed session');
      }
      expect(focusManager.setFocus).toHaveBeenCalledWith(123, 'sess-001');
    });

    it('reports already active when focused session exists', async () => {
      (focusManager.getFocusedSessionId as any).mockReturnValue('sess-001');
      const entry = createMockEntry(makeSession({ sessionId: 'sess-001' }));
      (sessionRegistry.getEntry as any).mockReturnValue(entry);
      deps = { ...deps, focusManager, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('resume');

      const result = await handlers.resume(cmd);

      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('already active');
      }
    });

    it('returns error when no sessions available', async () => {
      (sessionRegistry.listSessions as any).mockReturnValue([]);
      deps = { ...deps, sessionRegistry };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('resume');

      const result = await handlers.resume(cmd);

      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('SESSION_NOT_FOUND');
      }
    });
  });

  describe('/bookmark', () => {
    it('returns error when bookmark store not configured', async () => {
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('bookmark', { name: 'api', path: process.cwd() });

      const result = await handlers.bookmark(cmd);

      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('INTERNAL_ERROR');
      }
    });

    it('saves bookmark for valid directory', async () => {
      const mockBookmarkStore = {
        add: vi.fn(),
        remove: vi.fn(),
        get: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(undefined),
      };
      deps = { ...deps, bookmarkStore: mockBookmarkStore };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('bookmark', { name: 'api', path: process.cwd() });

      const result = await handlers.bookmark(cmd);

      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('Bookmark "api" saved');
      }
      expect(mockBookmarkStore.add).toHaveBeenCalled();
      expect(mockBookmarkStore.save).toHaveBeenCalled();
    });

    it('returns error for non-existent directory', async () => {
      const mockBookmarkStore = {
        add: vi.fn(),
        remove: vi.fn(),
        get: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(undefined),
      };
      deps = { ...deps, bookmarkStore: mockBookmarkStore };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('bookmark', { name: 'api', path: '/nonexistent/path/12345' });

      const result = await handlers.bookmark(cmd);

      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('INVALID_WORKING_DIR');
      }
    });
  });

  describe('/bookmarks', () => {
    it('returns empty message when no bookmarks', async () => {
      const mockBookmarkStore = {
        add: vi.fn(),
        remove: vi.fn(),
        get: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(undefined),
      };
      deps = { ...deps, bookmarkStore: mockBookmarkStore };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('list_bookmarks');

      const result = await handlers.list_bookmarks(cmd);

      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('No bookmarks saved');
      }
    });

    it('lists bookmarks', async () => {
      const mockBookmarkStore = {
        add: vi.fn(),
        remove: vi.fn(),
        get: vi.fn(),
        list: vi.fn().mockReturnValue([
          { name: 'api', path: '/projects/api', createdAt: '2025-01-01' },
          { name: 'web', path: '/projects/web', createdAt: '2025-01-01' },
        ]),
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(undefined),
      };
      deps = { ...deps, bookmarkStore: mockBookmarkStore };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('list_bookmarks');

      const result = await handlers.list_bookmarks(cmd);

      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('Bookmarks (2)');
        expect(result!.text).toContain('api');
        expect(result!.text).toContain('web');
      }
    });
  });

  describe('/open', () => {
    it('returns error when bookmark not found', async () => {
      const mockBookmarkStore = {
        add: vi.fn(),
        remove: vi.fn(),
        get: vi.fn().mockReturnValue(undefined),
        list: vi.fn().mockReturnValue([]),
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(undefined),
      };
      deps = { ...deps, bookmarkStore: mockBookmarkStore };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('open_bookmark', { name: 'nonexistent' });

      const result = await handlers.open_bookmark(cmd);

      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('BOOKMARK_NOT_FOUND');
      }
    });

    it('creates session from bookmark', async () => {
      const mockBookmarkStore = {
        add: vi.fn(),
        remove: vi.fn(),
        get: vi.fn().mockReturnValue({ name: 'api', path: process.cwd(), createdAt: '2025-01-01' }),
        list: vi.fn().mockReturnValue([]),
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(undefined),
      };
      deps = { ...deps, bookmarkStore: mockBookmarkStore };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('open_bookmark', { name: 'api' });

      const result = await handlers.open_bookmark(cmd);

      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('Session "api" started');
      }
      expect(sessionRegistry.createSession).toHaveBeenCalled();
    });
  });

  describe('/unbookmark', () => {
    it('removes existing bookmark', async () => {
      const mockBookmarkStore = {
        add: vi.fn(),
        remove: vi.fn().mockReturnValue(true),
        get: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(undefined),
      };
      deps = { ...deps, bookmarkStore: mockBookmarkStore };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('unbookmark', { name: 'api' });

      const result = await handlers.unbookmark(cmd);

      expect(result!.type).toBe('result');
      if (result!.type === 'result') {
        expect(result!.text).toContain('Bookmark "api" removed');
      }
    });

    it('returns error when bookmark not found', async () => {
      const mockBookmarkStore = {
        add: vi.fn(),
        remove: vi.fn().mockReturnValue(false),
        get: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(undefined),
      };
      deps = { ...deps, bookmarkStore: mockBookmarkStore };
      const handlers = createCommandHandlers(deps);
      const cmd = makeCommand('unbookmark', { name: 'nonexistent' });

      const result = await handlers.unbookmark(cmd);

      expect(result!.type).toBe('error');
      if (result!.type === 'error') {
        expect(result!.code).toBe('BOOKMARK_NOT_FOUND');
      }
    });
  });
});
