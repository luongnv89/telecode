import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLockManager } from '../../src/lock/manager.js';
import type { LockManager } from '../../src/lock/manager.js';

describe('LockManager', () => {
  let manager: LockManager;

  beforeEach(() => {
    manager = createLockManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('acquire', () => {
    it('first connection acquires lock successfully', () => {
      const result = manager.acquire(1, 100, 'session-1');

      expect(result.acquired).toBe(true);
      if (result.acquired) {
        expect(result.lockInfo.userId).toBe(1);
        expect(result.lockInfo.chatId).toBe(100);
        expect(result.lockInfo.sessionId).toBe('session-1');
        expect(result.lockInfo.acquiredAt).toBeInstanceOf(Date);
      }
    });

    it('second concurrent connection receives deterministic rejection', () => {
      manager.acquire(1, 100, 'session-1');
      const result = manager.acquire(2, 200, 'session-2');

      expect(result.acquired).toBe(false);
      if (!result.acquired) {
        expect(result.reason).toBe(
          'Lock is held by user 1 in chat 100 (session session-1)',
        );
        expect(result.heldBy.userId).toBe(1);
        expect(result.heldBy.chatId).toBe(100);
        expect(result.heldBy.sessionId).toBe('session-1');
      }
    });

    it('deterministic rejection message is always the same for the same scenario', () => {
      manager.acquire(1, 100, 'session-1');

      const result1 = manager.acquire(2, 200, 'session-2');
      const result2 = manager.acquire(3, 300, 'session-3');

      expect(result1.acquired).toBe(false);
      expect(result2.acquired).toBe(false);
      if (!result1.acquired && !result2.acquired) {
        // Both rejections reference the same lock holder with the same format
        expect(result1.reason).toBe(result2.reason);
      }
    });

    it('same user and chat can reacquire their own lock', () => {
      const first = manager.acquire(1, 100, 'session-1');
      expect(first.acquired).toBe(true);

      const second = manager.acquire(1, 100, 'session-2');
      expect(second.acquired).toBe(true);
      if (second.acquired) {
        expect(second.lockInfo.sessionId).toBe('session-2');
      }
    });

    it('same user but different chat is rejected', () => {
      manager.acquire(1, 100, 'session-1');
      const result = manager.acquire(1, 200, 'session-2');

      expect(result.acquired).toBe(false);
    });

    it('different user but same chat is rejected', () => {
      manager.acquire(1, 100, 'session-1');
      const result = manager.acquire(2, 100, 'session-2');

      expect(result.acquired).toBe(false);
    });
  });

  describe('release', () => {
    it('release with correct sessionId works', () => {
      manager.acquire(1, 100, 'session-1');
      expect(manager.isLocked()).toBe(true);

      manager.release('session-1');
      expect(manager.isLocked()).toBe(false);
    });

    it('release with wrong sessionId is ignored', () => {
      manager.acquire(1, 100, 'session-1');

      manager.release('wrong-session');
      expect(manager.isLocked()).toBe(true);
      expect(manager.getLockInfo()?.sessionId).toBe('session-1');
    });

    it('release when no lock is held does nothing', () => {
      expect(() => manager.release('session-1')).not.toThrow();
      expect(manager.isLocked()).toBe(false);
    });

    it('after release, another user can acquire', () => {
      manager.acquire(1, 100, 'session-1');
      manager.release('session-1');

      const result = manager.acquire(2, 200, 'session-2');
      expect(result.acquired).toBe(true);
    });
  });

  describe('isLocked', () => {
    it('returns false when no lock is held', () => {
      expect(manager.isLocked()).toBe(false);
    });

    it('returns true when a lock is held', () => {
      manager.acquire(1, 100, 'session-1');
      expect(manager.isLocked()).toBe(true);
    });

    it('returns false after lock is released', () => {
      manager.acquire(1, 100, 'session-1');
      manager.release('session-1');
      expect(manager.isLocked()).toBe(false);
    });
  });

  describe('getLockInfo', () => {
    it('returns null when no lock is held', () => {
      expect(manager.getLockInfo()).toBeNull();
    });

    it('returns lock info when a lock is held', () => {
      manager.acquire(1, 100, 'session-1');
      const info = manager.getLockInfo();

      expect(info).not.toBeNull();
      expect(info!.userId).toBe(1);
      expect(info!.chatId).toBe(100);
      expect(info!.sessionId).toBe('session-1');
      expect(info!.acquiredAt).toBeInstanceOf(Date);
    });

    it('returns a copy, not a reference to the internal state', () => {
      manager.acquire(1, 100, 'session-1');
      const info1 = manager.getLockInfo();
      const info2 = manager.getLockInfo();

      expect(info1).toEqual(info2);
      expect(info1).not.toBe(info2);
    });
  });

  describe('checkStale', () => {
    it('returns false when no lock is held', () => {
      expect(manager.checkStale(1000)).toBe(false);
    });

    it('returns false when lock is within TTL', () => {
      manager.acquire(1, 100, 'session-1');
      // Lock was just acquired, so a 10-second TTL should not be stale
      expect(manager.checkStale(10_000)).toBe(false);
    });

    it('returns true when lock has exceeded TTL', () => {
      vi.useFakeTimers();
      const baseTime = new Date('2025-01-01T00:00:00.000Z');
      vi.setSystemTime(baseTime);

      manager.acquire(1, 100, 'session-1');

      // Advance time by 5 seconds
      vi.setSystemTime(new Date(baseTime.getTime() + 5_000));

      // TTL of 3 seconds means the lock (acquired 5s ago) is stale
      expect(manager.checkStale(3_000)).toBe(true);
    });

    it('detects stale lock with a realistic TTL scenario', () => {
      vi.useFakeTimers();
      const baseTime = new Date('2025-01-01T00:00:00.000Z');
      vi.setSystemTime(baseTime);

      manager.acquire(1, 100, 'session-1');

      // A very large TTL should not be stale
      expect(manager.checkStale(999_999_999)).toBe(false);

      // Advance time by 1ms so the lock is in the past
      vi.setSystemTime(new Date(baseTime.getTime() + 1));

      // A TTL of 0 means lock is stale after any time has passed
      expect(manager.checkStale(0)).toBe(true);
    });
  });

  describe('forceRelease', () => {
    it('releases the lock unconditionally', () => {
      manager.acquire(1, 100, 'session-1');
      expect(manager.isLocked()).toBe(true);

      manager.forceRelease();
      expect(manager.isLocked()).toBe(false);
      expect(manager.getLockInfo()).toBeNull();
    });

    it('does nothing when no lock is held', () => {
      expect(() => manager.forceRelease()).not.toThrow();
      expect(manager.isLocked()).toBe(false);
    });

    it('allows a new user to acquire after force release', () => {
      manager.acquire(1, 100, 'session-1');
      manager.forceRelease();

      const result = manager.acquire(2, 200, 'session-2');
      expect(result.acquired).toBe(true);
      if (result.acquired) {
        expect(result.lockInfo.userId).toBe(2);
      }
    });
  });
});
