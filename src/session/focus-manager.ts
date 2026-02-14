import type { SessionRegistry } from './registry.js';

const MAX_HISTORY = 10;

/**
 * Tracks which session is "focused" per user.
 * The focused session receives plain-text prompts.
 * Also maintains a per-user focus history stack for /back navigation.
 */
export class FocusManager {
  private focusMap: Map<number, string> = new Map();
  private focusHistory: Map<number, string[]> = new Map();

  constructor(private registry: SessionRegistry) {}

  /** Set focus for a user. Pushes previous focus to history. Returns true if the session exists. */
  setFocus(userId: number, sessionId: string): boolean {
    const entry = this.registry.getEntry(sessionId);
    if (!entry) return false;

    // Push current focus to history before switching
    const currentFocus = this.focusMap.get(userId);
    if (currentFocus && currentFocus !== sessionId) {
      let stack = this.focusHistory.get(userId);
      if (!stack) {
        stack = [];
        this.focusHistory.set(userId, stack);
      }
      stack.push(currentFocus);
      if (stack.length > MAX_HISTORY) {
        stack.shift();
      }
    }

    this.focusMap.set(userId, sessionId);
    return true;
  }

  /** Pop the previous focus from history and set it as current. Returns the restored session ID or undefined. */
  popFocus(userId: number): string | undefined {
    const stack = this.focusHistory.get(userId);
    if (!stack || stack.length === 0) return undefined;

    // Pop entries until we find a valid session
    while (stack.length > 0) {
      const previousId = stack.pop()!;
      const entry = this.registry.getEntry(previousId);
      if (entry) {
        this.focusMap.set(userId, previousId);
        return previousId;
      }
    }

    return undefined;
  }

  /** Get the focused session ID for a user. */
  getFocusedSessionId(userId: number): string | undefined {
    const sessionId = this.focusMap.get(userId);
    if (!sessionId) return undefined;

    // Validate the session still exists in the registry
    const entry = this.registry.getEntry(sessionId);
    if (!entry) {
      this.focusMap.delete(userId);
      return undefined;
    }

    return sessionId;
  }

  /** Clear focus for a user. */
  clearFocus(userId: number): void {
    this.focusMap.delete(userId);
  }

  /** Check if a specific session is focused by any user. */
  isFocusedBy(sessionId: string): number | undefined {
    for (const [userId, focusedId] of this.focusMap) {
      if (focusedId === sessionId) return userId;
    }
    return undefined;
  }

  /** Remove focus for all users pointing to a specific session. */
  clearFocusForSession(sessionId: string): void {
    for (const [userId, focusedId] of this.focusMap) {
      if (focusedId === sessionId) {
        this.focusMap.delete(userId);
      }
    }
  }

  /** Get the full focus map (for persistence). */
  getFocusMap(): Record<number, string> {
    return Object.fromEntries(this.focusMap);
  }

  /** Restore focus map (from persistence). */
  restoreFocusMap(map: Record<number, string>): void {
    this.focusMap.clear();
    for (const [userId, sessionId] of Object.entries(map)) {
      // Only restore if session exists
      if (this.registry.getEntry(sessionId)) {
        this.focusMap.set(Number(userId), sessionId);
      }
    }
  }
}
