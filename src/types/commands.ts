export type BotCommand =
  | { type: 'start_session' }
  | { type: 'send'; prompt: string }
  | { type: 'status' }
  | { type: 'stop' }
  | { type: 'new_session' };

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

const MAX_PROMPT_LENGTH = 4096;

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
    case '/start':
      return { ok: true, value: { type: 'start_session' } };

    case '/send':
      if (!args) {
        return { ok: false, error: '/send requires a prompt. Usage: /send <your prompt>' };
      }
      if (args.length > MAX_PROMPT_LENGTH) {
        return {
          ok: false,
          error: `Prompt too long (${args.length} chars). Maximum is ${MAX_PROMPT_LENGTH} characters.`,
        };
      }
      return { ok: true, value: { type: 'send', prompt: args } };

    case '/status':
      return { ok: true, value: { type: 'status' } };

    case '/stop':
      return { ok: true, value: { type: 'stop' } };

    case '/new_session':
      return { ok: true, value: { type: 'new_session' } };

    default:
      return {
        ok: false,
        error: `Unknown command: ${command}. Available commands: /start_session, /send, /status, /stop, /new_session`,
      };
  }
}
