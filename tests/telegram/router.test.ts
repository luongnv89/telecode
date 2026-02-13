import { describe, it, expect, vi } from 'vitest';
import { parseCommand } from '../../src/types/commands.js';

// Router tests focus on the parseCommand integration with routing logic.
// Full integration tests with grammY context are deferred to e2e tests.

describe('command routing', () => {
  it('routes /start_session to start_session handler', () => {
    const result = parseCommand('/start_session');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('start_session');
    }
  });

  it('routes /send to send handler', () => {
    const result = parseCommand('/send test prompt');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('send');
    }
  });

  it('routes /status to status handler', () => {
    const result = parseCommand('/status');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('status');
    }
  });

  it('routes /stop to stop handler', () => {
    const result = parseCommand('/stop');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('stop');
    }
  });

  it('routes /new_session to new_session handler', () => {
    const result = parseCommand('/new_session');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('new_session');
    }
  });

  it('returns error for unknown commands', () => {
    const result = parseCommand('/foo');
    expect(result.ok).toBe(false);
  });

  it('returns error for non-command text', () => {
    const result = parseCommand('hello world');
    expect(result.ok).toBe(false);
  });
});
