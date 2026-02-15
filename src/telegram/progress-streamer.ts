import type { ClaudeOutputChunk } from '../claude/message-parser.js';
import type { TelegramSender } from './sender.js';
import type { DisplayMode } from './user-preferences.js';
import { createProgress } from '../types/envelope.js';

export interface ProgressStreamerConfig {
  chatId: number;
  sender: TelegramSender;
  mode: DisplayMode;
  throttleMs?: number;
  maxPreviewChars?: number;
}

export interface ProgressStreamer {
  onChunk(chunk: ClaudeOutputChunk): void;
  flush(): Promise<void>;
  getStats(): { chunkCount: number; elapsedMs: number };
}

export function createProgressStreamer(config: ProgressStreamerConfig): ProgressStreamer {
  const throttleMs = config.throttleMs ?? 4000;
  const maxPreviewChars = config.maxPreviewChars ?? 150;

  const startTime = Date.now();
  let chunkCount = 0;
  let totalChars = 0;
  let lastSendTime = startTime;
  let lastToolName: string | undefined;
  let lastContent = '';
  let pendingSend = false;

  function formatMessage(): string {
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (config.mode === 'verbose') {
      const preview = lastContent.length > maxPreviewChars
        ? '...' + lastContent.slice(-maxPreviewChars)
        : lastContent;
      return `[${elapsed}s] ${chunkCount} updates (${totalChars} chars)\n> ${preview}`;
    }

    // Concise mode
    let text = `Working... ${elapsed}s | ${chunkCount} updates`;
    if (lastToolName) {
      text += ` | Tool: ${lastToolName}`;
    }
    return text;
  }

  async function sendProgress(): Promise<void> {
    try {
      const text = formatMessage();
      await config.sender.sendResponse(config.chatId, createProgress(text));
      lastSendTime = Date.now();
      pendingSend = false;
    } catch {
      // Errors from sender are caught and never propagated
    }
  }

  return {
    onChunk(chunk: ClaudeOutputChunk): void {
      chunkCount++;
      totalChars += chunk.content.length;
      lastContent = chunk.content;

      if (chunk.type === 'tool_use') {
        lastToolName = chunk.content.split('\n')[0].slice(0, 50);
      }

      const now = Date.now();
      if (now - lastSendTime >= throttleMs) {
        pendingSend = true;
        void sendProgress();
      } else {
        pendingSend = true;
      }
    },

    async flush(): Promise<void> {
      if (pendingSend && chunkCount > 0) {
        await sendProgress();
      }
    },

    getStats(): { chunkCount: number; elapsedMs: number } {
      return {
        chunkCount,
        elapsedMs: Date.now() - startTime,
      };
    },
  };
}
