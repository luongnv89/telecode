export interface LockInfo {
  userId: number;
  chatId: number;
  acquiredAt: Date;
  sessionId: string;
}

export type LockResult =
  | { acquired: true; lockInfo: LockInfo }
  | { acquired: false; reason: string; heldBy: LockInfo };

export interface LockManager {
  acquire(userId: number, chatId: number, sessionId: string): LockResult;
  release(sessionId: string): void;
  isLocked(): boolean;
  getLockInfo(): LockInfo | null;
  checkStale(ttlMs: number): boolean;
  forceRelease(): void;
}

export function createLockManager(): LockManager {
  let currentLock: LockInfo | null = null;

  return {
    acquire(userId: number, chatId: number, sessionId: string): LockResult {
      // No existing lock — acquire immediately
      if (currentLock === null) {
        const lockInfo: LockInfo = {
          userId,
          chatId,
          acquiredAt: new Date(),
          sessionId,
        };
        currentLock = lockInfo;
        return { acquired: true, lockInfo };
      }

      // Same user and chat — allow reacquire (refresh the lock)
      if (currentLock.userId === userId && currentLock.chatId === chatId) {
        const lockInfo: LockInfo = {
          userId,
          chatId,
          acquiredAt: new Date(),
          sessionId,
        };
        currentLock = lockInfo;
        return { acquired: true, lockInfo };
      }

      // Different user or chat — reject
      return {
        acquired: false,
        reason: `Lock is held by user ${currentLock.userId} in chat ${currentLock.chatId} (session ${currentLock.sessionId})`,
        heldBy: { ...currentLock },
      };
    },

    release(sessionId: string): void {
      if (currentLock !== null && currentLock.sessionId === sessionId) {
        currentLock = null;
      }
    },

    isLocked(): boolean {
      return currentLock !== null;
    },

    getLockInfo(): LockInfo | null {
      if (currentLock === null) {
        return null;
      }
      return { ...currentLock };
    },

    checkStale(ttlMs: number): boolean {
      if (currentLock === null) {
        return false;
      }
      return currentLock.acquiredAt.getTime() + ttlMs < Date.now();
    },

    forceRelease(): void {
      currentLock = null;
    },
  };
}
