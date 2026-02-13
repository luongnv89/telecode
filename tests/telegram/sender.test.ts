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

  it('formats progress envelope', () => {
    const envelope: ResponseEnvelope = {
      type: 'progress',
      text: 'Processing...',
      timestamp: new Date(),
    };
    expect(formatEnvelope(envelope)).toBe('Processing...');
  });

  it('formats result envelope', () => {
    const envelope: ResponseEnvelope = {
      type: 'result',
      text: 'Done!',
      timestamp: new Date(),
    };
    expect(formatEnvelope(envelope)).toBe('Done!');
  });

  it('formats error envelope', () => {
    const envelope: ResponseEnvelope = {
      type: 'error',
      code: 'CLAUDE_ERROR',
      message: 'Something broke',
      timestamp: new Date(),
    };
    const text = formatEnvelope(envelope);
    expect(text).toContain('CLAUDE_ERROR');
    expect(text).toContain('Something broke');
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
