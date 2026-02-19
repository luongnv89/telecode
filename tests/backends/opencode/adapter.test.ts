import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOpencodeAdapter } from '../../../src/backends/opencode/adapter.js';
import type { AdapterOutputChunk } from '../../../src/backends/types.js';

// Mock the @opencode-ai/sdk/client module that the adapter dynamically imports
const mockSessionCreate = vi.fn();
const mockSessionPromptAsync = vi.fn();
const mockSessionPrompt = vi.fn();
const mockSessionAbort = vi.fn();
const mockSessionList = vi.fn().mockResolvedValue({ data: [] });
const mockEventSubscribe = vi.fn();

const mockClient = {
  session: {
    create: mockSessionCreate,
    promptAsync: mockSessionPromptAsync,
    prompt: mockSessionPrompt,
    abort: mockSessionAbort,
    list: mockSessionList,
  },
  event: {
    subscribe: mockEventSubscribe,
  },
};

vi.mock('@opencode-ai/sdk/client', () => ({
  createOpencodeClient: () => mockClient,
}));

describe('createOpencodeAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('backendType', () => {
    it('is "opencode"', () => {
      const adapter = createOpencodeAdapter({});
      expect(adapter.backendType).toBe('opencode');
    });
  });

  describe('getStatus', () => {
    it('starts in idle state with no session ID', () => {
      const adapter = createOpencodeAdapter({});
      const status = adapter.getStatus();
      expect(status.state).toBe('idle');
      expect(status.backendSessionId).toBeUndefined();
    });
  });

  describe('startSession', () => {
    it('creates a session and returns the backend session ID', async () => {
      mockSessionCreate.mockResolvedValue({
        data: { id: 'oc-session-abc' },
      });

      const adapter = createOpencodeAdapter({});
      const result = await adapter.startSession();

      expect(result.backendSessionId).toBe('oc-session-abc');
      expect(adapter.getStatus().state).toBe('active');
      expect(adapter.getStatus().backendSessionId).toBe('oc-session-abc');
    });

    it('uses response directly when data wrapper is absent', async () => {
      mockSessionCreate.mockResolvedValue({ id: 'oc-session-direct' });

      const adapter = createOpencodeAdapter({});
      const result = await adapter.startSession();

      expect(result.backendSessionId).toBe('oc-session-direct');
    });

    it('throws when no session ID is returned', async () => {
      mockSessionCreate.mockResolvedValue({ data: {} });

      const adapter = createOpencodeAdapter({});
      await expect(adapter.startSession()).rejects.toThrow('no session ID received');
      expect(adapter.getStatus().state).toBe('idle');
    });

    it('passes cwd as directory and in title', async () => {
      mockSessionCreate.mockResolvedValue({
        data: { id: 'oc-sess-cwd' },
      });

      const adapter = createOpencodeAdapter({ cwd: '/my/project' });
      await adapter.startSession();

      expect(mockSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            title: 'telecode: /my/project',
          }),
          query: { directory: '/my/project' },
        }),
      );
    });
  });

  describe('attachSession', () => {
    it('stores the backend session ID and transitions to active', async () => {
      const adapter = createOpencodeAdapter({});
      const result = await adapter.attachSession('existing-session-xyz');

      expect(result.backendSessionId).toBe('existing-session-xyz');
      expect(adapter.getStatus().state).toBe('active');
      expect(adapter.getStatus().backendSessionId).toBe('existing-session-xyz');
    });
  });

  describe('sendPrompt', () => {
    async function setupActiveSession() {
      mockSessionCreate.mockResolvedValue({
        data: { id: 'oc-session-send' },
      });
      const adapter = createOpencodeAdapter({ cwd: '/test' });
      await adapter.startSession();
      return adapter;
    }

    it('throws if no session is active', async () => {
      const adapter = createOpencodeAdapter({});
      await expect(
        adapter.sendPrompt('sid', 'hello'),
      ).rejects.toThrow('No active OpenCode session');
    });

    it('sends prompt and collects streaming text', async () => {
      const adapter = await setupActiveSession();

      // Mock event stream that yields text chunks then done
      const events = [
        {
          type: 'message.part.updated',
          properties: { part: { type: 'text' }, delta: 'Hello ' },
        },
        {
          type: 'message.part.updated',
          properties: { part: { type: 'text' }, delta: 'World' },
        },
        {
          type: 'message.updated',
          properties: {
            info: { role: 'assistant', finish: true, cost: 0.01, tokens: { input: 100, output: 50 } },
          },
        },
      ];

      mockEventSubscribe.mockResolvedValue({
        stream: (async function* () {
          for (const e of events) yield e;
        })(),
      });
      mockSessionPromptAsync.mockResolvedValue(undefined);

      const chunks: AdapterOutputChunk[] = [];
      const result = await adapter.sendPrompt('sid', 'test prompt', (c) => chunks.push(c));

      expect(result.success).toBe(true);
      expect(result.text).toBe('Hello World');
      expect(result.totalCostUsd).toBe(0.01);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({ type: 'text', content: 'Hello ' });
      expect(chunks[1]).toEqual({ type: 'text', content: 'World' });
    });

    it('captures finalText from session.error events', async () => {
      const adapter = await setupActiveSession();

      mockEventSubscribe.mockResolvedValue({
        stream: (async function* () {
          yield { type: 'session.error', properties: { error: 'rate limited' } };
        })(),
      });
      mockSessionPromptAsync.mockResolvedValue(undefined);

      const result = await adapter.sendPrompt('sid', 'prompt');

      expect(result.success).toBe(true);
      expect(result.text).toBe('Error: rate limited');
    });

    it('falls back to sync prompt when streaming fails', async () => {
      const adapter = await setupActiveSession();

      // Event subscribe returns no stream
      mockEventSubscribe.mockResolvedValue({ stream: null });
      mockSessionPromptAsync.mockResolvedValue(undefined);
      mockSessionPrompt.mockResolvedValue({
        data: {
          parts: [
            { type: 'text', text: 'Sync response' },
          ],
          info: { cost: 0.005 },
        },
      });

      const result = await adapter.sendPrompt('sid', 'prompt');

      expect(result.success).toBe(true);
      expect(result.text).toBe('Sync response');
      expect(result.totalCostUsd).toBe(0.005);
    });

    it('returns error result when sync fallback also fails', async () => {
      const adapter = await setupActiveSession();

      mockEventSubscribe.mockResolvedValue({ stream: null });
      mockSessionPromptAsync.mockResolvedValue(undefined);
      mockSessionPrompt.mockRejectedValue(new Error('network timeout'));

      const result = await adapter.sendPrompt('sid', 'prompt');

      expect(result.success).toBe(false);
      expect(result.text).toContain('network timeout');
      expect(result.errors).toBeDefined();
      expect(adapter.getStatus().state).toBe('active');
    });

    it('returns error result when promptAsync throws', async () => {
      const adapter = await setupActiveSession();

      mockEventSubscribe.mockResolvedValue({
        stream: (async function* () {
          // never yields — blocks until promptAsync rejects
        })(),
      });
      mockSessionPromptAsync.mockRejectedValue(new Error('auth failed'));

      const result = await adapter.sendPrompt('sid', 'prompt');

      expect(result.success).toBe(false);
      expect(result.text).toContain('auth failed');
      expect(adapter.getStatus().state).toBe('active');
    });

    it('streams tool_use and tool_result chunks', async () => {
      const adapter = await setupActiveSession();

      const events = [
        {
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'tool',
              toolID: 'bash_1',
              state: { title: 'Running ls', status: 'running' },
            },
          },
        },
        {
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'tool',
              toolID: 'bash_1',
              state: { status: 'completed', output: 'file1.txt\nfile2.txt' },
            },
          },
        },
        { type: 'session.idle' },
      ];

      mockEventSubscribe.mockResolvedValue({
        stream: (async function* () {
          for (const e of events) yield e;
        })(),
      });
      mockSessionPromptAsync.mockResolvedValue(undefined);

      const chunks: AdapterOutputChunk[] = [];
      const result = await adapter.sendPrompt('sid', 'ls', (c) => chunks.push(c));

      expect(result.success).toBe(true);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({ type: 'tool_use', content: 'Running ls' });
      expect(chunks[1].type).toBe('tool_result');
      expect(chunks[1].content).toContain('✓');
      expect(chunks[1].content).toContain('file1.txt');
    });

    it('passes model spec when configured', async () => {
      mockSessionCreate.mockResolvedValue({
        data: { id: 'oc-session-model' },
      });
      const adapter = createOpencodeAdapter({
        model: 'anthropic/claude-sonnet-4-20250514',
      });
      await adapter.startSession();

      mockEventSubscribe.mockResolvedValue({
        stream: (async function* () {
          yield { type: 'session.idle' };
        })(),
      });
      mockSessionPromptAsync.mockResolvedValue(undefined);

      await adapter.sendPrompt('sid', 'hello');

      expect(mockSessionPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-20250514' },
          }),
        }),
      );
    });

    it('handles model string without provider slash', async () => {
      mockSessionCreate.mockResolvedValue({
        data: { id: 'oc-session-model2' },
      });
      const adapter = createOpencodeAdapter({ model: 'gpt-4o' });
      await adapter.startSession();

      mockEventSubscribe.mockResolvedValue({
        stream: (async function* () {
          yield { type: 'session.idle' };
        })(),
      });
      mockSessionPromptAsync.mockResolvedValue(undefined);

      await adapter.sendPrompt('sid', 'hello');

      expect(mockSessionPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            model: { providerID: '', modelID: 'gpt-4o' },
          }),
        }),
      );
    });

    it('returns "(no output)" when no text is captured', async () => {
      const adapter = await setupActiveSession();

      mockEventSubscribe.mockResolvedValue({
        stream: (async function* () {
          yield { type: 'session.idle' };
        })(),
      });
      mockSessionPromptAsync.mockResolvedValue(undefined);

      const result = await adapter.sendPrompt('sid', 'prompt');

      expect(result.success).toBe(true);
      expect(result.text).toBe('(no output)');
    });

    it('recovers state to active after completion', async () => {
      const adapter = await setupActiveSession();

      mockEventSubscribe.mockResolvedValue({
        stream: (async function* () {
          yield { type: 'session.idle' };
        })(),
      });
      mockSessionPromptAsync.mockResolvedValue(undefined);

      await adapter.sendPrompt('sid', 'prompt');
      expect(adapter.getStatus().state).toBe('active');
    });
  });

  describe('stopSession', () => {
    it('aborts and clears session state', async () => {
      mockSessionCreate.mockResolvedValue({
        data: { id: 'oc-session-stop' },
      });
      const adapter = createOpencodeAdapter({ cwd: '/test' });
      await adapter.startSession();

      mockSessionAbort.mockResolvedValue(undefined);
      await adapter.stopSession();

      expect(mockSessionAbort).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'oc-session-stop' },
        }),
      );
      expect(adapter.getStatus().state).toBe('idle');
      expect(adapter.getStatus().backendSessionId).toBeUndefined();
    });

    it('handles abort failure gracefully', async () => {
      mockSessionCreate.mockResolvedValue({
        data: { id: 'oc-session-stop2' },
      });
      const adapter = createOpencodeAdapter({});
      await adapter.startSession();

      mockSessionAbort.mockRejectedValue(new Error('already stopped'));
      await adapter.stopSession(); // should not throw

      expect(adapter.getStatus().state).toBe('idle');
    });

    it('is safe to call when no session is active', async () => {
      const adapter = createOpencodeAdapter({});
      await adapter.stopSession(); // should not throw
      expect(adapter.getStatus().state).toBe('idle');
    });
  });

  describe('resetSession', () => {
    it('stops and starts a new session', async () => {
      let callCount = 0;
      mockSessionCreate.mockImplementation(async () => {
        callCount++;
        return { data: { id: `oc-session-${callCount}` } };
      });
      mockSessionAbort.mockResolvedValue(undefined);

      const adapter = createOpencodeAdapter({});
      await adapter.startSession();
      expect(adapter.getStatus().backendSessionId).toBe('oc-session-1');

      const result = await adapter.resetSession();
      expect(result.backendSessionId).toBe('oc-session-2');
      expect(adapter.getStatus().state).toBe('active');
    });
  });
});
