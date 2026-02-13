import { describe, it, expect } from 'vitest';
import {
  sessionStarted,
  sessionStopped,
  sessionReset,
  commandReceived,
  outputSanitized,
  outputDelivered,
  lockRejected,
  errorOccurred,
} from '../../src/audit/schema.js';

const baseParams = {
  sessionId: 'sess-123',
  userId: 42,
  chatId: 100,
  claudeSessionId: 'claude-456',
};

describe('audit event factories', () => {
  it('creates session_started event', () => {
    const event = sessionStarted(baseParams);
    expect(event.event).toBe('session_started');
    expect(event.sessionId).toBe('sess-123');
    expect(event.userId).toBe(42);
    expect(event.chatId).toBe(100);
    expect(event.claudeSessionId).toBe('claude-456');
    expect(event.timestamp).toBeDefined();
    expect(event.correlationId).toBeDefined();
    expect(event.correlationId.length).toBeGreaterThan(0);
  });

  it('creates session_stopped event', () => {
    const event = sessionStopped(baseParams);
    expect(event.event).toBe('session_stopped');
  });

  it('creates session_reset event', () => {
    const event = sessionReset(baseParams);
    expect(event.event).toBe('session_reset');
  });

  it('creates command_received event with details', () => {
    const event = commandReceived({
      ...baseParams,
      commandType: 'send',
      rawText: '/send hello',
    });
    expect(event.event).toBe('command_received');
    expect(event.commandType).toBe('send');
    expect(event.rawText).toBe('/send hello');
  });

  it('creates output_sanitized event', () => {
    const event = outputSanitized({
      ...baseParams,
      redactionCount: 3,
    });
    expect(event.event).toBe('output_sanitized');
    expect(event.redactionCount).toBe(3);
  });

  it('creates output_delivered event', () => {
    const event = outputDelivered({
      ...baseParams,
      charCount: 500,
    });
    expect(event.event).toBe('output_delivered');
    expect(event.charCount).toBe(500);
  });

  it('creates lock_rejected event', () => {
    const event = lockRejected({
      sessionId: 'sess-123',
      userId: 42,
      chatId: 100,
      reason: 'Another session is active',
    });
    expect(event.event).toBe('lock_rejected');
    expect(event.reason).toBe('Another session is active');
  });

  it('creates error_occurred event', () => {
    const event = errorOccurred({
      ...baseParams,
      errorCode: 'CLAUDE_ERROR',
      errorMessage: 'Process crashed',
    });
    expect(event.event).toBe('error_occurred');
    expect(event.errorCode).toBe('CLAUDE_ERROR');
    expect(event.errorMessage).toBe('Process crashed');
  });

  it('generates unique correlation IDs', () => {
    const event1 = sessionStarted(baseParams);
    const event2 = sessionStarted(baseParams);
    expect(event1.correlationId).not.toBe(event2.correlationId);
  });

  it('generates ISO timestamp', () => {
    const event = sessionStarted(baseParams);
    // Should be a valid ISO date string
    expect(() => new Date(event.timestamp)).not.toThrow();
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
