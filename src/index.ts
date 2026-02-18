import { loadConfig } from './config.js';
import { createBot, startBot } from './telegram/bot.js';
import { createAuditWriter } from './audit/writer.js';
import { SessionRegistry } from './session/registry.js';
import { FocusManager } from './session/focus-manager.js';
import { SessionPersistence } from './session/persistence.js';
import { createBookmarkStore } from './session/bookmarks.js';
import { createSessionDiscovery } from './session/discovery.js';
import { VERSION_STRING } from './version.js';

async function main(): Promise<void> {
  console.log(`[telecode] Telecode ${VERSION_STRING}`);
  console.log('[telecode] Loading configuration...');
  const config = loadConfig();

  console.log('[telecode] Initializing session registry...');
  const sessionRegistry = new SessionRegistry({
    maxSessions: config.maxSessions,
    claudeModel: config.claudeModel,
    defaultBackend: config.defaultBackend,
    opencodeBaseUrl: config.opencodeBaseUrl,
    opencodeModel: config.opencodeModel,
  });

  const focusManager = new FocusManager(sessionRegistry);
  const persistence = new SessionPersistence({
    filePath: config.sessionsFilePath,
  });

  // Initialize bookmarks
  console.log('[telecode] Loading bookmarks...');
  const bookmarkStore = createBookmarkStore(config.bookmarksFilePath);
  await bookmarkStore.load();

  // Initialize session discovery
  const sessionDiscovery = createSessionDiscovery();

  // Attempt to restore previous sessions
  console.log('[telecode] Checking for persisted sessions...');
  const savedState = await persistence.load();
  if (savedState && savedState.sessions.length > 0) {
    console.log(`[telecode] Found ${savedState.sessions.length} persisted session(s). Restoring...`);
    for (const meta of savedState.sessions) {
      try {
        let session;
        const backendSessionId = meta.backendSessionId ?? meta.claudeSessionId;
        const backendType = meta.backendType ?? 'claude';

        if (backendSessionId) {
          // Try to resume with existing backend session ID
          try {
            session = await sessionRegistry.resumeSession(
              meta.userId,
              meta.chatId,
              meta.workingDirectory,
              backendSessionId,
              meta.name,
              backendType,
            );
            console.log(`[telecode] Resumed ${backendType} session [${session.sessionId.slice(0, 8)}] with backend session ${backendSessionId.slice(0, 8)} in ${meta.workingDirectory}`);
          } catch (resumeErr) {
            console.warn(`[telecode] Failed to resume ${backendType} session ${backendSessionId.slice(0, 8)}, creating fresh: ${resumeErr}`);
            session = await sessionRegistry.createSession(
              meta.userId,
              meta.chatId,
              meta.workingDirectory,
              meta.name,
              backendType,
            );
            console.log(`[telecode] Created fresh ${backendType} session [${session.sessionId.slice(0, 8)}] in ${meta.workingDirectory}`);
          }
        } else {
          session = await sessionRegistry.createSession(
            meta.userId,
            meta.chatId,
            meta.workingDirectory,
            meta.name,
            backendType,
          );
          console.log(`[telecode] Restored ${backendType} session [${session.sessionId.slice(0, 8)}] in ${meta.workingDirectory}`);
        }
      } catch (err) {
        console.warn(`[telecode] Failed to restore session in ${meta.workingDirectory}: ${err}`);
      }
    }
    // Restore focus map
    focusManager.restoreFocusMap(savedState.focusMap);
    console.log(`[telecode] ${sessionRegistry.size} session(s) restored.`);
  }

  console.log('[telecode] Initializing audit writer...');
  const auditWriter = createAuditWriter(config.logPath);

  console.log('[telecode] Creating bot...');
  const botWithMonitor = createBot({
    config,
    sessionRegistry,
    focusManager,
    persistence,
    auditWriter,
    bookmarkStore,
    sessionDiscovery,
  });

  // Save state on shutdown
  const originalShutdown = () => {
    console.log('[telecode] Saving session state before shutdown...');
    persistence.cancelPendingSave();
    persistence.save(sessionRegistry, focusManager).then(() => {
      console.log('[telecode] Session state saved.');
    }).catch((err) => {
      console.error('[telecode] Failed to save session state:', err);
    });
  };

  process.on('SIGINT', originalShutdown);
  process.on('SIGTERM', originalShutdown);

  console.log('[telecode] Starting bot...');
  await startBot(botWithMonitor);
}

main().catch((err) => {
  console.error('[telecode] Fatal error:', err);
  process.exit(1);
});
