import { Bot } from 'grammy';
import type { AppConfig } from '../config.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { registerCommands } from './commands/router.js';
import { registerCallbacks } from './commands/callbacks.js';
import { createCommandHandlers } from './commands/handlers.js';
import { createTelegramSender } from './sender.js';
import { createDefaultPipeline } from '../sanitize/pipeline.js';
import { createRegexMasker } from '../sanitize/regex-masking.js';
import { createSafeSender } from '../sanitize/outbound.js';
import { createResilienceMonitor, type ResilienceMonitor } from '../resilience/monitor.js';
import type { AuditWriter } from '../audit/writer.js';
import type { SessionRegistry } from '../session/registry.js';
import type { FocusManager } from '../session/focus-manager.js';
import type { SessionPersistence } from '../session/persistence.js';
import type { BookmarkStore } from '../session/bookmarks.js';
import type { SessionDiscovery } from '../session/discovery.js';

export interface BotDeps {
  config: AppConfig;
  sessionRegistry: SessionRegistry;
  focusManager: FocusManager;
  persistence: SessionPersistence;
  auditWriter: AuditWriter;
  bookmarkStore?: BookmarkStore;
  sessionDiscovery?: SessionDiscovery;
}

export interface BotWithMonitor {
  bot: Bot;
  monitor: ResilienceMonitor;
}

export function createBot(deps: BotDeps): BotWithMonitor {
  const { config, sessionRegistry, focusManager, persistence, auditWriter, bookmarkStore, sessionDiscovery } = deps;

  const bot = new Bot(config.telegramBotToken);
  const rawSender = createTelegramSender(bot);

  // Wrap sender with sanitization pipeline + regex masking
  const safeSender = createSafeSender({
    innerSender: rawSender,
    pipeline: createDefaultPipeline(),
    regexMasker: createRegexMasker(),
    auditWriter,
    onSanitizeFailure: (chatId, error) => {
      console.error(`[bot] Sanitization failure for chat ${chatId}: ${error.message}`);
    },
  });

  // Create a lightweight resilience monitor.
  // In multi-session mode, the monitor checks all sessions in the registry.
  const monitor = createResilienceMonitor({
    sessionRegistry,
    sender: safeSender,
    sessionTimeoutMs: config.sessionTimeoutMs,
  });

  const handlers = createCommandHandlers({
    sessionRegistry,
    focusManager,
    persistence,
    sender: safeSender,
    auditWriter,
    sessionTimeoutMs: config.sessionTimeoutMs,
    monitor,
    bookmarkStore,
    sessionDiscovery,
  });

  // Register auth middleware — runs before any command handlers
  bot.use(createAuthMiddleware(config.allowedUserIds));

  // Register command routing — safe sender used for both handler responses and parse errors
  registerCommands(bot, handlers, safeSender);

  // Register inline button callback handlers
  registerCallbacks(bot, handlers, safeSender);

  return { bot, monitor };
}

export async function startBot({ bot, monitor }: BotWithMonitor): Promise<void> {
  const shutdown = () => {
    console.log('[bot] Shutting down...');
    monitor.stop();
    bot.stop();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start the resilience monitor
  monitor.start();

  console.log('[bot] Starting long polling...');
  await bot.start({
    onStart: () => {
      console.log('[bot] Bot is running.');
    },
  });
}
