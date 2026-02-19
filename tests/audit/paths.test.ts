import { describe, it, expect } from 'vitest';
import { resolveLogDir, sessionLogFilename } from '../../src/audit/paths.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getDataDir } from '../../src/paths.js';

const expectedDefaultLogDir = join(getDataDir(), 'logs');

describe('resolveLogDir', () => {
  it('returns default path when no config provided', () => {
    const result = resolveLogDir();
    expect(result).toBe(expectedDefaultLogDir);
  });

  it('returns default path for empty string', () => {
    const result = resolveLogDir('');
    expect(result).toBe(expectedDefaultLogDir);
  });

  it('expands ~ to home directory', () => {
    const result = resolveLogDir('~/my-logs');
    expect(result).toBe(join(homedir(), 'my-logs'));
  });

  it('returns absolute path unchanged', () => {
    const result = resolveLogDir('/var/log/telecode');
    expect(result).toBe('/var/log/telecode');
  });
});

describe('sessionLogFilename', () => {
  it('generates correct filename format', () => {
    const filename = sessionLogFilename(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      new Date('2026-02-13T14:30:22.000Z')
    );

    // Should match: session-YYYYMMDD-HHMMSS-shortId.jsonl
    expect(filename).toMatch(/^session-\d{8}-\d{6}-[a-f0-9]{8}\.jsonl$/);
    expect(filename).toContain('a1b2c3d4');
    expect(filename.endsWith('.jsonl')).toBe(true);
  });

  it('pads single-digit values', () => {
    const filename = sessionLogFilename(
      'abcdef12-3456-7890-abcd-ef1234567890',
      new Date('2026-01-05T03:07:09.000Z')
    );

    // The date part depends on local timezone, just check format
    expect(filename).toMatch(/^session-\d{8}-\d{6}-abcdef12\.jsonl$/);
  });

  it('strips dashes from session ID for short form', () => {
    const filename = sessionLogFilename(
      'ab-cd-ef-12',
      new Date('2026-02-13T14:30:22.000Z')
    );

    // "ab-cd-ef-12" with dashes stripped = "abcdef12" (first 8 chars)
    expect(filename).toContain('abcdef12');
  });
});
