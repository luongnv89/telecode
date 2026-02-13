import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createResilienceMonitor } from '../../src/resilience/monitor.js';
import type { SessionManager } from '../../src/claude/session-manager.js';
import type { LockManager } from '../../src/lock/manager.js';
import type { TelegramSender } from '../../src/telegram/sender.js';
import { createLockManager } from '../../src/lock/manager.js';

function createMockSessionManager(): SessionManager {
  return {
    getSession: vi.fn(() => null),
    isActive: vi.fn(() => false),
    startSession: vi.fn(),
    stopSession: vi.fn().mockResolvedValue(undefined),
    resetSession: vi.fn(),
    updateState: vi.fn(),
    getTransitions: vi.fn(() => []),
    getTransitionsForSession: vi.fn(() => []),
  } as unknown as SessionManager;
}

function createMockSender(): TelegramSender {
  return {
    sendResponse: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ResilienceMonitor', () => {
  let sessionManager: SessionManager;
  let lockManager: LockManager;
  let sender: TelegramSender;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionManager = createMockSessionManager();
    lockManager = createLockManager();
    sender = createMockSender();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start/stop', () => {
    it('starts and stops without error', () => {
      const monitor = createResilienceMonitor({
        sessionManager,
        lockManager,
        sender,
        sessionTimeoutMs: 60_000,
        checkIntervalMs: 1000,
      });

      monitor.start();
      monitor.stop();
    });

    it('detects stale session on timer tick', () => {
      const monitor = createResilienceMonitor({
        sessionManager,
        lockManager,
        sender,
        sessionTimeoutMs: 5_000,
        checkIntervalMs: 1000,
      });

      // Acquire lock at t=0
      const base = new Date('2025-01-01T00:00:00.000Z');
      vi.setSystemTime(base);
      lockManager.acquire(1, 100, 'sess-1');

      monitor.start();

      // Advance past timeout
      vi.setSystemTime(new Date(base.getTime() + 6_000));
      vi.advanceTimersByTime(1000);

      // Lock should be released
      expect(lockManager.isLocked()).toBe(false);

      // User should have been notified
      expect(sender.sendResponse).toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          type: 'error',
          code: 'SESSION_TIMEOUT',
        }),
      );

      monitor.stop();
    });

    it('does not trigger for non-stale sessions', () => {
      const monitor = createResilienceMonitor({
        sessionManager,
        lockManager,
        sender,
        sessionTimeoutMs: 60_000,
        checkIntervalMs: 1000,
      });

      lockManager.acquire(1, 100, 'sess-1');
      monitor.start();

      // Advance less than timeout
      vi.advanceTimersByTime(1000);

      expect(lockManager.isLocked()).toBe(true);
      expect(sender.sendResponse).not.toHaveBeenCalled();

      monitor.stop();
    });
  });

  describe('notifyAuditWriteFailure', () => {
    it('sends high-priority message to user', async () => {
      const monitor = createResilienceMonitor({
        sessionManager,
        lockManager,
        sender,
        sessionTimeoutMs: 60_000,
      });

      await monitor.notifyAuditWriteFailure(456, new Error('disk full'));

      expect(sender.sendResponse).toHaveBeenCalledWith(
        456,
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('AUDIT FAILURE'),
        }),
      );
    });

    it('handles send failure gracefully', async () => {
      (sender.sendResponse as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Telegram down'),
      );

      const monitor = createResilienceMonitor({
        sessionManager,
        lockManager,
        sender,
        sessionTimeoutMs: 60_000,
      });

      // Should not throw
      await expect(
        monitor.notifyAuditWriteFailure(456, new Error('disk full')),
      ).resolves.not.toThrow();
    });
  });

  describe('notifySessionCrash', () => {
    it('sends crash notification and releases lock', async () => {
      lockManager.acquire(1, 100, 'sess-1');

      const monitor = createResilienceMonitor({
        sessionManager,
        lockManager,
        sender,
        sessionTimeoutMs: 60_000,
      });

      await monitor.notifySessionCrash(100, new Error('process died'));

      expect(lockManager.isLocked()).toBe(false);
      expect(sender.sendResponse).toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          type: 'error',
          code: 'CLAUDE_ERROR',
          message: expect.stringContaining('crashed'),
        }),
      );
    });

    it('handles send failure gracefully', async () => {
      (sender.sendResponse as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Telegram down'),
      );

      const monitor = createResilienceMonitor({
        sessionManager,
        lockManager,
        sender,
        sessionTimeoutMs: 60_000,
      });

      await expect(
        monitor.notifySessionCrash(100, new Error('crash')),
      ).resolves.not.toThrow();
    });
  });
});
