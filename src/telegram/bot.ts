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
import { createPermissionBridge } from './permission-bridge.js';
import { createResilienceMonitor, type ResilienceMonitor } from '../resilience/monitor.js';
import type { AuditWriter } from '../audit/writer.js';
import type { SessionRegistry } from '../session/registry.js';
import type { FocusManager } from '../session/focus-manager.js';
import type { SessionPersistence } from '../session/persistence.js';
import type { BookmarkStore } from '../session/bookmarks.js';
import type { SessionDiscovery } from '../session/discovery.js';
import { createUserPreferences } from './user-preferences.js';

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

  // Set up permission handler factory so sessions can bridge permission requests to Telegram
  sessionRegistry.setPermissionHandlerFactory((chatId, backendType) => {
    if (backendType === 'opencode') {
      // OpenCode handles tool permissions via its own mechanism (permission.updated events)
      // No Claude-style canUseTool callback needed
      return {};
    }

    const bridge = createPermissionBridge({
      chatId,
      sendMessage: (cid, text, keyboard) => safeSender.sendMessage(cid, text, keyboard),
      timeoutMs: config.permissionTimeoutMs,
    });
    return { canUseTool: bridge.canUseTool, bridge };
  });

  // Create a lightweight resilience monitor.
  // In multi-session mode, the monitor checks all sessions in the registry.
  const monitor = createResilienceMonitor({
    sessionRegistry,
    sender: safeSender,
    sessionTimeoutMs: config.sessionTimeoutMs,
  });

  const userPreferences = createUserPreferences(config.defaultDisplayMode);

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
    userPreferences,
  });

  // Register auth middleware — runs before any command handlers
  bot.use(createAuthMiddleware(config.allowedUserIds));

  // Register command routing — safe sender used for both handler responses and parse errors
  registerCommands(bot, handlers, safeSender);

  // Register inline button callback handlers (including permission buttons)
  registerCallbacks(bot, {
    handlers,
    sender: safeSender,
    sessionRegistry,
    focusManager,
  });

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

  // Register command menu with Telegram so users see suggestions when typing /
  await bot.api.setMyCommands([
    { command: 'start', description: 'Start a new session (--backend=opencode)' },
    { command: 'status', description: 'Show current session status' },
    { command: 'stop', description: 'Stop the focused session' },
    { command: 'new_session', description: 'Reset the current session' },
    { command: 'sessions', description: 'List all active sessions' },
    { command: 'switch', description: 'Switch to a different session' },
    { command: 'remove', description: 'Remove a session' },
    { command: 'discover', description: 'Discover running Claude Code sessions' },
    { command: 'attach', description: 'Attach to a discovered session' },
    { command: 'cd', description: 'Change directory (creates session)' },
    { command: 'goto', description: 'Go to a specific session' },
    { command: 'back', description: 'Return to previous session' },
    { command: 'resume', description: 'Resume a session' },
    { command: 'bookmark', description: 'Save a directory bookmark' },
    { command: 'bookmarks', description: 'List all bookmarks' },
    { command: 'open', description: 'Open a bookmarked directory' },
    { command: 'unbookmark', description: 'Remove a bookmark' },
    { command: 'verbose', description: 'Set verbose display mode' },
    { command: 'concise', description: 'Set concise display mode' },
    { command: 'cc_clear', description: 'Send /clear to Claude Code' },
    { command: 'cc_compact', description: 'Send /compact to Claude Code' },
    { command: 'cc_context', description: 'Send /context to Claude Code' },
    { command: 'cc_resume', description: 'Send /resume to Claude Code' },
    { command: 'version', description: 'Show bot version' },
  ]);

  // Start the resilience monitor
  monitor.start();

  console.log('[bot] Starting long polling...');
  await bot.start({
    onStart: () => {
      console.log('[bot] Bot is running.');
    },
  });
}
