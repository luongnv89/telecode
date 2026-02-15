import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgressStreamer, type ProgressStreamerConfig } from '../../src/telegram/progress-streamer.js';
import type { TelegramSender } from '../../src/telegram/sender.js';
import type { ClaudeOutputChunk } from '../../src/claude/message-parser.js';

function createMockSender(): TelegramSender {
  return {
    sendResponse: vi.fn().mockResolvedValue(undefined),
  };
}

function makeChunk(type: ClaudeOutputChunk['type'] = 'text', content = 'hello world'): ClaudeOutputChunk {
  return { type, content };
}

describe('ProgressStreamer', () => {
  let sender: TelegramSender;

  beforeEach(() => {
    sender = createMockSender();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends progress on first chunk (throttle elapsed from start)', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 0, // immediate send
    });

    streamer.onChunk(makeChunk());
    await vi.advanceTimersByTimeAsync(0);

    expect(sender.sendResponse).toHaveBeenCalledTimes(1);
  });

  it('throttles sends within throttleMs window', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 4000,
    });

    // First chunk at creation time — not enough elapsed, no send
    streamer.onChunk(makeChunk());
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.sendResponse).toHaveBeenCalledTimes(0);

    // Advance past throttle window, then send chunk — triggers send
    vi.advanceTimersByTime(4000);
    streamer.onChunk(makeChunk());
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.sendResponse).toHaveBeenCalledTimes(1);

    // Another chunk within new throttle window — no send
    vi.advanceTimersByTime(1000);
    streamer.onChunk(makeChunk());
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.sendResponse).toHaveBeenCalledTimes(1);

    // Past throttle window again — sends
    vi.advanceTimersByTime(4000);
    streamer.onChunk(makeChunk());
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.sendResponse).toHaveBeenCalledTimes(2);
  });

  it('formats concise mode message', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 0,
    });

    streamer.onChunk(makeChunk());
    await vi.advanceTimersByTimeAsync(0);

    const call = (sender.sendResponse as any).mock.calls[0];
    const envelope = call[1];
    expect(envelope.type).toBe('progress');
    expect(envelope.text).toMatch(/Working\.\.\. \d+s \| 1 updates/);
  });

  it('includes tool indicator in concise mode for tool_use chunks', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 0,
    });

    streamer.onChunk(makeChunk('tool_use', 'Read file\nsrc/index.ts'));
    await vi.advanceTimersByTimeAsync(0);

    const call = (sender.sendResponse as any).mock.calls[0];
    expect(call[1].text).toContain('Tool: Read file');
  });

  it('formats verbose mode with preview', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'verbose',
      throttleMs: 0,
      maxPreviewChars: 20,
    });

    const longContent = 'A'.repeat(50);
    streamer.onChunk(makeChunk('text', longContent));
    await vi.advanceTimersByTimeAsync(0);

    const call = (sender.sendResponse as any).mock.calls[0];
    const text = call[1].text;
    expect(text).toMatch(/\[\d+s\] 1 updates \(50 chars\)/);
    expect(text).toContain('> ...');
    expect(text.length).toBeLessThan(100);
  });

  it('verbose mode shows full content when under maxPreviewChars', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'verbose',
      throttleMs: 0,
      maxPreviewChars: 150,
    });

    streamer.onChunk(makeChunk('text', 'Short text'));
    await vi.advanceTimersByTimeAsync(0);

    const call = (sender.sendResponse as any).mock.calls[0];
    expect(call[1].text).toContain('> Short text');
  });

  it('flush sends pending progress', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 4000,
    });

    // Chunk at creation time — within throttle window, no auto-send
    streamer.onChunk(makeChunk());
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.sendResponse).toHaveBeenCalledTimes(0);

    // Flush forces send of pending progress
    await streamer.flush();
    expect(sender.sendResponse).toHaveBeenCalledTimes(1);
  });

  it('flush does nothing when no chunks received', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 4000,
    });

    await streamer.flush();
    expect(sender.sendResponse).not.toHaveBeenCalled();
  });

  it('tracks stats correctly', () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 60000,
    });

    streamer.onChunk(makeChunk('text', 'hello'));
    streamer.onChunk(makeChunk('text', 'world!'));

    const stats = streamer.getStats();
    expect(stats.chunkCount).toBe(2);
    expect(stats.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('catches and ignores sender errors', async () => {
    (sender.sendResponse as any).mockRejectedValue(new Error('send failed'));

    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 0,
    });

    // Should not throw
    streamer.onChunk(makeChunk());
    await vi.advanceTimersByTimeAsync(0);

    // Flush also should not throw
    await streamer.flush();
  });
});
