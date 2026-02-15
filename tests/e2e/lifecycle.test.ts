import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCommandHandlers, type HandlerDeps } from '../../src/telegram/commands/handlers.js';
import { createLockManager } from '../../src/lock/manager.js';
import { SessionManager } from '../../src/claude/session-manager.js';
import { createAuditWriter } from '../../src/audit/writer.js';
import type { ClaudeAdapter } from '../../src/claude/adapter.js';
import type { TelegramSender } from '../../src/telegram/sender.js';
import type { ValidatedCommand } from '../../src/types/commands.js';
import type { AuditEvent } from '../../src/types/audit.js';

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

function createMockAdapter(): ClaudeAdapter {
  return {
    startSession: vi.fn().mockResolvedValue({ claudeSessionId: 'claude-001' }),
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
  let adapter: ClaudeAdapter;
  let sender: TelegramSender;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'telecode-e2e-lifecycle-'));
    adapter = createMockAdapter();
    sender = createMockSender();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(tempDir, { recursive: true, force: true });
  });

  function createDeps(overrides?: Partial<HandlerDeps>): HandlerDeps {
    const sessionManager = new SessionManager(adapter);
    const lockManager = createLockManager();
    const auditWriter = createAuditWriter(tempDir);
    return {
      claudeAdapter: adapter,
      sessionManager,
      lockManager,
      sender,
      auditWriter,
      ...overrides,
    };
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
      expect(startRes.type).toBe('ack');

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

      // Lock should still be held by same user
      expect(deps.lockManager.isLocked()).toBe(true);
      expect(deps.lockManager.getLockInfo()?.userId).toBe(100);

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
    it('rejects User B while User A holds the lock', async () => {
      const deps = createDeps();
      const handlers = createCommandHandlers(deps);

      // User A starts session
      const startA = await handlers.start_session(makeCommand('start_session'));
      expect(startA.type).toBe('ack');

      // User B tries to start — rejected
      const startB = await handlers.start_session(
        makeCommand('start_session', { userId: 300, chatId: 400 }),
      );
      expect(startB.type).toBe('error');
      if (startB.type === 'error') expect(startB.code).toBe('SESSION_LOCKED');

      // User B tries to send — rejected
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
      expect(startB.type).toBe('ack');
      expect(deps.lockManager.getLockInfo()?.userId).toBe(300);
    });

    it('records lock_rejected audit event for denied connection', async () => {
      const deps = createDeps();
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));
      await handlers.start_session(
        makeCommand('start_session', { userId: 300, chatId: 400 }),
      );

      const events = await readAuditEvents(tempDir);
      const rejected = events.find((e) => e.event === 'lock_rejected');
      expect(rejected).toBeDefined();
      expect(rejected!.userId).toBe(300);
      if (rejected!.event === 'lock_rejected') {
        expect(rejected!.heldByUserId).toBe(100);
      }
    });
  });

  // ------------------------------------------------------------------
  // 4. Stale lock cleanup
  // ------------------------------------------------------------------
  describe('stale lock cleanup', () => {
    it('auto-releases stale lock on next start_session', async () => {
      vi.useFakeTimers();

      const deps = createDeps({ sessionTimeoutMs: 5000 });
      const handlers = createCommandHandlers(deps);

      // User A starts session
      await handlers.start_session(makeCommand('start_session'));
      expect(deps.lockManager.isLocked()).toBe(true);

      // Advance past timeout
      vi.advanceTimersByTime(6000);

      // User B starts session — stale lock auto-released
      const startB = await handlers.start_session(
        makeCommand('start_session', { userId: 300, chatId: 400 }),
      );
      expect(startB.type).toBe('ack');
      expect(deps.lockManager.getLockInfo()?.userId).toBe(300);
    });

    it('logs lock_stale_released audit event', async () => {
      vi.useFakeTimers();

      const deps = createDeps({ sessionTimeoutMs: 5000 });
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));
      vi.advanceTimersByTime(6000);

      await handlers.start_session(
        makeCommand('start_session', { userId: 300, chatId: 400 }),
      );

      // Read all audit logs across both sessions
      const events = await readAuditEvents(tempDir);
      const staleEvent = events.find((e) => e.event === 'lock_stale_released');
      expect(staleEvent).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // 5. Error recovery: Claude crashes during send
  // ------------------------------------------------------------------
  describe('error recovery', () => {
    it('recovers state to active after Claude adapter throws', async () => {
      const failAdapter = createMockAdapter();
      let callCount = 0;
      (failAdapter.sendPrompt as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Claude crashed');
        return { success: true, text: 'recovered', durationMs: 50, totalCostUsd: 0, numTurns: 1 };
      });

      const deps = createDeps({ claudeAdapter: failAdapter });
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));

      // First send — Claude crashes
      const err = await handlers.send(makeCommand('send', { prompt: 'crash me' }));
      expect(err.type).toBe('error');

      // Session should still be active (recovered from busy → active)
      expect(deps.sessionManager.isActive()).toBe(true);
      expect(deps.sessionManager.getSession()?.state).toBe('active');

      // Second send — works normally
      const ok = await handlers.send(makeCommand('send', { prompt: 'try again' }));
      expect(ok.type).toBe('result');
      if (ok.type === 'result') expect(ok.text).toBe('recovered');
    });

    it('handles non-successful Claude result as CLAUDE_ERROR', async () => {
      const failAdapter = createMockAdapter();
      (failAdapter.sendPrompt as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        text: 'Something went wrong',
        durationMs: 50,
        totalCostUsd: 0,
        numTurns: 0,
      });

      const deps = createDeps({ claudeAdapter: failAdapter });
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));

      const res = await handlers.send(makeCommand('send', { prompt: 'fail' }));
      expect(res.type).toBe('error');
      if (res.type === 'error') {
        expect(res.code).toBe('CLAUDE_ERROR');
        expect(res.message).toBe('Something went wrong');
      }
    });
  });
});
