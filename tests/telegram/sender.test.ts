import { describe, it, expect } from 'vitest';
import { formatEnvelope, truncateMessage } from '../../src/telegram/sender.js';
import type { ResponseEnvelope } from '../../src/types/envelope.js';

describe('formatEnvelope', () => {
  it('formats ack envelope', () => {
    const envelope: ResponseEnvelope = {
      type: 'ack',
      commandType: 'start_session',
      timestamp: new Date(),
    };
    const text = formatEnvelope(envelope);
    expect(text).toContain('start_session');
    expect(text).toContain('Command received');
  });

  it('formats progress envelope with emoji prefix', () => {
    const envelope: ResponseEnvelope = {
      type: 'progress',
      text: 'Processing...',
      timestamp: new Date(),
    };
    const text = formatEnvelope(envelope);
    expect(text).toBe('⏳ Processing...');
  });

  it('formats result envelope without metadata', () => {
    const envelope: ResponseEnvelope = {
      type: 'result',
      text: 'Done!',
      timestamp: new Date(),
    };
    expect(formatEnvelope(envelope)).toBe('Done!');
  });

  it('formats result envelope with duration and cost metadata', () => {
    const envelope: ResponseEnvelope = {
      type: 'result',
      text: 'Some output',
      timestamp: new Date(),
      metadata: { durationMs: 2300, costUsd: 0.012 },
    };
    const text = formatEnvelope(envelope);
    expect(text).toContain('✅ Result (2.3s, $0.012)');
    expect(text).toContain('Some output');
  });

  it('formats result with only duration', () => {
    const envelope: ResponseEnvelope = {
      type: 'result',
      text: 'Output',
      timestamp: new Date(),
      metadata: { durationMs: 1500 },
    };
    const text = formatEnvelope(envelope);
    expect(text).toContain('✅ Result (1.5s)');
    expect(text).toContain('Output');
  });

  it('formats result with only cost', () => {
    const envelope: ResponseEnvelope = {
      type: 'result',
      text: 'Output',
      timestamp: new Date(),
      metadata: { costUsd: 0.005 },
    };
    const text = formatEnvelope(envelope);
    expect(text).toContain('✅ Result ($0.005)');
  });

  it('formats error envelope with emoji prefix', () => {
    const envelope: ResponseEnvelope = {
      type: 'error',
      code: 'CLAUDE_ERROR',
      message: 'Something broke',
      timestamp: new Date(),
    };
    const text = formatEnvelope(envelope);
    expect(text).toBe('❌ CLAUDE_ERROR: Something broke');
  });

  it('formats status envelope - active session', () => {
    const envelope: ResponseEnvelope = {
      type: 'status',
      sessionActive: true,
      sessionId: 'abc-123',
      state: 'active',
      uptime: 125000,
      timestamp: new Date(),
    };
    const text = formatEnvelope(envelope);
    expect(text).toContain('yes');
    expect(text).toContain('abc-123');
    expect(text).toContain('active');
    expect(text).toContain('2m 5s');
  });

  it('formats status envelope - no session', () => {
    const envelope: ResponseEnvelope = {
      type: 'status',
      sessionActive: false,
      timestamp: new Date(),
    };
    const text = formatEnvelope(envelope);
    expect(text).toContain('no');
  });
});

describe('truncateMessage', () => {
  it('returns short messages unchanged', () => {
    expect(truncateMessage('hello')).toBe('hello');
  });

  it('truncates messages exceeding 4096 chars', () => {
    const long = 'a'.repeat(5000);
    const result = truncateMessage(long);
    expect(result.length).toBeLessThanOrEqual(4096);
    expect(result).toContain('... (truncated)');
  });

  it('does not truncate message at exactly 4096 chars', () => {
    const exact = 'a'.repeat(4096);
    expect(truncateMessage(exact)).toBe(exact);
  });
});
