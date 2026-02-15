import type { Bot } from 'grammy';
import type { CommandHandlers } from './router.js';
import type { TelegramSender } from '../sender.js';
import type { ValidatedCommand } from '../../types/commands.js';

const VALID_ACTIONS = ['status', 'stop', 'new_session'] as const;
type CallbackAction = (typeof VALID_ACTIONS)[number];

function parseCallbackData(data: string): CallbackAction | null {
  if (!data.startsWith('action:')) return null;
  const action = data.slice('action:'.length);
  if (VALID_ACTIONS.includes(action as CallbackAction)) {
    return action as CallbackAction;
  }
  return null;
}

export function registerCallbacks(
  bot: Bot,
  handlers: CommandHandlers,
  sender: TelegramSender,
): void {
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const action = parseCallbackData(data);

    if (!action) {
      await ctx.answerCallbackQuery({ text: 'Unknown action' });
      return;
    }

    const userId = ctx.from.id;
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (!chatId) {
      await ctx.answerCallbackQuery({ text: 'Unable to determine chat' });
      return;
    }

    // Dismiss the loading animation immediately
    await ctx.answerCallbackQuery();

    // Create a synthetic ValidatedCommand from callback context
    const validated: ValidatedCommand = {
      command: { type: action },
      context: {
        userId,
        chatId,
        messageId: ctx.callbackQuery.message?.message_id ?? 0,
        timestamp: new Date(),
        rawText: `[button:${action}]`,
      },
    };

    const response = await handlers[action](validated);
    if (response) {
      await sender.sendResponse(chatId, response);
    }
  });
}
