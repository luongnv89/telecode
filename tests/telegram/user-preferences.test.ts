import { describe, it, expect } from 'vitest';
import { createUserPreferences } from '../../src/telegram/user-preferences.js';

describe('UserPreferences', () => {
  it('returns default mode for unknown user', () => {
    const prefs = createUserPreferences('concise');
    expect(prefs.getMode(123)).toBe('concise');
  });

  it('uses provided default mode', () => {
    const prefs = createUserPreferences('verbose');
    expect(prefs.getMode(123)).toBe('verbose');
  });

  it('returns set mode for user', () => {
    const prefs = createUserPreferences('concise');
    prefs.setMode(123, 'verbose');
    expect(prefs.getMode(123)).toBe('verbose');
  });

  it('keeps modes independent per user', () => {
    const prefs = createUserPreferences('concise');
    prefs.setMode(100, 'verbose');
    prefs.setMode(200, 'concise');

    expect(prefs.getMode(100)).toBe('verbose');
    expect(prefs.getMode(200)).toBe('concise');
    expect(prefs.getMode(300)).toBe('concise');
  });

  it('allows overwriting existing mode', () => {
    const prefs = createUserPreferences('concise');
    prefs.setMode(123, 'verbose');
    prefs.setMode(123, 'concise');
    expect(prefs.getMode(123)).toBe('concise');
  });
});
