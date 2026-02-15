import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSafeSender } from '../../src/sanitize/outbound.js';
import type { TelegramSender } from '../../src/telegram/sender.js';
import type { SanitizationPipeline, SanitizeResult } from '../../src/sanitize/pipeline.js';
import type { MaskingResult } from '../../src/sanitize/regex-masking.js';
import type { AuditWriter } from '../../src/audit/writer.js';
import type { ResponseEnvelope } from '../../src/types/envelope.js';

function createMockInnerSender(): TelegramSender {
  return {
    sendResponse: vi.fn().mockResolvedValue(undefined),
    sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockPipeline(transform?: (text: string) => SanitizeResult): SanitizationPipeline {
  return {
    sanitize: vi.fn((text: string): SanitizeResult => {
      if (transform) return transform(text);
      return { text, redactionCount: 0, categories: [] };
    }),
  } as unknown as SanitizationPipeline;
}

function createMockMasker(transform?: (text: string) => MaskingResult): (text: string) => MaskingResult {
  return vi.fn((text: string): MaskingResult => {
    if (transform) return transform(text);
    return { text, appliedRules: [], totalReplacements: 0 };
  });
}

function createMockAuditWriter(): AuditWriter {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('createSafeSender', () => {
  let innerSender: TelegramSender;
  let pipeline: SanitizationPipeline;
  let masker: ReturnType<typeof createMockMasker>;
  let auditWriter: AuditWriter;

  beforeEach(() => {
    innerSender = createMockInnerSender();
    pipeline = createMockPipeline();
    masker = createMockMasker();
    auditWriter = createMockAuditWriter();
  });

  describe('sanitizeText', () => {
    it('runs text through pipeline then regex masker', () => {
      const sender = createSafeSender({
        innerSender,
        pipeline: createMockPipeline((text) => ({
          text: text.replace('secret-key-abc', '[REDACTED:api_key]'),
          redactionCount: 1,
          categories: ['api_key'],
        })),
        regexMasker: createMockMasker((text) => ({
          text,
          appliedRules: [],
          totalReplacements: 0,
        })),
        auditWriter,
      });

      const result = sender.sanitizeText('my secret-key-abc is here');
      expect(result.text).toBe('my [REDACTED:api_key] is here');
      expect(result.redactionCount).toBe(1);
    });

    it('applies regex masking after pipeline', () => {
      const sender = createSafeSender({
        innerSender,
        pipeline: createMockPipeline(), // pass-through
        regexMasker: createMockMasker((text) => ({
          text: text.replace(/Bearer\s+\S+/g, '***'),
          appliedRules: ['bearer-token'],
          totalReplacements: 1,
        })),
        auditWriter,
      });

      const result = sender.sanitizeText('Authorization: Bearer eyJhbGci');
      expect(result.text).toBe('Authorization: ***');
      expect(result.maskingRuleCount).toBe(1);
    });
  });

  describe('sendResponse', () => {
    it('sanitizes result envelopes before sending', async () => {
      const sender = createSafeSender({
        innerSender,
        pipeline: createMockPipeline((text) => ({
          text: text.replace('sk-proj-abc123def456', '[REDACTED:api_key]'),
          redactionCount: 1,
          categories: ['api_key'],
        })),
        regexMasker: masker,
        auditWriter,
      });

      const envelope: ResponseEnvelope = {
        type: 'result',
        text: 'Key is sk-proj-abc123def456',
        timestamp: new Date(),
      };

      await sender.sendResponse(123, envelope);

      expect(innerSender.sendResponse).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          type: 'result',
          text: 'Key is [REDACTED:api_key]',
        }),
      );
    });

    it('sanitizes progress envelopes', async () => {
      const sender = createSafeSender({
        innerSender,
        pipeline: createMockPipeline((text) => ({
          text: text.replace('password=hunter2', 'password=[REDACTED:password]'),
          redactionCount: 1,
          categories: ['password'],
        })),
        regexMasker: masker,
        auditWriter,
      });

      const envelope: ResponseEnvelope = {
        type: 'progress',
        text: 'Found password=hunter2',
        timestamp: new Date(),
      };

      await sender.sendResponse(123, envelope);

      expect(innerSender.sendResponse).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          type: 'progress',
          text: 'Found password=[REDACTED:password]',
        }),
      );
    });

    it('sanitizes error message content', async () => {
      const sender = createSafeSender({
        innerSender,
        pipeline: createMockPipeline((text) => ({
          text: text.replace('/Users/john/.ssh/id_rsa', '[REDACTED:path]'),
          redactionCount: 1,
          categories: ['path'],
        })),
        regexMasker: masker,
        auditWriter,
      });

      const envelope: ResponseEnvelope = {
        type: 'error',
        code: 'CLAUDE_ERROR',
        message: 'Failed reading /Users/john/.ssh/id_rsa',
        timestamp: new Date(),
      };

      await sender.sendResponse(123, envelope);

      expect(innerSender.sendResponse).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          type: 'error',
          message: 'Failed reading [REDACTED:path]',
        }),
      );
    });

    it('passes ack envelopes through unchanged', async () => {
      const sender = createSafeSender({
        innerSender,
        pipeline,
        regexMasker: masker,
        auditWriter,
      });

      const envelope: ResponseEnvelope = {
        type: 'ack',
        commandType: 'start_session',
        timestamp: new Date(),
      };

      await sender.sendResponse(123, envelope);

      expect(pipeline.sanitize).not.toHaveBeenCalled();
      expect(innerSender.sendResponse).toHaveBeenCalledWith(123, envelope);
    });

    it('passes status envelopes through unchanged', async () => {
      const sender = createSafeSender({
        innerSender,
        pipeline,
        regexMasker: masker,
        auditWriter,
      });

      const envelope: ResponseEnvelope = {
        type: 'status',
        sessionActive: true,
        sessionId: 'abc',
        state: 'active',
        timestamp: new Date(),
      };

      await sender.sendResponse(123, envelope);

      expect(pipeline.sanitize).not.toHaveBeenCalled();
      expect(innerSender.sendResponse).toHaveBeenCalledWith(123, envelope);
    });

    it('logs redaction audit event when redactions occur', async () => {
      const sender = createSafeSender({
        innerSender,
        pipeline: createMockPipeline((text) => ({
          text: '[REDACTED]',
          redactionCount: 2,
          categories: ['api_key'],
        })),
        regexMasker: masker,
        auditWriter,
      });

      await sender.sendResponse(123, {
        type: 'result',
        text: 'secrets here',
        timestamp: new Date(),
      });

      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'output_sanitized',
          redactionCount: 2,
        }),
      );
    });

    it('blocks message and sends error on sanitization failure', async () => {
      const failingPipeline = {
        sanitize: vi.fn(() => { throw new Error('regex engine crashed'); }),
      } as unknown as SanitizationPipeline;

      const onFailure = vi.fn();
      const sender = createSafeSender({
        innerSender,
        pipeline: failingPipeline,
        regexMasker: masker,
        auditWriter,
        onSanitizeFailure: onFailure,
      });

      await sender.sendResponse(123, {
        type: 'result',
        text: 'some output',
        timestamp: new Date(),
      });

      // Should have called the failure callback
      expect(onFailure).toHaveBeenCalledWith(123, expect.any(Error));

      // Should have sent a generic error instead of the original message
      expect(innerSender.sendResponse).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          type: 'error',
          code: 'INTERNAL_ERROR',
          message: expect.stringContaining('safety filter'),
        }),
      );
    });

    it('writes audit event on sanitization failure', async () => {
      const failingPipeline = {
        sanitize: vi.fn(() => { throw new Error('boom'); }),
      } as unknown as SanitizationPipeline;

      const sender = createSafeSender({
        innerSender,
        pipeline: failingPipeline,
        regexMasker: masker,
        auditWriter,
      });

      await sender.sendResponse(123, {
        type: 'result',
        text: 'output',
        timestamp: new Date(),
      });

      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'error_occurred',
          errorCode: 'SANITIZE_FAILURE',
        }),
      );
    });
  });
});
