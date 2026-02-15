import type { ClaudeOutputChunk } from '../claude/message-parser.js';
import type { TelegramSender } from './sender.js';
import type { DisplayMode } from './user-preferences.js';
import { createProgress } from '../types/envelope.js';

const TYPING_INTERVAL_MS = 4000;

export interface ProgressStreamerConfig {
  chatId: number;
  sender: TelegramSender;
  mode: DisplayMode;
  throttleMs?: number;
  maxPreviewChars?: number;
  maxTimelineItems?: number;
}

export interface ProgressStreamer {
  onChunk(chunk: ClaudeOutputChunk): void;
  flush(): Promise<void>;
  stop(): void;
  getStats(): { chunkCount: number; elapsedMs: number };
}

export function createProgressStreamer(config: ProgressStreamerConfig): ProgressStreamer {
  const throttleMs = config.throttleMs ?? 4000;
  const maxPreviewChars = config.maxPreviewChars ?? 150;
  const maxTimelineItems = config.maxTimelineItems ?? 3;

  const startTime = Date.now();
  let chunkCount = 0;
  let totalChars = 0;
  let lastSendTime = startTime;
  let lastContent = '';
  let pendingSend = false;

  const toolTimeline: string[] = [];

  // Send typing indicator immediately and repeat every 4s
  void config.sender.sendTypingIndicator(config.chatId).catch(() => {});
  const typingInterval = setInterval(() => {
    void config.sender.sendTypingIndicator(config.chatId).catch(() => {});
  }, TYPING_INTERVAL_MS);

  function addToolAction(summary: string): void {
    toolTimeline.push(summary);
    if (toolTimeline.length > maxTimelineItems) {
      toolTimeline.shift();
    }
  }

  function formatMessage(): string {
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (config.mode === 'verbose') {
      let text = `[${elapsed}s] ${chunkCount} updates (${totalChars} chars)`;

      if (toolTimeline.length > 0) {
        text += '\n\nRecent activity:';
        for (const action of toolTimeline) {
          text += `\n> ${action}`;
        }
      }

      if (lastContent) {
        const preview = lastContent.length > maxPreviewChars
          ? '...' + lastContent.slice(-maxPreviewChars)
          : lastContent;
        text += `\n\nLast output:\n> ${preview}`;
      }

      return text;
    }

    // Concise mode
    let text = `Working... ${elapsed}s | ${chunkCount} updates`;
    if (toolTimeline.length > 0) {
      for (const action of toolTimeline) {
        text += `\n> ${action}`;
      }
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

      if (chunk.type === 'tool_use') {
        addToolAction(chunk.content);
      } else {
        lastContent = chunk.content;
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

    stop(): void {
      clearInterval(typingInterval);
    },

    getStats(): { chunkCount: number; elapsedMs: number } {
      return {
        chunkCount,
        elapsedMs: Date.now() - startTime,
      };
    },
  };
}
