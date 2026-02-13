import type { Bot } from 'grammy';
import type { ResponseEnvelope } from '../types/index.js';

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
      return envelope.text;

    case 'result':
      return envelope.text;

    case 'error':
      return `Error [${envelope.code}]: ${envelope.message}`;

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
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await bot.api.sendMessage(chatId, text);
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
      await sendWithRetry(bot, chatId, text);
    },
  };
}

export { formatEnvelope, truncateMessage };
