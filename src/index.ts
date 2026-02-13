import { loadConfig } from './config.js';
import { createBot, startBot } from './telegram/bot.js';
import { createClaudeAdapter } from './claude/adapter.js';
import { createAuditWriter } from './audit/writer.js';

async function main(): Promise<void> {
  console.log('[telecode] Loading configuration...');
  const config = loadConfig();

  console.log('[telecode] Initializing Claude adapter...');
  const claudeAdapter = createClaudeAdapter({
    model: config.claudeModel,
  });

  console.log('[telecode] Initializing audit writer...');
  const auditWriter = createAuditWriter(config.logPath);

  console.log('[telecode] Creating bot...');
  const bot = createBot({
    config,
    claudeAdapter,
    auditWriter,
  });

  console.log('[telecode] Starting bot...');
  await startBot(bot);
}

main().catch((err) => {
  console.error('[telecode] Fatal error:', err);
  process.exit(1);
});
