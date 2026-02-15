import type { Bot } from 'grammy';
import type { InlineKeyboard } from 'grammy';
import type { ResponseEnvelope } from '../types/index.js';
import { getKeyboardForEnvelope } from './keyboards.js';

const MAX_MESSAGE_LENGTH = 4096;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export interface TelegramSender {
  sendResponse(chatId: number, envelope: ResponseEnvelope): Promise<void>;
}

function formatEnvelope(envelope: ResponseEnvelope): string {
  switch (envelope.type) {
    case 'ack':
      return `✓ Command received: /${envelope.commandType}`;

    case 'progress':
      return `⏳ ${envelope.text}`;

    case 'result': {
      const meta = envelope.metadata;
      if (meta?.durationMs !== undefined || meta?.costUsd !== undefined) {
        const parts: string[] = [];
        if (meta.durationMs !== undefined) {
          parts.push(`${(meta.durationMs / 1000).toFixed(1)}s`);
        }
        if (meta.costUsd !== undefined) {
          parts.push(`$${meta.costUsd.toFixed(3)}`);
        }
        return `✅ Result (${parts.join(', ')}):\n\n${envelope.text}`;
      }
      return envelope.text;
    }

    case 'error':
      return `❌ ${envelope.code}: ${envelope.message}`;

    case 'status': {
      const lines = [
        `Session active: ${envelope.sessionActive ? 'yes' : 'no'}`,
      ];
      if (envelope.sessionId) lines.push(`Session ID: ${envelope.sessionId}`);
      if (envelope.state) lines.push(`State: ${envelope.state}`);
      if (envelope.uptime !== undefined) {
        const seconds = Math.floor(envelope.uptime / 1000);
        const minutes = Math.floor(seconds / 60);
        lines.push(`Uptime: ${minutes}m ${seconds % 60}s`);
      }
      return lines.join('\n');
    }
  }
}

function truncateMessage(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  const truncationNotice = '\n\n... (truncated)';
  return text.slice(0, MAX_MESSAGE_LENGTH - truncationNotice.length) + truncationNotice;
}

async function sendWithRetry(
  bot: Bot,
  chatId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  let lastError: unknown;
  const options = keyboard ? { reply_markup: keyboard } : undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await bot.api.sendMessage(chatId, text, options);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export function createTelegramSender(bot: Bot): TelegramSender {
  return {
    async sendResponse(chatId: number, envelope: ResponseEnvelope): Promise<void> {
      const text = truncateMessage(formatEnvelope(envelope));
      const keyboard = getKeyboardForEnvelope(envelope);
      await sendWithRetry(bot, chatId, text, keyboard);
    },
  };
}

export { formatEnvelope, truncateMessage };
