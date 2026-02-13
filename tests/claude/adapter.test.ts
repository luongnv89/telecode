import { describe, it, expect, vi } from 'vitest';
import type { ClaudeAdapter, ClaudeSessionConfig } from '../../src/claude/adapter.js';

// We test the adapter interface contract without actually spawning Claude.
// Integration tests with real SDK are deferred to e2e.

describe('ClaudeAdapter interface', () => {
  function createMockAdapter(): ClaudeAdapter {
    let state: 'idle' | 'active' | 'busy' | 'stopped' = 'idle';
    let sessionId: string | undefined;

    return {
      async startSession() {
        state = 'active';
        sessionId = 'mock-session-123';
        return { claudeSessionId: sessionId };
      },

      async sendPrompt(_sid, prompt, onChunk) {
        state = 'busy';
        if (onChunk) {
          onChunk({ type: 'text', content: `Echo: ${prompt}` });
        }
        state = 'active';
        return {
          success: true,
          text: `Echo: ${prompt}`,
          durationMs: 100,
          totalCostUsd: 0.001,
          numTurns: 1,
        };
      },

      async stopSession() {
        state = 'idle';
        sessionId = undefined;
      },

      async resetSession() {
        state = 'active';
        sessionId = 'mock-session-456';
        return { claudeSessionId: sessionId };
      },

      getStatus() {
        return { claudeSessionId: sessionId, state };
      },
    };
  }

  it('starts in idle state', () => {
    const adapter = createMockAdapter();
    expect(adapter.getStatus().state).toBe('idle');
  });

  it('transitions to active after startSession', async () => {
    const adapter = createMockAdapter();
    const result = await adapter.startSession();
    expect(result.claudeSessionId).toBe('mock-session-123');
    expect(adapter.getStatus().state).toBe('active');
  });

  it('transitions back to idle after stopSession', async () => {
    const adapter = createMockAdapter();
    await adapter.startSession();
    await adapter.stopSession();
    expect(adapter.getStatus().state).toBe('idle');
    expect(adapter.getStatus().claudeSessionId).toBeUndefined();
  });

  it('returns result from sendPrompt', async () => {
    const adapter = createMockAdapter();
    await adapter.startSession();
    const result = await adapter.sendPrompt('test', 'hello');
    expect(result.success).toBe(true);
    expect(result.text).toBe('Echo: hello');
  });

  it('calls onChunk callback during sendPrompt', async () => {
    const adapter = createMockAdapter();
    await adapter.startSession();
    const chunks: any[] = [];
    await adapter.sendPrompt('test', 'hello', (chunk) => chunks.push(chunk));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('text');
  });

  it('resets session with new ID', async () => {
    const adapter = createMockAdapter();
    await adapter.startSession();
    const result = await adapter.resetSession();
    expect(result.claudeSessionId).toBe('mock-session-456');
    expect(adapter.getStatus().state).toBe('active');
  });
});
