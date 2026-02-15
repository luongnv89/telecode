import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPermissionBridge, type PermissionBridge, type PermissionBridgeConfig } from '../../src/telegram/permission-bridge.js';

function createTestBridge(overrides?: Partial<PermissionBridgeConfig>) {
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const config: PermissionBridgeConfig = {
    chatId: 123,
    sendMessage,
    timeoutMs: 5000,
    ...overrides,
  };
  const bridge = createPermissionBridge(config);
  return { bridge, sendMessage };
}

function makeOptions(overrides?: Partial<Parameters<typeof createPermissionBridge>[0]>) {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    toolUseID: 'tool-use-123',
    suggestions: undefined,
    controller,
  };
}

describe('PermissionBridge', () => {
  describe('canUseTool', () => {
    it('sends Telegram message with correct format and buttons', async () => {
      const { bridge, sendMessage } = createTestBridge();
      const opts = makeOptions();

      // Start the canUseTool call but don't await it yet
      const promise = bridge.canUseTool('Bash', { command: 'ls -la' }, opts);

      // Wait for the sendMessage to be called
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

      const [chatId, text, keyboard] = sendMessage.mock.calls[0];
      expect(chatId).toBe(123);
      expect(text).toContain('Permission requested');
      expect(text).toContain('Bash: ls -la');
      expect(keyboard).toBeDefined();

      // Clean up — resolve the pending request
      bridge.cancelAll();
      await promise;
    });

    it('includes decisionReason in the message when provided', async () => {
      const { bridge, sendMessage } = createTestBridge();
      const opts = { ...makeOptions(), decisionReason: 'Command accesses /etc' };

      const promise = bridge.canUseTool('Bash', { command: 'cat /etc/passwd' }, opts);

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

      const text = sendMessage.mock.calls[0][1];
      expect(text).toContain('Reason: Command accesses /etc');

      bridge.cancelAll();
      await promise;
    });
  });

  describe('resolvePermission', () => {
    it('resolves allow correctly', async () => {
      const { bridge, sendMessage } = createTestBridge();
      const opts = makeOptions();

      const promise = bridge.canUseTool('Read', { file_path: '/tmp/test.txt' }, opts);

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

      // Extract the requestId from the keyboard callback data
      const keyboard = sendMessage.mock.calls[0][2];
      const rows = keyboard.inline_keyboard;
      const allowBtn = rows[0].find((btn: any) => btn.callback_data?.startsWith('perm:allow:'));
      const requestId = allowBtn.callback_data.split(':')[2];

      const resolved = bridge.resolvePermission(requestId, 'allow');
      expect(resolved).toBe(true);

      const result = await promise;
      expect(result.behavior).toBe('allow');
      if (result.behavior === 'allow') {
        expect(result.updatedInput).toEqual({ file_path: '/tmp/test.txt' });
      }
    });

    it('resolves deny correctly with interrupt', async () => {
      const { bridge, sendMessage } = createTestBridge();
      const opts = makeOptions();

      const promise = bridge.canUseTool('Bash', { command: 'rm -rf /' }, opts);

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

      const keyboard = sendMessage.mock.calls[0][2];
      const rows = keyboard.inline_keyboard;
      const denyBtn = rows[0].find((btn: any) => btn.callback_data?.startsWith('perm:deny:'));
      const requestId = denyBtn.callback_data.split(':')[2];

      bridge.resolvePermission(requestId, 'deny');

      const result = await promise;
      expect(result.behavior).toBe('deny');
      if (result.behavior === 'deny') {
        expect(result.interrupt).toBe(true);
        expect(result.message).toContain('denied');
      }
    });

    it('resolves always_allow with permission suggestions', async () => {
      const { bridge, sendMessage } = createTestBridge();
      const suggestions = [
        { type: 'addRules' as const, rules: [{ toolName: 'Read' }], behavior: 'allow' as const, destination: 'session' as const },
      ];
      const opts = { ...makeOptions(), suggestions };

      const promise = bridge.canUseTool('Read', { file_path: '/tmp/test.txt' }, opts);

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

      const keyboard = sendMessage.mock.calls[0][2];
      const rows = keyboard.inline_keyboard;
      const alwaysAllowBtn = rows.flat().find((btn: any) => btn.callback_data?.startsWith('perm:always_allow:'));
      const requestId = alwaysAllowBtn.callback_data.split(':')[2];

      bridge.resolvePermission(requestId, 'always_allow');

      const result = await promise;
      expect(result.behavior).toBe('allow');
      if (result.behavior === 'allow') {
        expect(result.updatedPermissions).toEqual(suggestions);
      }
    });

    it('returns false for non-existent requestId', () => {
      const { bridge } = createTestBridge();
      expect(bridge.resolvePermission('nonexistent', 'allow')).toBe(false);
    });

    it('returns false for duplicate resolve (already resolved)', async () => {
      const { bridge, sendMessage } = createTestBridge();
      const opts = makeOptions();

      const promise = bridge.canUseTool('Bash', { command: 'echo hi' }, opts);

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

      const keyboard = sendMessage.mock.calls[0][2];
      const rows = keyboard.inline_keyboard;
      const allowBtn = rows[0].find((btn: any) => btn.callback_data?.startsWith('perm:allow:'));
      const requestId = allowBtn.callback_data.split(':')[2];

      expect(bridge.resolvePermission(requestId, 'allow')).toBe(true);
      expect(bridge.resolvePermission(requestId, 'deny')).toBe(false);

      await promise;
    });
  });

  describe('timeout', () => {
    it('auto-denies after timeout without interrupt', async () => {
      vi.useFakeTimers();
      const { bridge, sendMessage } = createTestBridge({ timeoutMs: 100 });
      const opts = makeOptions();

      const promise = bridge.canUseTool('Bash', { command: 'echo hi' }, opts);

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

      // Advance past timeout
      vi.advanceTimersByTime(150);

      const result = await promise;
      expect(result.behavior).toBe('deny');
      if (result.behavior === 'deny') {
        expect(result.message).toContain('timed out');
        // No interrupt — let Claude try alternatives
        expect(result.interrupt).toBeUndefined();
      }

      vi.useRealTimers();
    });
  });

  describe('cancelAll', () => {
    it('resolves all pending as deny+interrupt', async () => {
      const { bridge, sendMessage } = createTestBridge();
      const opts1 = makeOptions();
      const opts2 = makeOptions();

      const p1 = bridge.canUseTool('Bash', { command: 'echo 1' }, opts1);
      const p2 = bridge.canUseTool('Read', { file_path: '/tmp/a' }, opts2);

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));

      expect(bridge.pendingCount()).toBe(2);

      bridge.cancelAll();

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.behavior).toBe('deny');
      expect(r2.behavior).toBe('deny');
      if (r1.behavior === 'deny') expect(r1.interrupt).toBe(true);
      if (r2.behavior === 'deny') expect(r2.interrupt).toBe(true);

      expect(bridge.pendingCount()).toBe(0);
    });
  });

  describe('pendingCount', () => {
    it('tracks pending requests correctly', async () => {
      const { bridge, sendMessage } = createTestBridge();
      expect(bridge.pendingCount()).toBe(0);

      const opts = makeOptions();
      const promise = bridge.canUseTool('Bash', { command: 'echo hi' }, opts);

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      expect(bridge.pendingCount()).toBe(1);

      bridge.cancelAll();
      await promise;

      expect(bridge.pendingCount()).toBe(0);
    });
  });

  describe('sendMessage failure', () => {
    it('auto-denies when sendMessage throws', async () => {
      const { bridge } = createTestBridge({
        sendMessage: vi.fn().mockRejectedValue(new Error('Telegram down')),
      });
      const opts = makeOptions();

      const result = await bridge.canUseTool('Bash', { command: 'echo hi' }, opts);

      expect(result.behavior).toBe('deny');
      if (result.behavior === 'deny') {
        expect(result.message).toContain('Failed to send');
      }
    });
  });

  describe('abort signal', () => {
    it('denies with interrupt when signal aborts', async () => {
      const { bridge, sendMessage } = createTestBridge();
      const opts = makeOptions();

      const promise = bridge.canUseTool('Bash', { command: 'echo hi' }, opts);

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

      opts.controller.abort();

      const result = await promise;
      expect(result.behavior).toBe('deny');
      if (result.behavior === 'deny') {
        expect(result.interrupt).toBe(true);
        expect(result.message).toContain('aborted');
      }
    });
  });
});
