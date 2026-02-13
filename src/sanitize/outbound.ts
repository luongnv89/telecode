/**
 * Safe outbound sender that wraps TelegramSender with sanitization + regex masking.
 *
 * All outbound text passes through:
 *   1. SanitizationPipeline (category handlers)
 *   2. Regex fallback masking (deterministic rules)
 *
 * If either stage fails, the message is blocked and an alert is raised.
 */

import type { TelegramSender } from '../telegram/sender.js';
import type { SanitizationPipeline } from './pipeline.js';
import type { MaskingResult } from './regex-masking.js';
import type { ResponseEnvelope } from '../types/envelope.js';
import type { AuditWriter } from '../audit/writer.js';

export interface OutboundSanitizer {
  /** Sanitize text through pipeline + regex masking. Returns sanitized text. */
  sanitizeText(text: string): { text: string; redactionCount: number; maskingRuleCount: number };
}

export interface SafeSenderDeps {
  innerSender: TelegramSender;
  pipeline: SanitizationPipeline;
  regexMasker: (text: string) => MaskingResult;
  auditWriter: AuditWriter;
  /** Called when sanitization itself fails — the message is blocked. */
  onSanitizeFailure?: (chatId: number, error: Error) => void;
}

/**
 * Create a TelegramSender that sanitizes all outbound text before sending.
 * No raw text can bypass this wrapper.
 */
export function createSafeSender(deps: SafeSenderDeps): TelegramSender & OutboundSanitizer {
  const { innerSender, pipeline, regexMasker, auditWriter, onSanitizeFailure } = deps;

  function sanitizeText(text: string): { text: string; redactionCount: number; maskingRuleCount: number } {
    // Stage 1: Pipeline sanitization
    const pipelineResult = pipeline.sanitize(text);

    // Stage 2: Regex fallback masking
    const maskingResult = regexMasker(pipelineResult.text);

    return {
      text: maskingResult.text,
      redactionCount: pipelineResult.redactionCount,
      maskingRuleCount: maskingResult.totalReplacements,
    };
  }

  function sanitizeEnvelope(envelope: ResponseEnvelope): { envelope: ResponseEnvelope; totalRedactions: number } {
    switch (envelope.type) {
      case 'progress': {
        const result = sanitizeText(envelope.text);
        return { envelope: { ...envelope, text: result.text }, totalRedactions: result.redactionCount + result.maskingRuleCount };
      }
      case 'result': {
        const result = sanitizeText(envelope.text);
        return { envelope: { ...envelope, text: result.text }, totalRedactions: result.redactionCount + result.maskingRuleCount };
      }
      case 'error': {
        // Sanitize error messages too — they may contain sensitive output
        const result = sanitizeText(envelope.message);
        return { envelope: { ...envelope, message: result.text }, totalRedactions: result.redactionCount + result.maskingRuleCount };
      }
      case 'status': {
        // Status fields are internal — no user-generated content to sanitize
        return { envelope, totalRedactions: 0 };
      }
      case 'ack': {
        // Ack messages are static — no sanitization needed
        return { envelope, totalRedactions: 0 };
      }
    }
  }

  return {
    sanitizeText,

    async sendResponse(chatId: number, envelope: ResponseEnvelope): Promise<void> {
      let sanitized: ResponseEnvelope;
      let totalRedactions = 0;
      try {
        const result = sanitizeEnvelope(envelope);
        sanitized = result.envelope;
        totalRedactions = result.totalRedactions;
      } catch (err) {
        // Sanitization failure — block the send entirely
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`[sanitize] CRITICAL: Outbound sanitization failed, message blocked: ${error.message}`);

        if (onSanitizeFailure) {
          onSanitizeFailure(chatId, error);
        }

        // Try to write a sanitizer failure audit event
        try {
          await auditWriter.write({
            event: 'error_occurred',
            timestamp: new Date().toISOString(),
            sessionId: 'unknown',
            userId: 0,
            chatId,
            correlationId: 'sanitize-failure',
            errorCode: 'SANITIZE_FAILURE',
            errorMessage: error.message,
          });
        } catch {
          // If even audit writing fails, we can't do much
        }

        // Send a generic error instead of the blocked content
        await innerSender.sendResponse(chatId, {
          type: 'error',
          code: 'INTERNAL_ERROR',
          message: 'Output was blocked by the safety filter. Check server logs.',
          timestamp: new Date(),
        });
        return;
      }

      // Log redaction event if anything was sanitized
      if (totalRedactions > 0) {
        try {
          await auditWriter.write({
            event: 'output_sanitized',
            timestamp: new Date().toISOString(),
            sessionId: 'outbound',
            userId: 0,
            chatId,
            correlationId: 'outbound-sanitize',
            redactionCount: totalRedactions,
          });
        } catch {
          // Best-effort audit logging for redactions
        }
      }

      await innerSender.sendResponse(chatId, sanitized);
    },
  };
}
