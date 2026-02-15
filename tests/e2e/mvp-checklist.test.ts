import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCommandHandlers, type HandlerDeps } from '../../src/telegram/commands/handlers.js';
import { createLockManager } from '../../src/lock/manager.js';
import { createAuditWriter } from '../../src/audit/writer.js';
import { createSafeSender } from '../../src/sanitize/outbound.js';
import { createDefaultPipeline } from '../../src/sanitize/pipeline.js';
import { createRegexMasker } from '../../src/sanitize/regex-masking.js';
import type { ClaudeAdapter } from '../../src/claude/adapter.js';
import type { SessionManager } from '../../src/claude/session-manager.js';
import type { TelegramSender } from '../../src/telegram/sender.js';
import type { ValidatedCommand } from '../../src/types/commands.js';
import type { AuditEvent } from '../../src/types/audit.js';
import type { ResponseEnvelope } from '../../src/types/envelope.js';
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

// Comprehensive secret corpus covering all regex rules
const FULL_SECRET_CORPUS: Array<{ name: string; input: string; mustNotContain: string }> = [
  { name: 'OpenAI project key', input: 'sk-proj-abc123def456ghi789jkl012mno', mustNotContain: 'sk-proj-abc123' },
  { name: 'OpenAI API key', input: 'sk-abcdefghijklmnopqrstuvwxyz', mustNotContain: 'sk-abcdefgh' },
  { name: 'AWS access key', input: 'AKIAIOSFODNN7EXAMPLE', mustNotContain: 'AKIAIOSFODNN7EXAMPLE' },
  { name: 'Generic key token', input: 'key-abcdefghijklmnopqrstuvwxyz', mustNotContain: 'key-abcdefgh' },
  { name: 'Bearer token', input: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', mustNotContain: 'eyJhbGciOiJIUzI1NiI' },
  { name: 'PostgreSQL conn', input: 'postgres://admin:pass@db.host:5432/mydb', mustNotContain: 'postgres://admin' },
  { name: 'MongoDB conn', input: 'mongodb://user:pass@host:27017/db', mustNotContain: 'mongodb://user' },
  { name: 'Redis conn', input: 'redis://default:pwd@host:6379', mustNotContain: 'redis://default' },
  { name: 'MySQL conn', input: 'mysql://root:pass@host/db', mustNotContain: 'mysql://root' },
  { name: 'PEM private key', input: '-----BEGIN RSA PRIVATE KEY-----\nMIIEpA\n-----END RSA PRIVATE KEY-----', mustNotContain: 'BEGIN RSA PRIVATE KEY' },
  { name: 'Env variable leak', input: 'export SECRET_KEY=supersecretvalue', mustNotContain: 'supersecretvalue' },
  { name: 'Password assignment', input: 'password=hunter2secret', mustNotContain: 'hunter2secret' },
  { name: 'Passwd assignment', input: 'passwd:mysecretpassword', mustNotContain: 'mysecretpassword' },
  { name: 'Secret assignment', input: 'secret=my-ultra-secret', mustNotContain: 'my-ultra-secret' },
  { name: 'Token assignment', input: 'token=abcdefghijklmnopqrstuvwxyz12', mustNotContain: 'abcdefghijklmnopqrstuvwxyz12' },
  { name: 'Sensitive .ssh path', input: '/Users/john/.ssh/id_rsa', mustNotContain: '.ssh/id_rsa' },
  { name: 'Sensitive .aws path', input: '/Users/john/.aws/credentials', mustNotContain: '.aws/credentials' },
];

// ---- Tests ----

describe('e2e: MVP checklist validation (PRD 8.1)', () => {
  let tempDir: string;
  let sender: TelegramSender;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'telecode-e2e-mvp-'));
    sender = createMockSender();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function createFullDeps(): HandlerDeps {
    const auditWriter = createAuditWriter(tempDir);
    const sessionRegistry = createMockRegistry();
    const focusManager = createMockFocusManager(sessionRegistry);
    const persistence = createMockPersistence();
    return { sessionRegistry, focusManager, persistence, sender, auditWriter };
  }

  // ------------------------------------------------------------------
  // MVP Scope: All 4 Telegram commands + plain text messaging
  // ------------------------------------------------------------------
  describe('Telegram commands: /start_session, /status, /stop, /new_session + plain text', () => {
    it('/start_session returns result envelope', async () => {
      const deps = createFullDeps();
      const handlers = createCommandHandlers(deps);

      const res = await handlers.start_session(makeCommand('start_session'));
      expect(res.type).toBe('result');
    });

    it('plain text message returns result envelope', async () => {
      const deps = createFullDeps();
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));
      const res = await handlers.send(makeCommand('send', { prompt: 'test' }));
      expect(res.type).toBe('result');
      if (res.type === 'result') expect(res.text).toBe('Claude says hello');
    });

    it('/status returns status envelope', async () => {
      const deps = createFullDeps();
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));
      const res = await handlers.status(makeCommand('status'));
      expect(res.type).toBe('status');
      if (res.type === 'status') {
        expect(res.sessionActive).toBe(true);
        expect(res.locked).toBe(true);
      }
    });

    it('/stop returns ack envelope', async () => {
      const deps = createFullDeps();
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));
      const res = await handlers.stop(makeCommand('stop'));
      expect(res.type).toBe('ack');
      if (res.type === 'ack') expect(res.commandType).toBe('stop');
    });

    it('/new_session returns ack envelope', async () => {
      const deps = createFullDeps();
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));
      const res = await handlers.new_session(makeCommand('new_session'));
      expect(res.type).toBe('ack');
      if (res.type === 'ack') expect(res.commandType).toBe('new_session');
    });
  });

  // ------------------------------------------------------------------
  // MVP Scope: Single concurrent connection lock
  // ------------------------------------------------------------------
  describe('single concurrent connection lock', () => {
    it('lock holder info is accurately reported', async () => {
      const deps = createFullDeps();
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));

      const focusedId = deps.focusManager.getFocusedSessionId(100);
      const entry = deps.sessionRegistry.getEntry(focusedId!);
      expect(entry!.lock.isLocked()).toBe(true);
      const lockInfo = entry!.lock.getLockInfo();
      expect(lockInfo?.userId).toBe(100);
      expect(lockInfo?.chatId).toBe(200);
    });
  });

  // ------------------------------------------------------------------
  // MVP Scope: Transport-layer sanitization + deterministic masking
  // ------------------------------------------------------------------
  describe('transport-layer sanitization + deterministic masking', () => {
    it('no unmasked secret leak for complete test corpus', () => {
      const pipeline = createDefaultPipeline();
      const regexMasker = createRegexMasker();

      for (const { name, input, mustNotContain } of FULL_SECRET_CORPUS) {
        // Stage 1: pipeline
        const pResult = pipeline.sanitize(input);
        // Stage 2: regex masking
        const mResult = regexMasker(pResult.text);

        expect(
          mResult.text,
          `Secret leaked through sanitization: "${name}" — output contains "${mustNotContain}"`,
        ).not.toContain(mustNotContain);
      }
    });

    it('masking is deterministic across multiple runs', () => {
      const pipeline = createDefaultPipeline();
      const regexMasker = createRegexMasker();

      for (const { input } of FULL_SECRET_CORPUS) {
        const run1 = regexMasker(pipeline.sanitize(input).text);
        const run2 = regexMasker(pipeline.sanitize(input).text);
        expect(run1.text).toBe(run2.text);
      }
    });
  });

  // ------------------------------------------------------------------
  // MVP Scope: Per-session local audit logs
  // ------------------------------------------------------------------
  describe('per-session local audit logs', () => {
    it('creates audit log file with correct naming pattern', async () => {
      const deps = createFullDeps();
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));
      await handlers.stop(makeCommand('stop'));

      const files = (await readdir(tempDir)).filter((f) => f.endsWith('.jsonl'));
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^session-\d{8}-\d{6}-[a-f0-9]{8}\.jsonl$/);
    });

    it('audit log contains all required events for full lifecycle', async () => {
      const deps = createFullDeps();
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));
      await handlers.send(makeCommand('send', { prompt: 'test' }));
      await handlers.stop(makeCommand('stop'));

      const events = await readAuditEvents(tempDir);
      const eventNames = events.map((e) => e.event);

      expect(eventNames).toContain('session_started');
      expect(eventNames).toContain('lock_acquired');
      expect(eventNames).toContain('command_received');
      expect(eventNames).toContain('output_delivered');
      expect(eventNames).toContain('session_stopped');
      expect(eventNames).toContain('lock_released');
    });

    it('each audit event has required base fields', async () => {
      const deps = createFullDeps();
      const handlers = createCommandHandlers(deps);

      await handlers.start_session(makeCommand('start_session'));
      await handlers.stop(makeCommand('stop'));

      const events = await readAuditEvents(tempDir);

      for (const event of events) {
        expect(event.timestamp).toBeDefined();
        expect(typeof event.timestamp).toBe('string');
        expect(event.sessionId).toBeDefined();
        expect(typeof event.userId).toBe('number');
        expect(typeof event.chatId).toBe('number');
        expect(event.correlationId).toBeDefined();
      }
    });
  });

  // ------------------------------------------------------------------
  // MVP Success: Remote tasks can be run end-to-end
  // ------------------------------------------------------------------
  describe('remote tasks can be run end-to-end from Telegram on macOS host', () => {
    it('full command flow: start → send → receive result → stop', async () => {
      const deps = createFullDeps();
      const handlers = createCommandHandlers(deps);

      const start = await handlers.start_session(makeCommand('start_session'));
      expect(start.type).toBe('result');

      const send = await handlers.send(makeCommand('send', { prompt: 'list files' }));
      expect(send.type).toBe('result');

      const stop = await handlers.stop(makeCommand('stop'));
      expect(stop.type).toBe('ack');
    });
  });

  // ------------------------------------------------------------------
  // MVP Success: No unmasked critical secret leak in test suite
  // ------------------------------------------------------------------
  describe('no unmasked critical secret leak observed in test suite', () => {
    it('all corpus secrets are fully masked when sent through safe sender', async () => {
      const innerSender = createMockSender();
      const auditWriter = createAuditWriter(tempDir);

      const safeSender = createSafeSender({
        innerSender,
        pipeline: createDefaultPipeline(),
        regexMasker: createRegexMasker(),
        auditWriter,
      });

      // Open audit for the safeSender audit writes
      await auditWriter.open('test-session', new Date());

      for (const { name, input, mustNotContain } of FULL_SECRET_CORPUS) {
        const envelope: ResponseEnvelope = { type: 'result', text: input, timestamp: new Date() };
        await safeSender.sendResponse(1, envelope);

        const calls = (innerSender.sendResponse as ReturnType<typeof vi.fn>).mock.calls;
        const lastCall = calls[calls.length - 1];
        const sentEnvelope: ResponseEnvelope = lastCall[1];

        if (sentEnvelope.type === 'result') {
          expect(
            sentEnvelope.text,
            `"${name}" leaked through safe sender`,
          ).not.toContain(mustNotContain);
        }
      }
    });
  });

  // ------------------------------------------------------------------
  // MVP Success: Every remote action is traceable in local session logs
  // ------------------------------------------------------------------
  describe('every remote action is traceable in local session logs', () => {
    it('multi-step flow produces traceable audit trail', async () => {
      const deps = createFullDeps();
      const handlers = createCommandHandlers(deps);

      // Execute multi-step flow
      await handlers.start_session(makeCommand('start_session'));
      await handlers.send(makeCommand('send', { prompt: 'step 1' }));
      await handlers.send(makeCommand('send', { prompt: 'step 2' }));
      await handlers.new_session(makeCommand('new_session'));
      await handlers.send(makeCommand('send', { prompt: 'step 3' }));
      await handlers.stop(makeCommand('stop'));

      // Verify we have 2 session log files (original + new)
      const files = (await readdir(tempDir)).filter((f) => f.endsWith('.jsonl')).sort();
      expect(files.length).toBe(2);

      // Verify chronological ordering within each file
      for (const file of files) {
        const content = await readFile(join(tempDir, file), 'utf-8');
        const fileEvents: AuditEvent[] = content.split('\n').filter(Boolean).map((l) => JSON.parse(l));
        for (let i = 1; i < fileEvents.length; i++) {
          expect(
            new Date(fileEvents[i].timestamp).getTime(),
            `Events out of order in ${file}`,
          ).toBeGreaterThanOrEqual(
            new Date(fileEvents[i - 1].timestamp).getTime(),
          );
        }
      }

      // Read all events across both files
      const events = await readAuditEvents(tempDir);

      // Verify all events have session IDs (traceability)
      for (const event of events) {
        expect(event.sessionId).toBeTruthy();
      }

      // Verify command_received events exist for all sends
      const commands = events.filter((e) => e.event === 'command_received');
      expect(commands.length).toBe(3);
    });
  });
});
