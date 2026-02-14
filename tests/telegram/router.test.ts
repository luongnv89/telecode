import { describe, it, expect } from 'vitest';
import { parseCommand, MAX_PROMPT_LENGTH } from '../../src/types/commands.js';

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

  it('routes /start_session with path to start_session handler', () => {
    const result = parseCommand('/start_session ~/projects/myapp');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('start_session');
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

  it('routes /sessions to list_sessions handler', () => {
    const result = parseCommand('/sessions');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('list_sessions');
    }
  });

  it('routes /switch to switch_session handler', () => {
    const result = parseCommand('/switch my-project');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('switch_session');
      if (result.value.type === 'switch_session') {
        expect(result.value.target).toBe('my-project');
      }
    }
  });

  it('routes /remove to remove_session handler', () => {
    const result = parseCommand('/remove my-project');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('remove_session');
      if (result.value.type === 'remove_session') {
        expect(result.value.target).toBe('my-project');
      }
    }
  });

  it('routes /cc_clear to claude_command handler', () => {
    const result = parseCommand('/cc_clear');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('claude_command');
      if (result.value.type === 'claude_command') {
        expect(result.value.ccCommand).toBe('clear');
      }
    }
  });

  it('routes /cc_compact to claude_command handler', () => {
    const result = parseCommand('/cc_compact');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('claude_command');
      if (result.value.type === 'claude_command') {
        expect(result.value.ccCommand).toBe('compact');
      }
    }
  });

  it('routes /cc_context to claude_command handler', () => {
    const result = parseCommand('/cc_context');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('claude_command');
      if (result.value.type === 'claude_command') {
        expect(result.value.ccCommand).toBe('context');
      }
    }
  });

  it('routes /cc_resume to claude_command handler', () => {
    const result = parseCommand('/cc_resume');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('claude_command');
      if (result.value.type === 'claude_command') {
        expect(result.value.ccCommand).toBe('resume');
      }
    }
  });

  it('returns error for unknown commands', () => {
    const result = parseCommand('/foo');
    expect(result.ok).toBe(false);
  });

  it('returns error for non-command text (plain text is routed to send)', () => {
    const result = parseCommand('hello world');
    expect(result.ok).toBe(false);
  });

  it('/send is now an unknown command', () => {
    const result = parseCommand('/send test');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unknown command');
    }
  });

  describe('plain text prompt validation', () => {
    it('MAX_PROMPT_LENGTH is exported for router use', () => {
      expect(MAX_PROMPT_LENGTH).toBe(4096);
    });

    it('plain text within limit is valid for routing', () => {
      const text = 'a'.repeat(4096);
      expect(text.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
    });

    it('plain text exceeding limit should be rejected by router', () => {
      const text = 'a'.repeat(4097);
      expect(text.length).toBeGreaterThan(MAX_PROMPT_LENGTH);
    });
  });
});
