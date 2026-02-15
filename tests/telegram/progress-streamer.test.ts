import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgressStreamer, type ProgressStreamerConfig } from '../../src/telegram/progress-streamer.js';
import type { TelegramSender } from '../../src/telegram/sender.js';
import type { ClaudeOutputChunk } from '../../src/claude/message-parser.js';

function createMockSender(): TelegramSender {
  return {
    sendResponse: vi.fn().mockResolvedValue(undefined),
    sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
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

  it('sends typing indicator immediately on creation', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 4000,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(sender.sendTypingIndicator).toHaveBeenCalledWith(123);
    expect(sender.sendTypingIndicator).toHaveBeenCalledTimes(1);
    streamer.stop();
  });

  it('repeats typing indicator every 4 seconds', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 60000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.sendTypingIndicator).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4000);
    expect(sender.sendTypingIndicator).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4000);
    expect(sender.sendTypingIndicator).toHaveBeenCalledTimes(3);

    streamer.stop();
  });

  it('stop() clears the typing interval', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 60000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.sendTypingIndicator).toHaveBeenCalledTimes(1);

    streamer.stop();

    await vi.advanceTimersByTimeAsync(8000);
    // No additional calls after stop
    expect(sender.sendTypingIndicator).toHaveBeenCalledTimes(1);
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
    streamer.stop();
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

    streamer.stop();
  });

  it('formats concise mode message with updates count', async () => {
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
    streamer.stop();
  });

  it('shows tool timeline in concise mode for tool_use chunks', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 0,
    });

    streamer.onChunk(makeChunk('tool_use', 'Read: src/index.ts'));
    await vi.advanceTimersByTimeAsync(0);

    const call = (sender.sendResponse as any).mock.calls[0];
    expect(call[1].text).toContain('> Read: src/index.ts');
    streamer.stop();
  });

  it('shows multiple tool actions in concise timeline', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 0,
    });

    streamer.onChunk(makeChunk('tool_use', 'Read: src/index.ts'));
    await vi.advanceTimersByTimeAsync(0);

    streamer.onChunk(makeChunk('tool_use', 'Bash: npm test'));
    await vi.advanceTimersByTimeAsync(0);

    streamer.onChunk(makeChunk('tool_use', 'Edit: src/config.ts'));
    await vi.advanceTimersByTimeAsync(0);

    const lastCall = (sender.sendResponse as any).mock.calls[2];
    const text = lastCall[1].text;
    expect(text).toContain('> Read: src/index.ts');
    expect(text).toContain('> Bash: npm test');
    expect(text).toContain('> Edit: src/config.ts');
    streamer.stop();
  });

  it('limits timeline to maxTimelineItems', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 0,
      maxTimelineItems: 2,
    });

    streamer.onChunk(makeChunk('tool_use', 'Read: file1.ts'));
    await vi.advanceTimersByTimeAsync(0);
    streamer.onChunk(makeChunk('tool_use', 'Read: file2.ts'));
    await vi.advanceTimersByTimeAsync(0);
    streamer.onChunk(makeChunk('tool_use', 'Read: file3.ts'));
    await vi.advanceTimersByTimeAsync(0);

    const lastCall = (sender.sendResponse as any).mock.calls[2];
    const text = lastCall[1].text;
    // First item should have been evicted
    expect(text).not.toContain('file1.ts');
    expect(text).toContain('> Read: file2.ts');
    expect(text).toContain('> Read: file3.ts');
    streamer.stop();
  });

  it('formats verbose mode with activity and preview', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'verbose',
      throttleMs: 0,
      maxPreviewChars: 20,
    });

    streamer.onChunk(makeChunk('tool_use', 'Read: src/index.ts'));
    await vi.advanceTimersByTimeAsync(0);

    const longContent = 'A'.repeat(50);
    streamer.onChunk(makeChunk('text', longContent));
    await vi.advanceTimersByTimeAsync(0);

    const lastCall = (sender.sendResponse as any).mock.calls[1];
    const text = lastCall[1].text;
    expect(text).toMatch(/\[\d+s\] 2 updates \(\d+ chars\)/);
    expect(text).toContain('Recent activity:');
    expect(text).toContain('> Read: src/index.ts');
    expect(text).toContain('Last output:');
    expect(text).toContain('> ...');
    streamer.stop();
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
    streamer.stop();
  });

  it('verbose mode shows activity without last output when only tool_use', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'verbose',
      throttleMs: 0,
    });

    streamer.onChunk(makeChunk('tool_use', 'Bash: npm test'));
    await vi.advanceTimersByTimeAsync(0);

    const call = (sender.sendResponse as any).mock.calls[0];
    const text = call[1].text;
    expect(text).toContain('Recent activity:');
    expect(text).toContain('> Bash: npm test');
    expect(text).not.toContain('Last output:');
    streamer.stop();
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
    streamer.stop();
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
    streamer.stop();
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
    streamer.stop();
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
    streamer.stop();
  });

  it('does not include tool timeline in concise mode with only text chunks', async () => {
    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 0,
    });

    streamer.onChunk(makeChunk('text', 'some text'));
    await vi.advanceTimersByTimeAsync(0);

    const call = (sender.sendResponse as any).mock.calls[0];
    const text = call[1].text;
    expect(text).not.toContain('>');
    expect(text).toMatch(/Working\.\.\. \d+s \| 1 updates/);
    streamer.stop();
  });

  it('ignores typing indicator errors gracefully', async () => {
    (sender.sendTypingIndicator as any).mockRejectedValue(new Error('typing failed'));

    const streamer = createProgressStreamer({
      chatId: 123,
      sender,
      mode: 'concise',
      throttleMs: 60000,
    });

    // Should not throw even though typing indicator fails
    await vi.advanceTimersByTimeAsync(4000);
    expect(sender.sendTypingIndicator).toHaveBeenCalled();
    streamer.stop();
  });
});
