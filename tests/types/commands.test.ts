import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../src/types/commands.js';

describe('parseCommand', () => {
  describe('valid commands', () => {
    it('parses /start_session', () => {
      const result = parseCommand('/start_session');
      expect(result).toEqual({ ok: true, value: { type: 'start_session' } });
    });

    it('parses /start as alias for start_session', () => {
      const result = parseCommand('/start');
      expect(result).toEqual({ ok: true, value: { type: 'start_session' } });
    });

    it('parses /send with prompt', () => {
      const result = parseCommand('/send hello world');
      expect(result).toEqual({
        ok: true,
        value: { type: 'send', prompt: 'hello world' },
      });
    });

    it('parses /send with multi-line prompt', () => {
      const result = parseCommand('/send line1\nline2');
      expect(result).toEqual({
        ok: true,
        value: { type: 'send', prompt: 'line1\nline2' },
      });
    });

    it('parses /status', () => {
      const result = parseCommand('/status');
      expect(result).toEqual({ ok: true, value: { type: 'status' } });
    });

    it('parses /stop', () => {
      const result = parseCommand('/stop');
      expect(result).toEqual({ ok: true, value: { type: 'stop' } });
    });

    it('parses /new_session', () => {
      const result = parseCommand('/new_session');
      expect(result).toEqual({ ok: true, value: { type: 'new_session' } });
    });

    it('handles @botname suffix', () => {
      const result = parseCommand('/start_session@my_bot');
      expect(result).toEqual({ ok: true, value: { type: 'start_session' } });
    });

    it('handles @botname suffix with args', () => {
      const result = parseCommand('/send@my_bot hello');
      expect(result).toEqual({
        ok: true,
        value: { type: 'send', prompt: 'hello' },
      });
    });

    it('trims whitespace', () => {
      const result = parseCommand('  /status  ');
      expect(result).toEqual({ ok: true, value: { type: 'status' } });
    });
  });

  describe('error cases', () => {
    it('rejects non-command text', () => {
      const result = parseCommand('hello');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('must start with /');
      }
    });

    it('rejects /send without prompt', () => {
      const result = parseCommand('/send');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('requires a prompt');
      }
    });

    it('rejects /send with empty prompt (whitespace only)', () => {
      const result = parseCommand('/send    ');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('requires a prompt');
      }
    });

    it('rejects prompt exceeding max length', () => {
      const longPrompt = 'a'.repeat(4097);
      const result = parseCommand(`/send ${longPrompt}`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('too long');
        expect(result.error).toContain('4096');
      }
    });

    it('accepts prompt at exactly max length', () => {
      const exactPrompt = 'a'.repeat(4096);
      const result = parseCommand(`/send ${exactPrompt}`);
      expect(result.ok).toBe(true);
    });

    it('rejects unknown commands', () => {
      const result = parseCommand('/unknown');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Unknown command');
        expect(result.error).toContain('/unknown');
        expect(result.error).toContain('Available commands');
      }
    });
  });
});
