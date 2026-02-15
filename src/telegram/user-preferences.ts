export type DisplayMode = 'concise' | 'verbose';

export interface UserPreferences {
  getMode(userId: number): DisplayMode;
  setMode(userId: number, mode: DisplayMode): void;
}

export function createUserPreferences(defaultMode: DisplayMode = 'concise'): UserPreferences {
  const modes = new Map<number, DisplayMode>();

  return {
    getMode(userId: number): DisplayMode {
      return modes.get(userId) ?? defaultMode;
    },

    setMode(userId: number, mode: DisplayMode): void {
      modes.set(userId, mode);
    },
  };
}
