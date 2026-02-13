import type { ValidatedCommand } from '../../types/commands.js';
import {
  createAck,
  createStatus,
  createResult,
  createError,
  createProgress,
  type ResponseEnvelope,
} from '../../types/envelope.js';
import type { ClaudeAdapter } from '../../claude/adapter.js';
import type { TelegramSender } from '../sender.js';
import type { AuditWriter } from '../../audit/writer.js';
import type { SessionManager } from '../../claude/session-manager.js';
import type { LockManager } from '../../lock/manager.js';
import type { ResilienceMonitor } from '../../resilience/monitor.js';
import { TelecodeError } from '../../types/errors.js';
import type { CommandHandlers } from './router.js';

export interface HandlerDeps {
  claudeAdapter: ClaudeAdapter;
  sessionManager: SessionManager;
  lockManager: LockManager;
  sender: TelegramSender;
  auditWriter: AuditWriter;
  sessionTimeoutMs?: number;
  monitor?: ResilienceMonitor;
}

export function createCommandHandlers(deps: HandlerDeps): CommandHandlers {
  const { claudeAdapter, sessionManager, lockManager, sender, auditWriter, monitor } = deps;

  /** Safe audit write that alerts on failure via the resilience monitor. */
  async function safeAuditWrite(event: Parameters<AuditWriter['write']>[0], chatId?: number): Promise<void> {
    try {
      await auditWriter.write(event);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[audit] Write failure: ${error.message}`);
      if (monitor && chatId) {
        await monitor.notifyAuditWriteFailure(chatId, error);
      }
    }
  }

  function handleError(err: unknown): ResponseEnvelope {
    if (err instanceof TelecodeError) {
      const code = err.code === 'SESSION_NOT_FOUND' || err.code === 'SESSION_LOCKED'
        ? err.code
        : err.code === 'CLAUDE_ERROR' || err.code === 'CLAUDE_TIMEOUT'
          ? err.code
          : 'INTERNAL_ERROR';
      return createError(code, err.message);
    }
    if (err instanceof Error) {
      return createError('INTERNAL_ERROR', err.message);
    }
    return createError('INTERNAL_ERROR', 'An unexpected error occurred');
  }

  return {
    async start_session(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        const { userId, chatId } = cmd.context;

        // Check for stale locks and auto-release
        if (lockManager.checkStale(deps.sessionTimeoutMs ?? 1_800_000)) {
          const staleInfo = lockManager.getLockInfo();
          lockManager.forceRelease();
          // Best-effort cleanup of stale session
          if (sessionManager.isActive()) {
            await sessionManager.stopSession();
          }
          await safeAuditWrite({
            event: 'lock_stale_released',
            timestamp: new Date().toISOString(),
            sessionId: staleInfo?.sessionId ?? 'unknown',
            userId: staleInfo?.userId ?? 0,
            chatId: staleInfo?.chatId ?? 0,
            correlationId: staleInfo?.sessionId ?? 'unknown',
          }, chatId);
        }

        // Attempt to acquire the connection lock
        const lockResult = lockManager.acquire(userId, chatId, 'pending');
        if (!lockResult.acquired) {
          await safeAuditWrite({
            event: 'lock_rejected',
            timestamp: new Date().toISOString(),
            sessionId: 'none',
            userId,
            chatId,
            correlationId: 'none',
            reason: lockResult.reason,
            heldByUserId: lockResult.heldBy.userId,
            heldByChatId: lockResult.heldBy.chatId,
          }, chatId);
          return createError(
            'SESSION_LOCKED',
            `Connection locked: ${lockResult.reason}. Use /stop from the owning chat first.`,
          );
        }

        const session = await sessionManager.startSession(userId, chatId);

        // Re-acquire lock with actual session ID
        lockManager.acquire(userId, chatId, session.sessionId);

        await auditWriter.open(session.sessionId, session.startedAt);
        await safeAuditWrite({
          event: 'session_started',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          claudeSessionId: session.claudeSessionId,
          userId,
          chatId,
          correlationId: session.sessionId,
        }, chatId);
        await safeAuditWrite({
          event: 'lock_acquired',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          userId,
          chatId,
          correlationId: session.sessionId,
        }, chatId);

        return createAck('start_session');
      } catch (err) {
        // Release lock on failure so the user isn't stuck
        lockManager.forceRelease();
        return handleError(err);
      }
    },

    async send(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'send') {
          return createError('INTERNAL_ERROR', 'Expected send command');
        }

        // Check lock ownership
        const lockInfo = lockManager.getLockInfo();
        if (!lockInfo) {
          return createError('SESSION_NOT_FOUND', 'No active session. Use /start_session first.');
        }
        if (lockInfo.userId !== cmd.context.userId || lockInfo.chatId !== cmd.context.chatId) {
          return createError(
            'SESSION_LOCKED',
            'Session is owned by another connection.',
          );
        }

        const session = sessionManager.getSession();
        if (!session || !sessionManager.isActive()) {
          return createError('SESSION_NOT_FOUND', 'No active session. Use /start_session first.');
        }

        const { chatId } = cmd.context;
        const { prompt } = cmd.command;

        sessionManager.updateState('busy');

        await safeAuditWrite({
          event: 'command_received',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          claudeSessionId: session.claudeSessionId,
          userId: session.userId,
          chatId: session.chatId,
          correlationId: session.sessionId,
          commandType: 'send',
          rawText: cmd.context.rawText,
        }, chatId);

        const result = await claudeAdapter.sendPrompt(
          session.sessionId,
          prompt,
          (chunk) => {
            if (chunk.type === 'text') {
              sender.sendResponse(chatId, createProgress(chunk.content)).catch(() => {
                // Best-effort progress streaming; swallow send errors
              });
            }
          },
        );

        sessionManager.updateState('active');

        await safeAuditWrite({
          event: 'output_delivered',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          claudeSessionId: session.claudeSessionId,
          userId: session.userId,
          chatId: session.chatId,
          correlationId: session.sessionId,
          charCount: result.text.length,
        }, chatId);

        if (!result.success) {
          return createError('CLAUDE_ERROR', result.text);
        }

        return createResult(result.text);
      } catch (err) {
        sessionManager.updateState('active');

        // Detect session crash and notify user
        if (monitor && err instanceof Error) {
          const session = sessionManager.getSession();
          const chatId = session?.chatId ?? cmd.context.chatId;
          await monitor.notifySessionCrash(chatId, err);
        }

        return handleError(err);
      }
    },

    async status(_cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        const session = sessionManager.getSession();
        const claudeInfo = claudeAdapter.getStatus();
        const lockInfo = lockManager.getLockInfo();

        return createStatus({
          sessionActive: sessionManager.isActive(),
          sessionId: session?.sessionId,
          state: session?.state ?? claudeInfo.state,
          uptime: session
            ? Date.now() - session.startedAt.getTime()
            : undefined,
          locked: lockManager.isLocked(),
          lockOwnerUserId: lockInfo?.userId,
        });
      } catch (err) {
        return handleError(err);
      }
    },

    async stop(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        // Check lock ownership — only the lock holder can stop
        const lockInfo = lockManager.getLockInfo();
        if (lockInfo && lockInfo.userId !== cmd.context.userId) {
          return createError(
            'SESSION_LOCKED',
            'Only the session owner can stop the session.',
          );
        }

        const session = sessionManager.getSession();

        if (session) {
          await safeAuditWrite({
            event: 'session_stopped',
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
            claudeSessionId: session.claudeSessionId,
            userId: session.userId,
            chatId: session.chatId,
            correlationId: session.sessionId,
          }, session.chatId);

          // Release the connection lock
          lockManager.release(session.sessionId);
          await safeAuditWrite({
            event: 'lock_released',
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
            userId: session.userId,
            chatId: session.chatId,
            correlationId: session.sessionId,
          }, session.chatId);
        }

        await sessionManager.stopSession();
        await auditWriter.close();

        return createAck('stop');
      } catch (err) {
        return handleError(err);
      }
    },

    async new_session(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        const { userId, chatId } = cmd.context;

        // Check lock ownership — only the lock holder can reset
        const lockInfo = lockManager.getLockInfo();
        if (!lockInfo) {
          return createError('SESSION_NOT_FOUND', 'No active session to reset. Use /start_session first.');
        }
        if (lockInfo.userId !== userId || lockInfo.chatId !== chatId) {
          return createError(
            'SESSION_LOCKED',
            'Only the session owner can reset the session.',
          );
        }

        const oldSession = sessionManager.getSession();

        if (oldSession) {
          await safeAuditWrite({
            event: 'session_reset',
            timestamp: new Date().toISOString(),
            sessionId: oldSession.sessionId,
            claudeSessionId: oldSession.claudeSessionId,
            userId: oldSession.userId,
            chatId: oldSession.chatId,
            correlationId: oldSession.sessionId,
          }, chatId);
          await auditWriter.close();
        }

        const newSession = await sessionManager.resetSession();

        // Update lock with new session ID
        lockManager.acquire(userId, chatId, newSession.sessionId);

        await auditWriter.open(newSession.sessionId, newSession.startedAt);
        await safeAuditWrite({
          event: 'session_started',
          timestamp: new Date().toISOString(),
          sessionId: newSession.sessionId,
          claudeSessionId: newSession.claudeSessionId,
          userId,
          chatId,
          correlationId: newSession.sessionId,
        }, chatId);

        return createAck('new_session');
      } catch (err) {
        return handleError(err);
      }
    },
  };
}
