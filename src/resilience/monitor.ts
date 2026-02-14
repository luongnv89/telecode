/**
 * Resilience monitor for session crash detection, audit write failure alerting,
 * and timeout enforcement.
 */

import type { SessionRegistry } from '../session/registry.js';
import type { TelegramSender } from '../telegram/sender.js';
import { createError } from '../types/envelope.js';

export interface ResilienceMonitorDeps {
  sessionRegistry: SessionRegistry;
  sender: TelegramSender;
  sessionTimeoutMs: number;
  checkIntervalMs?: number;
}

export interface ResilienceMonitor {
  start(): void;
  stop(): void;
  /** Notify the operator of a critical audit write failure. */
  notifyAuditWriteFailure(chatId: number, error: Error): Promise<void>;
  /** Notify the operator of a session crash. */
  notifySessionCrash(chatId: number, error: Error): Promise<void>;
}

export function createResilienceMonitor(deps: ResilienceMonitorDeps): ResilienceMonitor {
  const {
    sessionRegistry,
    sender,
    sessionTimeoutMs,
    checkIntervalMs = 30_000,
  } = deps;

  let intervalId: ReturnType<typeof setInterval> | null = null;

  function checkSessionHealth(): void {
    // Check all sessions for stale locks
    for (const [sessionId, entry] of sessionRegistry.getAllEntries()) {
      if (entry.lock.checkStale(sessionTimeoutMs)) {
        const lockInfo = entry.lock.getLockInfo();
        if (lockInfo) {
          console.warn(
            `[resilience] Stale session detected: session ${sessionId} ` +
            `for user ${lockInfo.userId} in chat ${lockInfo.chatId}`,
          );

          // Notify the user that their session timed out
          sender.sendResponse(lockInfo.chatId, createError(
            'SESSION_TIMEOUT',
            `Session [${sessionId.slice(0, 8)}] timed out due to inactivity.`,
          )).catch((err) => {
            console.error(`[resilience] Failed to send timeout notification: ${err}`);
          });

          // Clean up: release lock and stop session
          entry.lock.forceRelease();
          if (entry.manager.isActive()) {
            entry.manager.stopSession().catch((err) => {
              console.error(`[resilience] Failed to stop stale session: ${err}`);
            });
          }

          // Remove from registry
          sessionRegistry.removeSession(sessionId).catch((err) => {
            console.error(`[resilience] Failed to remove stale session: ${err}`);
          });
        }
      }
    }
  }

  return {
    start(): void {
      if (intervalId) return;
      intervalId = setInterval(checkSessionHealth, checkIntervalMs);
      console.log(`[resilience] Monitor started (check every ${checkIntervalMs}ms, timeout ${sessionTimeoutMs}ms)`);
    },

    stop(): void {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log('[resilience] Monitor stopped');
      }
    },

    async notifyAuditWriteFailure(chatId: number, error: Error): Promise<void> {
      console.error(`[resilience] CRITICAL: Audit write failure: ${error.message}`);
      try {
        await sender.sendResponse(chatId, createError(
          'INTERNAL_ERROR',
          `AUDIT FAILURE: Log write failed — ${error.message}. Session audit trail may be incomplete.`,
        ));
      } catch (sendErr) {
        console.error(`[resilience] Failed to send audit failure notification: ${sendErr}`);
      }
    },

    async notifySessionCrash(chatId: number, error: Error): Promise<void> {
      console.error(`[resilience] Session crash detected: ${error.message}`);
      try {
        await sender.sendResponse(chatId, createError(
          'CLAUDE_ERROR',
          `Session crashed: ${error.message}. Use /start_session to begin a new session.`,
        ));
      } catch (sendErr) {
        console.error(`[resilience] Failed to send crash notification: ${sendErr}`);
      }
    },
  };
}
