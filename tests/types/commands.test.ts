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

    it('parses /start_session with working directory', () => {
      const result = parseCommand('/start_session ~/projects/myapp');
      expect(result).toEqual({
        ok: true,
        value: { type: 'start_session', workingDir: '~/projects/myapp', name: undefined },
      });
    });

    it('parses /start_session with working directory and name', () => {
      const result = parseCommand('/start_session ~/projects/myapp api-server');
      expect(result).toEqual({
        ok: true,
        value: { type: 'start_session', workingDir: '~/projects/myapp', name: 'api-server' },
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

    it('parses /sessions', () => {
      const result = parseCommand('/sessions');
      expect(result).toEqual({ ok: true, value: { type: 'list_sessions' } });
    });

    it('parses /switch with target name', () => {
      const result = parseCommand('/switch my-project');
      expect(result).toEqual({
        ok: true,
        value: { type: 'switch_session', target: 'my-project' },
      });
    });

    it('parses /switch with target ID', () => {
      const result = parseCommand('/switch abc123');
      expect(result).toEqual({
        ok: true,
        value: { type: 'switch_session', target: 'abc123' },
      });
    });

    it('parses /remove with target', () => {
      const result = parseCommand('/remove my-project');
      expect(result).toEqual({
        ok: true,
        value: { type: 'remove_session', target: 'my-project' },
      });
    });

    it('parses /cc_clear', () => {
      const result = parseCommand('/cc_clear');
      expect(result).toEqual({ ok: true, value: { type: 'claude_command', ccCommand: 'clear' } });
    });

    it('parses /cc_compact', () => {
      const result = parseCommand('/cc_compact');
      expect(result).toEqual({ ok: true, value: { type: 'claude_command', ccCommand: 'compact' } });
    });

    it('parses /cc_context', () => {
      const result = parseCommand('/cc_context');
      expect(result).toEqual({ ok: true, value: { type: 'claude_command', ccCommand: 'context' } });
    });

    it('parses /cc_resume', () => {
      const result = parseCommand('/cc_resume');
      expect(result).toEqual({ ok: true, value: { type: 'claude_command', ccCommand: 'resume' } });
    });

    it('handles @botname suffix', () => {
      const result = parseCommand('/start_session@my_bot');
      expect(result).toEqual({ ok: true, value: { type: 'start_session' } });
    });

    it('handles @botname suffix on cc commands', () => {
      const result = parseCommand('/cc_compact@my_bot');
      expect(result).toEqual({ ok: true, value: { type: 'claude_command', ccCommand: 'compact' } });
    });

    it('trims whitespace', () => {
      const result = parseCommand('  /status  ');
      expect(result).toEqual({ ok: true, value: { type: 'status' } });
    });

    // New session management commands
    it('parses /discover', () => {
      const result = parseCommand('/discover');
      expect(result).toEqual({ ok: true, value: { type: 'discover' } });
    });

    it('parses /attach with target', () => {
      const result = parseCommand('/attach 1');
      expect(result).toEqual({ ok: true, value: { type: 'attach', target: '1' } });
    });

    it('parses /attach with session ID', () => {
      const result = parseCommand('/attach abc12345');
      expect(result).toEqual({ ok: true, value: { type: 'attach', target: 'abc12345' } });
    });

    it('parses /cd with path', () => {
      const result = parseCommand('/cd ~/projects/myapp');
      expect(result).toEqual({ ok: true, value: { type: 'cd', path: '~/projects/myapp' } });
    });

    it('parses /goto with name', () => {
      const result = parseCommand('/goto api');
      expect(result).toEqual({ ok: true, value: { type: 'goto', target: 'api' } });
    });

    it('parses /goto with number', () => {
      const result = parseCommand('/goto 2');
      expect(result).toEqual({ ok: true, value: { type: 'goto', target: '2' } });
    });

    it('parses /back', () => {
      const result = parseCommand('/back');
      expect(result).toEqual({ ok: true, value: { type: 'back' } });
    });

    it('parses /resume without target', () => {
      const result = parseCommand('/resume');
      expect(result).toEqual({ ok: true, value: { type: 'resume' } });
    });

    it('parses /resume with target', () => {
      const result = parseCommand('/resume api');
      expect(result).toEqual({ ok: true, value: { type: 'resume', target: 'api' } });
    });

    it('parses /bookmark with name and path', () => {
      const result = parseCommand('/bookmark api ~/projects/api');
      expect(result).toEqual({
        ok: true,
        value: { type: 'bookmark', name: 'api', path: '~/projects/api' },
      });
    });

    it('parses /bookmarks', () => {
      const result = parseCommand('/bookmarks');
      expect(result).toEqual({ ok: true, value: { type: 'list_bookmarks' } });
    });

    it('parses /open with name', () => {
      const result = parseCommand('/open api');
      expect(result).toEqual({ ok: true, value: { type: 'open_bookmark', name: 'api' } });
    });

    it('parses /unbookmark with name', () => {
      const result = parseCommand('/unbookmark api');
      expect(result).toEqual({ ok: true, value: { type: 'unbookmark', name: 'api' } });
    });

    it('parses /verbose', () => {
      const result = parseCommand('/verbose');
      expect(result).toEqual({ ok: true, value: { type: 'verbose' } });
    });

    it('parses /concise', () => {
      const result = parseCommand('/concise');
      expect(result).toEqual({ ok: true, value: { type: 'concise' } });
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

    it('rejects /send as unknown command (plain text is used instead)', () => {
      const result = parseCommand('/send hello');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Unknown command');
      }
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

    it('does not list /send in available commands', () => {
      const result = parseCommand('/unknown');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).not.toContain('/send');
      }
    });

    it('lists cc commands in available commands', () => {
      const result = parseCommand('/unknown');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('/cc_clear');
        expect(result.error).toContain('/cc_compact');
        expect(result.error).toContain('/cc_context');
        expect(result.error).toContain('/cc_resume');
      }
    });

    it('lists new session management commands in available commands', () => {
      const result = parseCommand('/unknown');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('/sessions');
        expect(result.error).toContain('/switch');
        expect(result.error).toContain('/remove');
      }
    });

    it('rejects /switch without target', () => {
      const result = parseCommand('/switch');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('requires a session ID or name');
      }
    });

    it('rejects /remove without target', () => {
      const result = parseCommand('/remove');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('requires a session ID or name');
      }
    });

    it('rejects /attach without target', () => {
      const result = parseCommand('/attach');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('requires a session ID or index');
      }
    });

    it('rejects /cd without path', () => {
      const result = parseCommand('/cd');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('requires a path');
      }
    });

    it('rejects /goto without target', () => {
      const result = parseCommand('/goto');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('requires a session name or number');
      }
    });

    it('rejects /bookmark without arguments', () => {
      const result = parseCommand('/bookmark');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('requires a name and path');
      }
    });

    it('rejects /bookmark with only name', () => {
      const result = parseCommand('/bookmark api');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('requires a name and path');
      }
    });

    it('rejects /open without name', () => {
      const result = parseCommand('/open');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('requires a bookmark name');
      }
    });

    it('rejects /unbookmark without name', () => {
      const result = parseCommand('/unbookmark');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('requires a bookmark name');
      }
    });

    it('lists new commands in available commands on unknown', () => {
      const result = parseCommand('/unknown');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('/discover');
        expect(result.error).toContain('/attach');
        expect(result.error).toContain('/cd');
        expect(result.error).toContain('/goto');
        expect(result.error).toContain('/back');
        expect(result.error).toContain('/resume');
        expect(result.error).toContain('/bookmark');
        expect(result.error).toContain('/bookmarks');
        expect(result.error).toContain('/open');
        expect(result.error).toContain('/unbookmark');
        expect(result.error).toContain('/verbose');
        expect(result.error).toContain('/concise');
      }
    });
  });
});
