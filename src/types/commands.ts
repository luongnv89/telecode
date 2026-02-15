export type BotCommand =
  | { type: 'start_session'; workingDir?: string; name?: string }
  | { type: 'send'; prompt: string }
  | { type: 'status' }
  | { type: 'stop' }
  | { type: 'new_session' }
  | { type: 'claude_command'; ccCommand: ClaudeCodeCommand }
  | { type: 'list_sessions' }
  | { type: 'switch_session'; target: string }
  | { type: 'remove_session'; target: string }
  | { type: 'discover' }
  | { type: 'attach'; target: string }
  | { type: 'cd'; path: string }
  | { type: 'goto'; target: string }
  | { type: 'back' }
  | { type: 'resume'; target?: string }
  | { type: 'bookmark'; name: string; path: string }
  | { type: 'list_bookmarks' }
  | { type: 'open_bookmark'; name: string }
  | { type: 'unbookmark'; name: string }
  | { type: 'verbose' }
  | { type: 'concise' };

export const CLAUDE_CODE_COMMANDS = ['clear', 'compact', 'context', 'resume'] as const;
export type ClaudeCodeCommand = (typeof CLAUDE_CODE_COMMANDS)[number];

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface CommandContext {
  userId: number;
  chatId: number;
  messageId: number;
  timestamp: Date;
  rawText: string;
}

export interface ValidatedCommand {
  command: BotCommand;
  context: CommandContext;
}

export const MAX_PROMPT_LENGTH = 4096;

export function parseCommand(text: string): ParseResult<BotCommand> {
  const trimmed = text.trim();

  if (!trimmed.startsWith('/')) {
    return { ok: false, error: 'Commands must start with /' };
  }

  // Extract command name and arguments, handling @botname suffix
  const spaceIndex = trimmed.indexOf(' ');
  const commandPart = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim();

  // Strip @botname from command (e.g., /start_session@mybot -> /start_session)
  const atIndex = commandPart.indexOf('@');
  const command = atIndex === -1 ? commandPart : commandPart.slice(0, atIndex);

  switch (command) {
    case '/start_session':
    case '/start': {
      // Parse optional args: /start_session [workingDir] [name]
      if (!args) {
        return { ok: true, value: { type: 'start_session' } };
      }
      const parts = args.split(/\s+/).filter(p => p.length > 0);
      return {
        ok: true,
        value: {
          type: 'start_session',
          workingDir: parts[0],
          name: parts[1],
        },
      };
    }

    case '/status':
      return { ok: true, value: { type: 'status' } };

    case '/stop':
      return { ok: true, value: { type: 'stop' } };

    case '/new_session':
      return { ok: true, value: { type: 'new_session' } };

    case '/sessions':
      return { ok: true, value: { type: 'list_sessions' } };

    case '/switch':
      if (!args) {
        return { ok: false, error: '/switch requires a session ID or name. Usage: /switch <name-or-id>' };
      }
      return { ok: true, value: { type: 'switch_session', target: args } };

    case '/remove':
      if (!args) {
        return { ok: false, error: '/remove requires a session ID or name. Usage: /remove <name-or-id>' };
      }
      return { ok: true, value: { type: 'remove_session', target: args } };

    case '/cc_clear':
      return { ok: true, value: { type: 'claude_command', ccCommand: 'clear' } };

    case '/cc_compact':
      return { ok: true, value: { type: 'claude_command', ccCommand: 'compact' } };

    case '/cc_context':
      return { ok: true, value: { type: 'claude_command', ccCommand: 'context' } };

    case '/cc_resume':
      return { ok: true, value: { type: 'claude_command', ccCommand: 'resume' } };

    case '/discover':
      return { ok: true, value: { type: 'discover' } };

    case '/attach':
      if (!args) {
        return { ok: false, error: '/attach requires a session ID or index. Usage: /attach <id-or-index>' };
      }
      return { ok: true, value: { type: 'attach', target: args } };

    case '/cd':
      if (!args) {
        return { ok: false, error: '/cd requires a path. Usage: /cd <path>' };
      }
      return { ok: true, value: { type: 'cd', path: args } };

    case '/goto':
      if (!args) {
        return { ok: false, error: '/goto requires a session name or number. Usage: /goto <name-or-num>' };
      }
      return { ok: true, value: { type: 'goto', target: args } };

    case '/back':
      return { ok: true, value: { type: 'back' } };

    case '/resume':
      if (!args) {
        return { ok: true, value: { type: 'resume' } };
      }
      return { ok: true, value: { type: 'resume', target: args } };

    case '/bookmark': {
      if (!args) {
        return { ok: false, error: '/bookmark requires a name and path. Usage: /bookmark <name> <path>' };
      }
      const parts = args.split(/\s+/).filter(p => p.length > 0);
      if (parts.length < 2) {
        return { ok: false, error: '/bookmark requires a name and path. Usage: /bookmark <name> <path>' };
      }
      return { ok: true, value: { type: 'bookmark', name: parts[0], path: parts[1] } };
    }

    case '/bookmarks':
      return { ok: true, value: { type: 'list_bookmarks' } };

    case '/open':
      if (!args) {
        return { ok: false, error: '/open requires a bookmark name. Usage: /open <name>' };
      }
      return { ok: true, value: { type: 'open_bookmark', name: args } };

    case '/unbookmark':
      if (!args) {
        return { ok: false, error: '/unbookmark requires a bookmark name. Usage: /unbookmark <name>' };
      }
      return { ok: true, value: { type: 'unbookmark', name: args } };

    case '/verbose':
      return { ok: true, value: { type: 'verbose' } };

    case '/concise':
      return { ok: true, value: { type: 'concise' } };

    default:
      return {
        ok: false,
        error: `Unknown command: ${command}. Available commands: /start_session, /status, /stop, /new_session, /sessions, /switch, /remove, /cc_clear, /cc_compact, /cc_context, /cc_resume, /discover, /attach, /cd, /goto, /back, /resume, /bookmark, /bookmarks, /open, /unbookmark, /verbose, /concise`,
      };
  }
}
