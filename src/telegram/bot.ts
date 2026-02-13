import { Bot } from 'grammy';
import type { AppConfig } from '../config.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { registerCommands } from './commands/router.js';
import { createCommandHandlers } from './commands/handlers.js';
import { createTelegramSender } from './sender.js';
import type { ClaudeAdapter } from '../claude/adapter.js';
import type { AuditWriter } from '../audit/writer.js';

export interface BotDeps {
  config: AppConfig;
  claudeAdapter: ClaudeAdapter;
  auditWriter: AuditWriter;
}

export function createBot(deps: BotDeps): Bot {
  const { config, claudeAdapter, auditWriter } = deps;

  const bot = new Bot(config.telegramBotToken);
  const sender = createTelegramSender(bot);

  const handlers = createCommandHandlers({
    claudeAdapter,
    sender,
    auditWriter,
  });

  // Register auth middleware — runs before any command handlers
  bot.use(createAuthMiddleware(config.allowedUserIds));

  // Register command routing
  registerCommands(bot, handlers, sender);

  return bot;
}

export async function startBot(bot: Bot): Promise<void> {
  const shutdown = () => {
    console.log('[bot] Shutting down...');
    bot.stop();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[bot] Starting long polling...');
  await bot.start({
    onStart: () => {
      console.log('[bot] Bot is running.');
    },
  });
}
