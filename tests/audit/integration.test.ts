import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuditLogger } from '../../src/audit/integration.js';
import type { AuditContext } from '../../src/audit/integration.js';
import type { AuditWriter } from '../../src/audit/writer.js';
import type { AuditEvent } from '../../src/types/audit.js';
import { TelecodeError } from '../../src/types/errors.js';
import { createAuditWriter } from '../../src/audit/writer.js';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ctx: AuditContext = {
  sessionId: 'sess-abc',
  userId: 42,
  chatId: 100,
  claudeSessionId: 'claude-xyz',
};

function createMockWriter(): AuditWriter & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async open() {},
    async write(event: AuditEvent) {
      events.push(event);
    },
    async close() {},
  };
}

describe('AuditLogger', () => {
  describe('event creation', () => {
    it('logSessionStarted creates session_started event', async () => {
      const writer = createMockWriter();
      const logger = createAuditLogger(writer);

      await logger.logSessionStarted(ctx);

      expect(writer.events).toHaveLength(1);
      expect(writer.events[0].event).toBe('session_started');
      expect(writer.events[0].sessionId).toBe('sess-abc');
      expect(writer.events[0].userId).toBe(42);
      expect(writer.events[0].chatId).toBe(100);
      expect(writer.events[0].claudeSessionId).toBe('claude-xyz');
    });

    it('logSessionStopped creates session_stopped event', async () => {
      const writer = createMockWriter();
      const logger = createAuditLogger(writer);

      await logger.logSessionStopped(ctx);

      expect(writer.events).toHaveLength(1);
      expect(writer.events[0].event).toBe('session_stopped');
    });

    it('logSessionReset creates session_reset event', async () => {
      const writer = createMockWriter();
      const logger = createAuditLogger(writer);

      await logger.logSessionReset(ctx);

      expect(writer.events).toHaveLength(1);
      expect(writer.events[0].event).toBe('session_reset');
    });

    it('logCommandReceived creates command_received event with details', async () => {
      const writer = createMockWriter();
      const logger = createAuditLogger(writer);

      await logger.logCommandReceived(ctx, 'send', '/send hello world');

      expect(writer.events).toHaveLength(1);
      const event = writer.events[0];
      expect(event.event).toBe('command_received');
      if (event.event === 'command_received') {
        expect(event.commandType).toBe('send');
        expect(event.rawText).toBe('/send hello world');
      }
    });

    it('logOutputSanitized creates output_sanitized event', async () => {
      const writer = createMockWriter();
      const logger = createAuditLogger(writer);

      await logger.logOutputSanitized(ctx, 5);

      expect(writer.events).toHaveLength(1);
      const event = writer.events[0];
      expect(event.event).toBe('output_sanitized');
      if (event.event === 'output_sanitized') {
        expect(event.redactionCount).toBe(5);
      }
    });

    it('logOutputDelivered creates output_delivered event', async () => {
      const writer = createMockWriter();
      const logger = createAuditLogger(writer);

      await logger.logOutputDelivered(ctx, 1024);

      expect(writer.events).toHaveLength(1);
      const event = writer.events[0];
      expect(event.event).toBe('output_delivered');
      if (event.event === 'output_delivered') {
        expect(event.charCount).toBe(1024);
      }
    });

    it('logLockRejected creates lock_rejected event', async () => {
      const writer = createMockWriter();
      const logger = createAuditLogger(writer);

      await logger.logLockRejected(ctx, 'Another session is active');

      expect(writer.events).toHaveLength(1);
      const event = writer.events[0];
      expect(event.event).toBe('lock_rejected');
      if (event.event === 'lock_rejected') {
        expect(event.reason).toBe('Another session is active');
      }
    });

    it('logError creates error_occurred event', async () => {
      const writer = createMockWriter();
      const logger = createAuditLogger(writer);

      await logger.logError(ctx, 'CLAUDE_ERROR', 'Process crashed');

      expect(writer.events).toHaveLength(1);
      const event = writer.events[0];
      expect(event.event).toBe('error_occurred');
      if (event.event === 'error_occurred') {
        expect(event.errorCode).toBe('CLAUDE_ERROR');
        expect(event.errorMessage).toBe('Process crashed');
      }
    });

    it('passes context fields correctly including optional claudeSessionId', async () => {
      const writer = createMockWriter();
      const logger = createAuditLogger(writer);

      const ctxWithoutClaude: AuditContext = {
        sessionId: 'sess-no-claude',
        userId: 7,
        chatId: 200,
      };

      await logger.logSessionStarted(ctxWithoutClaude);

      expect(writer.events[0].sessionId).toBe('sess-no-claude');
      expect(writer.events[0].userId).toBe(7);
      expect(writer.events[0].chatId).toBe(200);
      expect(writer.events[0].claudeSessionId).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('catches non-critical write failures and logs to console.error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const writer: AuditWriter = {
        async open() {},
        async write() {
          throw new Error('Disk full');
        },
        async close() {},
      };

      const logger = createAuditLogger(writer);

      // Should NOT throw
      await logger.logSessionStarted(ctx);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Disk full'),
      );
      // Non-critical errors use [AUDIT] prefix, not [AUDIT CRITICAL]
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT]'),
      );
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT CRITICAL]'),
      );

      consoleErrorSpy.mockRestore();
    });

    it('logs critical AUDIT_WRITE_ERROR with [AUDIT CRITICAL] prefix', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const writer: AuditWriter = {
        async open() {},
        async write() {
          throw new TelecodeError(
            'Audit writer not opened. Call open() first.',
            'AUDIT_WRITE_ERROR',
          );
        },
        async close() {},
      };

      const logger = createAuditLogger(writer);

      // Should NOT throw even for critical errors
      await logger.logSessionStarted(ctx);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT CRITICAL]'),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Audit writer not opened'),
      );

      consoleErrorSpy.mockRestore();
    });

    it('handles non-Error thrown values gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const writer: AuditWriter = {
        async open() {},
        async write() {
          throw 'string error'; // eslint-disable-line no-throw-literal
        },
        async close() {},
      };

      const logger = createAuditLogger(writer);

      await logger.logSessionStarted(ctx);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('string error'),
      );

      consoleErrorSpy.mockRestore();
    });

    it('is safe to call when writer has not been opened', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Create a real writer but do NOT call open()
      const writer = createAuditWriter('/tmp/telecode-test-nonexistent');
      const logger = createAuditLogger(writer);

      // Should not throw — the logger swallows the error
      await logger.logSessionStarted(ctx);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT CRITICAL]'),
      );

      consoleErrorSpy.mockRestore();
    });

    it('does not break when multiple methods fail in sequence', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const writer: AuditWriter = {
        async open() {},
        async write() {
          throw new Error('write failed');
        },
        async close() {},
      };

      const logger = createAuditLogger(writer);

      await logger.logSessionStarted(ctx);
      await logger.logCommandReceived(ctx, 'send', '/send test');
      await logger.logError(ctx, 'INTERNAL_ERROR', 'Something broke');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(3);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('full flow with real writer', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'telecode-integration-'));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('logs events to JSONL file end-to-end', async () => {
      const writer = createAuditWriter(tempDir);
      await writer.open('sess-integration', new Date('2026-02-13T10:00:00'));

      const logger = createAuditLogger(writer);

      await logger.logSessionStarted({
        sessionId: 'sess-integration',
        userId: 1,
        chatId: 10,
        claudeSessionId: 'claude-1',
      });

      await logger.logCommandReceived(
        { sessionId: 'sess-integration', userId: 1, chatId: 10, claudeSessionId: 'claude-1' },
        'send',
        '/send hello',
      );

      await logger.logOutputSanitized(
        { sessionId: 'sess-integration', userId: 1, chatId: 10 },
        2,
      );

      await logger.logOutputDelivered(
        { sessionId: 'sess-integration', userId: 1, chatId: 10 },
        256,
      );

      await logger.logError(
        { sessionId: 'sess-integration', userId: 1, chatId: 10 },
        'CLAUDE_TIMEOUT',
        'Timeout after 30s',
      );

      await logger.logSessionStopped({
        sessionId: 'sess-integration',
        userId: 1,
        chatId: 10,
      });

      await writer.close();

      // Read the file and parse each line
      const files = await import('node:fs/promises').then((fs) =>
        fs.readdir(tempDir),
      );
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^session-.*\.jsonl$/);

      const content = await readFile(join(tempDir, files[0]), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(6);

      const events = lines.map((line) => JSON.parse(line));

      expect(events[0].event).toBe('session_started');
      expect(events[0].sessionId).toBe('sess-integration');
      expect(events[0].claudeSessionId).toBe('claude-1');

      expect(events[1].event).toBe('command_received');
      expect(events[1].commandType).toBe('send');
      expect(events[1].rawText).toBe('/send hello');

      expect(events[2].event).toBe('output_sanitized');
      expect(events[2].redactionCount).toBe(2);

      expect(events[3].event).toBe('output_delivered');
      expect(events[3].charCount).toBe(256);

      expect(events[4].event).toBe('error_occurred');
      expect(events[4].errorCode).toBe('CLAUDE_TIMEOUT');
      expect(events[4].errorMessage).toBe('Timeout after 30s');

      expect(events[5].event).toBe('session_stopped');

      // All events should have required base fields
      for (const event of events) {
        expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(event.correlationId).toBeDefined();
        expect(typeof event.correlationId).toBe('string');
        expect(event.sessionId).toBe('sess-integration');
        expect(event.userId).toBe(1);
        expect(event.chatId).toBe(10);
      }
    });

    it('logs lock_rejected and session_reset in the JSONL file', async () => {
      const writer = createAuditWriter(tempDir);
      await writer.open('sess-lock', new Date('2026-02-13T12:00:00'));

      const logger = createAuditLogger(writer);

      await logger.logLockRejected(
        { sessionId: 'sess-lock', userId: 99, chatId: 55 },
        'Session already active for this chat',
      );

      await logger.logSessionReset({
        sessionId: 'sess-lock',
        userId: 99,
        chatId: 55,
      });

      await writer.close();

      const files = await import('node:fs/promises').then((fs) =>
        fs.readdir(tempDir),
      );
      const content = await readFile(join(tempDir, files[0]), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);

      const events = lines.map((line) => JSON.parse(line));
      expect(events[0].event).toBe('lock_rejected');
      expect(events[0].reason).toBe('Session already active for this chat');
      expect(events[1].event).toBe('session_reset');
    });

    it('continues logging after a transient write failure', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      let callCount = 0;
      const writer: AuditWriter = {
        async open() {},
        async write(event: AuditEvent) {
          callCount++;
          if (callCount === 2) {
            throw new Error('Transient I/O error');
          }
          // otherwise succeed silently (events are discarded in this mock)
        },
        async close() {},
      };

      const logger = createAuditLogger(writer);

      await logger.logSessionStarted(ctx);  // call 1 - succeeds
      await logger.logCommandReceived(ctx, 'send', '/send hi'); // call 2 - fails
      await logger.logOutputDelivered(ctx, 100); // call 3 - succeeds

      expect(callCount).toBe(3);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Transient I/O error'),
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
