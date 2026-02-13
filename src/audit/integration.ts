import type { AuditWriter } from './writer.js';
import type { AuditEvent } from '../types/audit.js';
import * as schema from './schema.js';
import { TelecodeError } from '../types/errors.js';

export interface AuditContext {
  sessionId: string;
  userId: number;
  chatId: number;
  claudeSessionId?: string;
}

export interface AuditLogger {
  logSessionStarted(ctx: AuditContext): Promise<void>;
  logSessionStopped(ctx: AuditContext): Promise<void>;
  logSessionReset(ctx: AuditContext): Promise<void>;
  logCommandReceived(ctx: AuditContext, commandType: string, rawText: string): Promise<void>;
  logOutputSanitized(ctx: AuditContext, redactionCount: number): Promise<void>;
  logOutputDelivered(ctx: AuditContext, charCount: number): Promise<void>;
  logLockAcquired(ctx: AuditContext): Promise<void>;
  logLockReleased(ctx: AuditContext): Promise<void>;
  logLockStaleReleased(ctx: AuditContext): Promise<void>;
  logLockRejected(ctx: AuditContext, reason: string, heldByUserId: number, heldByChatId: number): Promise<void>;
  logError(ctx: AuditContext, errorCode: string, errorMessage: string): Promise<void>;
}

async function safeWrite(writer: AuditWriter, event: AuditEvent): Promise<void> {
  try {
    await writer.write(event);
  } catch (err) {
    if (err instanceof TelecodeError && err.code === 'AUDIT_WRITE_ERROR') {
      console.error(`[AUDIT CRITICAL] ${err.message}`);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[AUDIT] Failed to write event: ${message}`);
    }
  }
}

export function createAuditLogger(writer: AuditWriter): AuditLogger {
  return {
    async logSessionStarted(ctx: AuditContext): Promise<void> {
      const event = schema.sessionStarted(ctx);
      await safeWrite(writer, event);
    },

    async logSessionStopped(ctx: AuditContext): Promise<void> {
      const event = schema.sessionStopped(ctx);
      await safeWrite(writer, event);
    },

    async logSessionReset(ctx: AuditContext): Promise<void> {
      const event = schema.sessionReset(ctx);
      await safeWrite(writer, event);
    },

    async logCommandReceived(ctx: AuditContext, commandType: string, rawText: string): Promise<void> {
      const event = schema.commandReceived({ ...ctx, commandType, rawText });
      await safeWrite(writer, event);
    },

    async logOutputSanitized(ctx: AuditContext, redactionCount: number): Promise<void> {
      const event = schema.outputSanitized({ ...ctx, redactionCount });
      await safeWrite(writer, event);
    },

    async logOutputDelivered(ctx: AuditContext, charCount: number): Promise<void> {
      const event = schema.outputDelivered({ ...ctx, charCount });
      await safeWrite(writer, event);
    },

    async logLockAcquired(ctx: AuditContext): Promise<void> {
      const event = schema.lockAcquired(ctx);
      await safeWrite(writer, event);
    },

    async logLockReleased(ctx: AuditContext): Promise<void> {
      const event = schema.lockReleased(ctx);
      await safeWrite(writer, event);
    },

    async logLockStaleReleased(ctx: AuditContext): Promise<void> {
      const event = schema.lockStaleReleased(ctx);
      await safeWrite(writer, event);
    },

    async logLockRejected(ctx: AuditContext, reason: string, heldByUserId: number, heldByChatId: number): Promise<void> {
      const event = schema.lockRejected({ ...ctx, reason, heldByUserId, heldByChatId });
      await safeWrite(writer, event);
    },

    async logError(ctx: AuditContext, errorCode: string, errorMessage: string): Promise<void> {
      const event = schema.errorOccurred({ ...ctx, errorCode, errorMessage });
      await safeWrite(writer, event);
    },
  };
}
