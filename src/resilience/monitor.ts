/**
 * Resilience monitor for session crash detection, audit write failure alerting,
 * and timeout enforcement.
 */

import type { SessionManager } from '../claude/session-manager.js';
import type { LockManager } from '../lock/manager.js';
import type { TelegramSender } from '../telegram/sender.js';
import { createError } from '../types/envelope.js';

export interface ResilienceMonitorDeps {
  sessionManager: SessionManager;
  lockManager: LockManager;
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
    sessionManager,
    lockManager,
    sender,
    sessionTimeoutMs,
    checkIntervalMs = 30_000,
  } = deps;

  let intervalId: ReturnType<typeof setInterval> | null = null;

  function checkSessionHealth(): void {
    // Check for stale locks (session timeout)
    if (lockManager.checkStale(sessionTimeoutMs)) {
      const lockInfo = lockManager.getLockInfo();
      if (lockInfo) {
        console.warn(
          `[resilience] Stale session detected: session ${lockInfo.sessionId} ` +
          `for user ${lockInfo.userId} in chat ${lockInfo.chatId}`,
        );

        // Notify the user that their session timed out
        sender.sendResponse(lockInfo.chatId, createError(
          'SESSION_TIMEOUT',
          'Your session has timed out due to inactivity. Use /start_session to begin a new session.',
        )).catch((err) => {
          console.error(`[resilience] Failed to send timeout notification: ${err}`);
        });

        // Clean up: release lock and stop session
        lockManager.forceRelease();
        if (sessionManager.isActive()) {
          sessionManager.stopSession().catch((err) => {
            console.error(`[resilience] Failed to stop stale session: ${err}`);
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
          `⚠ AUDIT FAILURE: Log write failed — ${error.message}. Session audit trail may be incomplete.`,
        ));
      } catch (sendErr) {
        console.error(`[resilience] Failed to send audit failure notification: ${sendErr}`);
      }
    },

    async notifySessionCrash(chatId: number, error: Error): Promise<void> {
      console.error(`[resilience] Session crash detected: ${error.message}`);
      try {
        // Clean up stale state
        lockManager.forceRelease();

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
