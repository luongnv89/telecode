import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCommandHandlers, type HandlerDeps } from '../../src/telegram/commands/handlers.js';
import { createLockManager, type LockManager } from '../../src/lock/manager.js';
import { createAuditWriter } from '../../src/audit/writer.js';
import type { ClaudeAdapter } from '../../src/claude/adapter.js';
import type { SessionManager } from '../../src/claude/session-manager.js';
import type { TelegramSender } from '../../src/telegram/sender.js';
import type { ValidatedCommand } from '../../src/types/commands.js';
import type { AuditEvent } from '../../src/types/audit.js';
import type { Session } from '../../src/types/session.js';
import type { SessionRegistry, RegistryEntry } from '../../src/session/registry.js';
import type { FocusManager } from '../../src/session/focus-manager.js';
import type { SessionPersistence } from '../../src/session/persistence.js';

// ---- Helpers ----

function makeCommand(
  type: string,
  overrides?: Partial<ValidatedCommand['context']> & { prompt?: string },
): ValidatedCommand {
  const base: ValidatedCommand['context'] = {
    userId: 100,
    chatId: 200,
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

  return { command: { type } as any, context: base };
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    sessionId: 'sess-001',
    claudeSessionId: 'claude-001',
    userId: 100,
    chatId: 200,
    state: 'active',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    workingDirectory: process.cwd(),
    ...overrides,
  };
}

function createMockAdapter(): ClaudeAdapter {
  return {
    startSession: vi.fn().mockResolvedValue({ claudeSessionId: 'claude-001' }),
    attachSession: vi.fn().mockResolvedValue({ claudeSessionId: 'claude-001' }),
    sendPrompt: vi.fn().mockResolvedValue({
      success: true,
      text: 'Claude says hello',
      durationMs: 100,
      totalCostUsd: 0.001,
      numTurns: 1,
    }),
    stopSession: vi.fn().mockResolvedValue(undefined),
    resetSession: vi.fn().mockResolvedValue({ claudeSessionId: 'claude-002' }),
    getStatus: vi.fn().mockReturnValue({ claudeSessionId: 'claude-001', state: 'active' }),
  };
}

function createMockSender(): TelegramSender {
  return { sendResponse: vi.fn().mockResolvedValue(undefined) };
}

function createMockSessionManager(session: Session | null = null): SessionManager {
  let currentSession = session;
  return {
    getSession: vi.fn(() => currentSession),
    isActive: vi.fn(() => currentSession !== null && currentSession.state !== 'stopped'),
    startSession: vi.fn(async (userId: number, chatId: number, workingDirectory?: string, name?: string) => {
      currentSession = makeSession({ userId, chatId, workingDirectory: workingDirectory ?? process.cwd(), name, sessionId: crypto.randomUUID() });
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
        sessionId: crypto.randomUUID(),
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
  return { manager, adapter, lock, workingDirectory: session?.workingDirectory ?? process.cwd(), name: session?.name };
}

function createMockRegistry(entries?: Map<string, RegistryEntry>): SessionRegistry {
  const entryMap = entries ?? new Map<string, RegistryEntry>();
  return {
    maxSessions: 5,
    get size() { return entryMap.size; },
    createSession: vi.fn(async (userId: number, chatId: number, workingDirectory: string, name?: string) => {
      const session = makeSession({ userId, chatId, workingDirectory, name, sessionId: crypto.randomUUID() });
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
    listSessions: vi.fn(() => {
      const items: any[] = [];
      for (const [id, entry] of entryMap) {
        const s = entry.manager.getSession();
        if (s) items.push({ sessionId: s.sessionId, name: entry.name, workingDirectory: entry.workingDirectory, state: s.state, startedAt: s.startedAt, isFocused: false });
      }
      return items;
    }),
    removeSession: vi.fn(async (sessionId: string) => {
      const entry = entryMap.get(sessionId);
      if (entry) {
        if (entry.manager.isActive()) await entry.manager.stopSession();
        entry.lock.forceRelease();
        entryMap.delete(sessionId);
      }
    }),
    removeAllSessions: vi.fn(),
    getAllEntries: vi.fn(() => entryMap),
  } as unknown as SessionRegistry;
}

function createMockFocusManager(registry: SessionRegistry): FocusManager {
  const focusMap = new Map<number, string>();
  return {
    setFocus: vi.fn((userId: number, sessionId: string) => {
      focusMap.set(userId, sessionId);
      return true;
    }),
    getFocusedSessionId: vi.fn((userId: number) => {
      const id = focusMap.get(userId);
      if (id && registry.getEntry(id)) return id;
      if (id) focusMap.delete(userId);
      return undefined;
    }),
    clearFocus: vi.fn((userId: number) => focusMap.delete(userId)),
    popFocus: vi.fn(() => undefined),
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

async function readAuditEvents(dir: string): Promise<AuditEvent[]> {
  const files = await readdir(dir);
  const jsonlFiles = files.filter((f) => f.endsWith('.jsonl')).sort();
  const events: AuditEvent[] = [];
  for (const file of jsonlFiles) {
    const content = await readFile(join(dir, file), 'utf-8');
    for (const line of content.split('\n').filter(Boolean)) {
      events.push(JSON.parse(line));
    }
  }
  return events;
}

// ---- Tests ----

describe('e2e: session lifecycle & lock behavior', () => {
  let tempDir: string;
  let sender: TelegramSender;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'telecode-e2e-lifecycle-'));
    sender = createMockSender();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function createDeps(): HandlerDeps {
    const auditWriter = createAuditWriter(tempDir);
    const sessionRegistry = createMockRegistry();
    const focusManager = createMockFocusManager(sessionRegistry);
    const persistence = createMockPersistence();
    return { sessionRegistry, focusManager, persistence, sender, auditWriter };
  }

  // ------------------------------------------------------------------
  // 1. Full lifecycle: start → send → status → stop
  // ------------------------------------------------------------------
  describe('full lifecycle flow', () => {
    it('start_session → send → status → stop completes successfully', async () => {
      const deps = createDeps();
      const handlers = createCommandHandlers(deps);
      const cmd = (type: string, extra?: any) => makeCommand(type, extra);

      // start
      const startRes = await handlers.start_session(cmd('start_session'));
      expect(startRes.type).toBe('result');

      // send
      const sendRes = await handlers.send(cmd('send', { prompt: 'write tests' }));
      expect(sendRes.type).toBe('result');
      if (sendRes.type === 'result') expect(sendRes.text).toBe('Claude says hello');

      // status
      const statusRes = await handlers.status(cmd('status'));
      expect(statusRes.type).toBe('status');
      if (statusRes.type === 'status') {
        expect(statusRes.sessionActive).toBe(true);
        expect(statusRes.locked).toBe(true);
      }

      // stop
      const stopRes = await handlers.stop(cmd('stop'));
      expect(stopRes.type).toBe('ack');
    });

    it('produces a complete audit trail in JSONL', async () => {
      const deps = createDeps();
      const handlers = createCommandHandlers(deps);
      const cmd = (type: string, extra?: any) => makeCommand(type, extra);

      await handlers.start_session(cmd('start_session'));
      await handlers.send(cmd('send', { prompt: 'hello' }));
      await handlers.stop(cmd('stop'));

      const events = await readAuditEvents(tempDir);
      const eventNames = events.map((e) => e.event);

      expect(eventNames).toEqual([
        'session_started',
        'lock_acquired',
        'command_received',
        'output_delivered',
        'session_stopped',
        'lock_released',
      ]);

      // Verify all events share the same sessionId
      const sessionIds = new Set(events.map((e) => e.sessionId));
      expect(sessionIds.size).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // 2. New-session flow: start → send → new_session → send → stop
  // ------------------------------------------------------------------
  describe('new session flow', () => {
    it('resets session while maintaining lock ownership', async () => {
      const deps = createDeps();
      const handlers = createCommandHandlers(deps);
      const cmd = (type: string, extra?: any) => makeCommand(type, extra);

      await handlers.start_session(cmd('start_session'));
      await handlers.send(cmd('send', { prompt: 'first prompt' }));

      const resetRes = await handlers.new_session(cmd('new_session'));
      expect(resetRes.type).toBe('ack');

      // Get the focused session entry to check lock
      const focusedId = deps.focusManager.getFocusedSessionId(100);
      expect(focusedId).toBeDefined();
      const entry = deps.sessionRegistry.getEntry(focusedId!);
      expect(entry).toBeDefined();
      expect(entry!.lock.isLocked()).toBe(true);
      expect(entry!.lock.getLockInfo()?.userId).toBe(100);

      // Send on new session should work
      const sendRes = await handlers.send(cmd('send', { prompt: 'second prompt' }));
      expect(sendRes.type).toBe('result');

      await handlers.stop(cmd('stop'));
    });

    it('creates separate audit log files for old and new sessions', async () => {
      const deps = createDeps();
      const handlers = createCommandHandlers(deps);
      const cmd = (type: string, extra?: any) => makeCommand(type, extra);

      await handlers.start_session(cmd('start_session'));
      await handlers.new_session(cmd('new_session'));
      await handlers.stop(cmd('stop'));

      const files = (await readdir(tempDir)).filter((f) => f.endsWith('.jsonl'));
      expect(files.length).toBe(2);

      // Read both files and identify them by content
      const allFileLogs: Array<{ events: any[] }> = [];
      for (const file of files) {
        const content = await readFile(join(tempDir, file), 'utf-8');
        const events = content.split('\n').filter(Boolean).map((l) => JSON.parse(l));
        allFileLogs.push({ events });
      }

      // One file should contain session_reset (the old session's log)
      const oldLog = allFileLogs.find((f) => f.events.some((e: any) => e.event === 'session_reset'));
      const newLog = allFileLogs.find((f) => f.events.some((e: any) => e.event === 'session_stopped'));

      expect(oldLog).toBeDefined();
      expect(newLog).toBeDefined();

      // Old log: session_started, lock_acquired, session_reset
      expect(oldLog!.events.map((e: any) => e.event)).toEqual([
        'session_started',
        'lock_acquired',
        'session_reset',
      ]);

      // New log: session_started, session_stopped, lock_released
      expect(newLog!.events.map((e: any) => e.event)).toEqual([
        'session_started',
        'session_stopped',
        'lock_released',
      ]);
    });
  });

  // ------------------------------------------------------------------
  // 3. Lock enforcement: User A holds lock, User B is rejected
  // ------------------------------------------------------------------
  describe('lock enforcement', () => {
    it('rejects User B send while User A holds the lock', async () => {
      const deps = createDeps();
      const handlers = createCommandHandlers(deps);

      // User A starts session
      const startA = await handlers.start_session(makeCommand('start_session'));
      expect(startA.type).toBe('result');

      // User B tries to send on User A's session — rejected (locked)
      // First set User B's focus to User A's session
      const sessionId = deps.focusManager.getFocusedSessionId(100);
      deps.focusManager.setFocus(300, sessionId!);

      const sendB = await handlers.send(
        makeCommand('send', { userId: 300, chatId: 400, prompt: 'hijack' }),
      );
      expect(sendB.type).toBe('error');
      if (sendB.type === 'error') expect(sendB.code).toBe('SESSION_LOCKED');
    });

    it('allows User B after User A releases the lock', async () => {
      const deps = createDeps();
      const handlers = createCommandHandlers(deps);

      // User A starts and stops
      await handlers.start_session(makeCommand('start_session'));
      await handlers.stop(makeCommand('stop'));

      // User B can now start
      const startB = await handlers.start_session(
        makeCommand('start_session', { userId: 300, chatId: 400 }),
      );
      expect(startB.type).toBe('result');

      // B's session should have the lock
      const focusedId = deps.focusManager.getFocusedSessionId(300);
      const entry = deps.sessionRegistry.getEntry(focusedId!);
      expect(entry!.lock.getLockInfo()?.userId).toBe(300);
    });
  });

  // ------------------------------------------------------------------
  // 4. Error recovery: Claude crashes during send
  // ------------------------------------------------------------------
  describe('error recovery', () => {
    it('recovers state to active after Claude adapter throws', async () => {
      const deps = createDeps();
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));

      // Get the entry and override its adapter's sendPrompt to fail once
      const focusedId = deps.focusManager.getFocusedSessionId(100)!;
      const entry = deps.sessionRegistry.getEntry(focusedId)!;
      let callCount = 0;
      (entry.adapter.sendPrompt as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Claude crashed');
        return { success: true, text: 'recovered', durationMs: 50, totalCostUsd: 0, numTurns: 1 };
      });

      // First send — Claude crashes
      const err = await handlers.send(makeCommand('send', { prompt: 'crash me' }));
      expect(err.type).toBe('error');

      // Session should still be active (recovered from busy → active)
      expect(entry.manager.isActive()).toBe(true);
      expect(entry.manager.getSession()?.state).toBe('active');

      // Second send — works normally
      const ok = await handlers.send(makeCommand('send', { prompt: 'try again' }));
      expect(ok.type).toBe('result');
      if (ok.type === 'result') expect(ok.text).toBe('recovered');
    });

    it('handles non-successful Claude result as CLAUDE_ERROR', async () => {
      const deps = createDeps();
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));

      // Override adapter to return failure
      const focusedId = deps.focusManager.getFocusedSessionId(100)!;
      const entry = deps.sessionRegistry.getEntry(focusedId)!;
      (entry.adapter.sendPrompt as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        text: 'Something went wrong',
        durationMs: 50,
        totalCostUsd: 0,
        numTurns: 0,
      });

      const res = await handlers.send(makeCommand('send', { prompt: 'fail' }));
      expect(res.type).toBe('error');
      if (res.type === 'error') {
        expect(res.code).toBe('CLAUDE_ERROR');
        expect(res.message).toBe('Something went wrong');
      }
    });
  });
});
