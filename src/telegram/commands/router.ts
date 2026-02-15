import type { Bot, Context } from 'grammy';
import { parseCommand, MAX_PROMPT_LENGTH } from '../../types/commands.js';
import type { CommandContext, ValidatedCommand } from '../../types/commands.js';
import { createError, type ResponseEnvelope } from '../../types/envelope.js';
import type { TelegramSender } from '../sender.js';

export type CommandHandler = (command: ValidatedCommand) => Promise<ResponseEnvelope | void>;

export interface CommandHandlers {
  start_session: CommandHandler;
  send: CommandHandler;
  status: CommandHandler;
  stop: CommandHandler;
  new_session: CommandHandler;
  claude_command: CommandHandler;
  list_sessions: CommandHandler;
  switch_session: CommandHandler;
  remove_session: CommandHandler;
  discover: CommandHandler;
  attach: CommandHandler;
  cd: CommandHandler;
  goto: CommandHandler;
  back: CommandHandler;
  resume: CommandHandler;
  bookmark: CommandHandler;
  list_bookmarks: CommandHandler;
  open_bookmark: CommandHandler;
  unbookmark: CommandHandler;
  verbose: CommandHandler;
  concise: CommandHandler;
}

function extractContext(ctx: Context): CommandContext | null {
  const msg = ctx.message;
  if (!msg || !ctx.from) return null;

  return {
    userId: ctx.from.id,
    chatId: msg.chat.id,
    messageId: msg.message_id,
    timestamp: new Date(msg.date * 1000),
    rawText: msg.text ?? '',
  };
}

export function registerCommands(
  bot: Bot,
  handlers: CommandHandlers,
  sender: TelegramSender,
): void {
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    const context = extractContext(ctx);
    if (!context) return;

    // Plain text (not a command) → send to Claude as a prompt
    if (!text.startsWith('/')) {
      if (text.length > MAX_PROMPT_LENGTH) {
        await sender.sendResponse(
          context.chatId,
          createError('COMMAND_PARSE_ERROR', `Message too long (${text.length} chars). Maximum is ${MAX_PROMPT_LENGTH} characters.`),
        );
        return;
      }

      const validated: ValidatedCommand = {
        command: { type: 'send', prompt: text },
        context,
      };
      const response = await handlers.send(validated);
      if (response) {
        await sender.sendResponse(context.chatId, response);
      }
      return;
    }

    // Slash commands
    const parsed = parseCommand(text);

    if (!parsed.ok) {
      await sender.sendResponse(
        context.chatId,
        createError('COMMAND_PARSE_ERROR', parsed.error),
      );
      return;
    }

    const validated: ValidatedCommand = {
      command: parsed.value,
      context,
    };

    const handler = handlers[parsed.value.type];
    const response = await handler(validated);

    if (response) {
      await sender.sendResponse(context.chatId, response);
    }
  });
}
