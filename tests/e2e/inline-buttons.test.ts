import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCommandHandlers, type HandlerDeps } from '../../src/telegram/commands/handlers.js';
import type { TelegramSender } from '../../src/telegram/sender.js';
import type { ValidatedCommand } from '../../src/types/commands.js';
import type { SessionRegistry, RegistryEntry } from '../../src/session/registry.js';
import type { FocusManager } from '../../src/session/focus-manager.js';
import type { SessionPersistence } from '../../src/session/persistence.js';
import type { Session } from '../../src/types/session.js';
import type { ClaudeAdapter } from '../../src/claude/adapter.js';
import type { SessionManager } from '../../src/claude/session-manager.js';
import type { AuditWriter } from '../../src/audit/writer.js';
import { createLockManager } from '../../src/lock/manager.js';
import type { ResponseEnvelope, EnvelopeMetadata } from '../../src/types/envelope.js';

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
    rawText: type.startsWith('[') ? type : `/${type}`,
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
  return { sendResponse: vi.fn().mockResolvedValue(undefined), sendTypingIndicator: vi.fn().mockResolvedValue(undefined) };
}

function createMockAuditWriter(): AuditWriter {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createHandlerDeps(adapter: ClaudeAdapter, sender: TelegramSender): HandlerDeps {
  const lock = createLockManager();
  const session: Session = {
    sessionId: 'sess-001',
    claudeSessionId: 'claude-001',
    userId: 100,
    chatId: 200,
    workingDirectory: process.cwd(),
    startedAt: new Date(),
    state: 'active',
    lastActivityAt: new Date(),
  };
  lock.acquire(100, 200, 'sess-001');

  const manager: SessionManager = {
    getSession: vi.fn().mockReturnValue(session),
    isActive: vi.fn().mockReturnValue(true),
    updateState: vi.fn(),
    resetSession: vi.fn().mockResolvedValue({
      ...session,
      sessionId: 'sess-002',
      claudeSessionId: 'claude-002',
    }),
  } as any;

  const entry: RegistryEntry = {
    manager,
    adapter,
    lock,
    name: undefined,
    workingDirectory: process.cwd(),
  };

  const entriesMap = new Map<string, RegistryEntry>([['sess-001', entry]]);

  const sessionRegistry: SessionRegistry = {
    createSession: vi.fn().mockResolvedValue(session),
    attachSession: vi.fn().mockResolvedValue(session),
    removeSession: vi.fn().mockResolvedValue(undefined),
    getEntry: vi.fn((id: string) => entriesMap.get(id)),
    getAllEntries: vi.fn().mockReturnValue(entriesMap),
    listSessions: vi.fn().mockReturnValue([
      {
        sessionId: 'sess-001',
        name: undefined,
        workingDirectory: process.cwd(),
        state: 'active',
        isFocused: true,
      },
    ]),
    findSessionId: vi.fn().mockReturnValue(null),
    size: 1,
    maxSessions: 5,
  } as any;

  const focusManager: FocusManager = {
    setFocus: vi.fn(),
    getFocusedSessionId: vi.fn().mockReturnValue('sess-001'),
    clearFocus: vi.fn(),
    clearFocusForSession: vi.fn(),
    popFocus: vi.fn(),
  } as any;

  const persistence: SessionPersistence = {
    scheduleSave: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
  } as any;

  return {
    sessionRegistry,
    focusManager,
    persistence,
    sender,
    auditWriter: createMockAuditWriter(),
  };
}

// ---- Tests ----

describe('e2e: inline button metadata in handler responses', () => {
  let adapter: ClaudeAdapter;
  let sender: TelegramSender;
  let deps: HandlerDeps;
  let handlers: ReturnType<typeof createCommandHandlers>;

  beforeEach(() => {
    adapter = createMockAdapter();
    sender = createMockSender();
    deps = createHandlerDeps(adapter, sender);
    handlers = createCommandHandlers(deps);
  });

  it('start_session returns result with showButtons=true (full)', async () => {
    const cmd = makeCommand('start_session');
    const response = await handlers.start_session(cmd) as ResponseEnvelope;

    expect(response.type).toBe('result');
    expect(response.metadata).toBeDefined();
    expect(response.metadata!.showButtons).toBe(true);
    expect(response.metadata!.buttonStyle).toBeUndefined(); // defaults to full
  });

  it('send returns result with showButtons=true (full)', async () => {
    const cmd = makeCommand('send', { prompt: 'hello world' });
    const response = await handlers.send(cmd) as ResponseEnvelope;

    expect(response.type).toBe('result');
    expect(response.metadata).toBeDefined();
    expect(response.metadata!.showButtons).toBe(true);
    expect(response.metadata!.buttonStyle).toBeUndefined();
  });

  it('status returns status with showButtons=true, buttonStyle=status-only', async () => {
    const cmd = makeCommand('status');
    const response = await handlers.status(cmd) as ResponseEnvelope;

    expect(response.type).toBe('status');
    expect(response.metadata).toBeDefined();
    expect(response.metadata!.showButtons).toBe(true);
    expect(response.metadata!.buttonStyle).toBe('status-only');
  });

  it('new_session returns ack with showButtons=true, buttonStyle=status-only', async () => {
    const cmd = makeCommand('new_session');
    const response = await handlers.new_session(cmd) as ResponseEnvelope;

    expect(response.type).toBe('ack');
    expect(response.metadata).toBeDefined();
    expect(response.metadata!.showButtons).toBe(true);
    expect(response.metadata!.buttonStyle).toBe('status-only');
  });

  it('list_sessions returns result with showButtons=true (full)', async () => {
    const cmd = makeCommand('list_sessions');
    const response = await handlers.list_sessions(cmd) as ResponseEnvelope;

    expect(response.type).toBe('result');
    expect(response.metadata).toBeDefined();
    expect(response.metadata!.showButtons).toBe(true);
  });

  it('stop does NOT include button metadata', async () => {
    const cmd = makeCommand('stop');
    const response = await handlers.stop(cmd) as ResponseEnvelope;

    expect(response.type).toBe('ack');
    expect(response.metadata).toBeUndefined();
  });

  it('status with no focused session returns no buttons', async () => {
    (deps.focusManager.getFocusedSessionId as any).mockReturnValue(null);
    handlers = createCommandHandlers(deps);

    const cmd = makeCommand('status');
    const response = await handlers.status(cmd) as ResponseEnvelope;

    expect(response.type).toBe('status');
    expect(response.metadata).toBeUndefined();
  });

  it('button-triggered command uses [button:action] rawText format', async () => {
    // Simulate what the callback handler creates
    const cmd: ValidatedCommand = {
      command: { type: 'status' },
      context: {
        userId: 100,
        chatId: 200,
        messageId: 42,
        timestamp: new Date(),
        rawText: '[button:status]',
      },
    };

    const response = await handlers.status(cmd) as ResponseEnvelope;
    expect(response.type).toBe('status');
    expect(response.metadata?.showButtons).toBe(true);
  });
});
