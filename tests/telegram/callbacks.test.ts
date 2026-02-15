import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerCallbacks } from '../../src/telegram/commands/callbacks.js';
import type { CommandHandlers } from '../../src/telegram/commands/router.js';
import type { TelegramSender } from '../../src/telegram/sender.js';
import type { SessionRegistry } from '../../src/session/registry.js';
import type { FocusManager } from '../../src/session/focus-manager.js';

// --- Mock Bot ---

function createMockBot() {
  const callbackHandlers: Array<(ctx: any) => Promise<void>> = [];

  return {
    on: vi.fn((event: string, handler: (ctx: any) => Promise<void>) => {
      if (event === 'callback_query:data') {
        callbackHandlers.push(handler);
      }
    }),
    _callbackHandlers: callbackHandlers,
    async simulateCallback(ctx: any) {
      for (const handler of callbackHandlers) {
        await handler(ctx);
      }
    },
  };
}

function createMockCtx(data: string, userId = 123, chatId = 456) {
  return {
    callbackQuery: {
      data,
      message: {
        chat: { id: chatId },
        message_id: 42,
      },
    },
    from: { id: userId },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockHandlers(): CommandHandlers {
  const base = vi.fn().mockResolvedValue({
    type: 'result' as const,
    text: 'ok',
    timestamp: new Date(),
    metadata: { showButtons: true },
  });

  return {
    start_session: base,
    send: base,
    status: vi.fn().mockResolvedValue({
      type: 'status' as const,
      sessionActive: true,
      timestamp: new Date(),
      metadata: { showButtons: true, buttonStyle: 'status-only' },
    }),
    stop: vi.fn().mockResolvedValue({
      type: 'ack' as const,
      commandType: 'stop',
      timestamp: new Date(),
    }),
    new_session: vi.fn().mockResolvedValue({
      type: 'ack' as const,
      commandType: 'new_session',
      timestamp: new Date(),
      metadata: { showButtons: true, buttonStyle: 'status-only' },
    }),
    claude_command: base,
    list_sessions: base,
    switch_session: base,
    remove_session: base,
    discover: base,
    attach: base,
    cd: base,
    goto: base,
    back: base,
    resume: base,
    bookmark: base,
    list_bookmarks: base,
    open_bookmark: base,
    unbookmark: base,
  };
}

function createMockSender(): TelegramSender {
  return {
    sendResponse: vi.fn().mockResolvedValue(undefined),
    sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockSessionRegistry(): SessionRegistry {
  return {
    getEntry: vi.fn().mockReturnValue(undefined),
  } as any;
}

function createMockFocusManager(): FocusManager {
  return {
    getFocusedSessionId: vi.fn().mockReturnValue(undefined),
  } as any;
}

describe('registerCallbacks', () => {
  let bot: ReturnType<typeof createMockBot>;
  let handlers: CommandHandlers;
  let sender: TelegramSender;
  let sessionRegistry: SessionRegistry;
  let focusManager: FocusManager;

  beforeEach(() => {
    bot = createMockBot();
    handlers = createMockHandlers();
    sender = createMockSender();
    sessionRegistry = createMockSessionRegistry();
    focusManager = createMockFocusManager();
    registerCallbacks(bot as any, { handlers, sender, sessionRegistry, focusManager });
  });

  it('registers a callback_query:data handler', () => {
    expect(bot.on).toHaveBeenCalledWith('callback_query:data', expect.any(Function));
  });

  it('routes action:status to handlers.status', async () => {
    const ctx = createMockCtx('action:status');
    await bot.simulateCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(handlers.status).toHaveBeenCalledWith(
      expect.objectContaining({
        command: { type: 'status' },
        context: expect.objectContaining({
          userId: 123,
          chatId: 456,
          rawText: '[button:status]',
        }),
      }),
    );
    expect(sender.sendResponse).toHaveBeenCalled();
  });

  it('routes action:stop to handlers.stop', async () => {
    const ctx = createMockCtx('action:stop');
    await bot.simulateCallback(ctx);

    expect(handlers.stop).toHaveBeenCalledWith(
      expect.objectContaining({
        command: { type: 'stop' },
      }),
    );
    expect(sender.sendResponse).toHaveBeenCalled();
  });

  it('routes action:new_session to handlers.new_session', async () => {
    const ctx = createMockCtx('action:new_session');
    await bot.simulateCallback(ctx);

    expect(handlers.new_session).toHaveBeenCalledWith(
      expect.objectContaining({
        command: { type: 'new_session' },
      }),
    );
    expect(sender.sendResponse).toHaveBeenCalled();
  });

  it('answers unknown callback data without calling handlers', async () => {
    const ctx = createMockCtx('unknown:action');
    await bot.simulateCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Unknown action' });
    expect(handlers.status).not.toHaveBeenCalled();
    expect(handlers.stop).not.toHaveBeenCalled();
    expect(handlers.new_session).not.toHaveBeenCalled();
    expect(sender.sendResponse).not.toHaveBeenCalled();
  });

  it('answers callback with invalid prefix', async () => {
    const ctx = createMockCtx('invalid');
    await bot.simulateCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Unknown action' });
    expect(sender.sendResponse).not.toHaveBeenCalled();
  });

  it('handles missing chat ID gracefully', async () => {
    const ctx = {
      callbackQuery: {
        data: 'action:status',
        message: undefined,
      },
      from: { id: 123 },
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    };
    await bot.simulateCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Unable to determine chat' });
    expect(sender.sendResponse).not.toHaveBeenCalled();
  });

  it('creates ValidatedCommand with correct context fields', async () => {
    const ctx = createMockCtx('action:status', 999, 888);
    await bot.simulateCallback(ctx);

    expect(handlers.status).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          userId: 999,
          chatId: 888,
          messageId: 42,
          rawText: '[button:status]',
        }),
      }),
    );
  });

  it('does not send response when handler returns void', async () => {
    (handlers.status as any).mockResolvedValue(undefined);
    const ctx = createMockCtx('action:status');
    await bot.simulateCallback(ctx);

    expect(sender.sendResponse).not.toHaveBeenCalled();
  });
});
