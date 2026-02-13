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
import { TelecodeError } from '../../types/errors.js';
import type { CommandHandlers } from './router.js';

export interface HandlerDeps {
  claudeAdapter: ClaudeAdapter;
  sessionManager: SessionManager;
  sender: TelegramSender;
  auditWriter: AuditWriter;
}

export function createCommandHandlers(deps: HandlerDeps): CommandHandlers {
  const { claudeAdapter, sessionManager, sender, auditWriter } = deps;

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
        const session = await sessionManager.startSession(userId, chatId);

        await auditWriter.open(session.sessionId, session.startedAt);
        await auditWriter.write({
          event: 'session_started',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          claudeSessionId: session.claudeSessionId,
          userId,
          chatId,
          correlationId: session.sessionId,
        });

        return createAck('start_session');
      } catch (err) {
        return handleError(err);
      }
    },

    async send(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'send') {
          return createError('INTERNAL_ERROR', 'Expected send command');
        }

        const session = sessionManager.getSession();
        if (!session || !sessionManager.isActive()) {
          return createError('SESSION_NOT_FOUND', 'No active session. Use /start_session first.');
        }

        const { chatId } = cmd.context;
        const { prompt } = cmd.command;

        sessionManager.updateState('busy');

        await auditWriter.write({
          event: 'command_received',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          claudeSessionId: session.claudeSessionId,
          userId: session.userId,
          chatId: session.chatId,
          correlationId: session.sessionId,
          commandType: 'send',
          rawText: cmd.context.rawText,
        });

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

        await auditWriter.write({
          event: 'output_delivered',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          claudeSessionId: session.claudeSessionId,
          userId: session.userId,
          chatId: session.chatId,
          correlationId: session.sessionId,
          charCount: result.text.length,
        });

        if (!result.success) {
          return createError('CLAUDE_ERROR', result.text);
        }

        return createResult(result.text);
      } catch (err) {
        sessionManager.updateState('active');
        return handleError(err);
      }
    },

    async status(_cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        const session = sessionManager.getSession();
        const claudeInfo = claudeAdapter.getStatus();

        return createStatus({
          sessionActive: sessionManager.isActive(),
          sessionId: session?.sessionId,
          state: session?.state ?? claudeInfo.state,
          uptime: session
            ? Date.now() - session.startedAt.getTime()
            : undefined,
        });
      } catch (err) {
        return handleError(err);
      }
    },

    async stop(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        const session = sessionManager.getSession();

        if (session) {
          await auditWriter.write({
            event: 'session_stopped',
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
            claudeSessionId: session.claudeSessionId,
            userId: session.userId,
            chatId: session.chatId,
            correlationId: session.sessionId,
          });
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
        const oldSession = sessionManager.getSession();

        if (oldSession) {
          await auditWriter.write({
            event: 'session_reset',
            timestamp: new Date().toISOString(),
            sessionId: oldSession.sessionId,
            claudeSessionId: oldSession.claudeSessionId,
            userId: oldSession.userId,
            chatId: oldSession.chatId,
            correlationId: oldSession.sessionId,
          });
          await auditWriter.close();
        }

        const { userId, chatId } = cmd.context;
        const newSession = await sessionManager.resetSession();

        await auditWriter.open(newSession.sessionId, newSession.startedAt);
        await auditWriter.write({
          event: 'session_started',
          timestamp: new Date().toISOString(),
          sessionId: newSession.sessionId,
          claudeSessionId: newSession.claudeSessionId,
          userId,
          chatId,
          correlationId: newSession.sessionId,
        });

        return createAck('new_session');
      } catch (err) {
        return handleError(err);
      }
    },
  };
}
