import { Bot } from 'grammy';
import type { AppConfig } from '../config.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { registerCommands } from './commands/router.js';
import { createCommandHandlers } from './commands/handlers.js';
import { createTelegramSender } from './sender.js';
import { SessionManager } from '../claude/session-manager.js';
import { createLockManager } from '../lock/manager.js';
import { createDefaultPipeline } from '../sanitize/pipeline.js';
import { createRegexMasker } from '../sanitize/regex-masking.js';
import { createSafeSender } from '../sanitize/outbound.js';
import { createResilienceMonitor, type ResilienceMonitor } from '../resilience/monitor.js';
import type { ClaudeAdapter } from '../claude/adapter.js';
import type { AuditWriter } from '../audit/writer.js';

export interface BotDeps {
  config: AppConfig;
  claudeAdapter: ClaudeAdapter;
  auditWriter: AuditWriter;
}

export interface BotWithMonitor {
  bot: Bot;
  monitor: ResilienceMonitor;
}

export function createBot(deps: BotDeps): BotWithMonitor {
  const { config, claudeAdapter, auditWriter } = deps;

  const bot = new Bot(config.telegramBotToken);
  const rawSender = createTelegramSender(bot);
  const sessionManager = new SessionManager(claudeAdapter);
  const lockManager = createLockManager();

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

  // Create resilience monitor for crash detection and timeout enforcement
  const monitor = createResilienceMonitor({
    sessionManager,
    lockManager,
    sender: safeSender,
    sessionTimeoutMs: config.sessionTimeoutMs,
  });

  const handlers = createCommandHandlers({
    claudeAdapter,
    sessionManager,
    lockManager,
    sender: safeSender,
    auditWriter,
    sessionTimeoutMs: config.sessionTimeoutMs,
    monitor,
  });

  // Register auth middleware — runs before any command handlers
  bot.use(createAuthMiddleware(config.allowedUserIds));

  // Register command routing — safe sender used for both handler responses and parse errors
  registerCommands(bot, handlers, safeSender);

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
