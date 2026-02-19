import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { getDataDir } from '../paths.js';

const DEFAULT_LOG_DIR = join(getDataDir(), 'logs');

export function resolveLogDir(configPath?: string): string {
  if (!configPath) return DEFAULT_LOG_DIR;

  // Resolve ~ to home directory
  if (configPath.startsWith('~')) {
    return join(homedir(), configPath.slice(1));
  }

  return configPath;
}

export function sessionLogFilename(sessionId: string, startTime: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');

  const y = startTime.getFullYear();
  const mo = pad(startTime.getMonth() + 1);
  const d = pad(startTime.getDate());
  const h = pad(startTime.getHours());
  const mi = pad(startTime.getMinutes());
  const s = pad(startTime.getSeconds());

  // Take first 8 chars of sessionId for the short suffix
  const shortId = sessionId.replace(/-/g, '').slice(0, 8);

  return `session-${y}${mo}${d}-${h}${mi}${s}-${shortId}.jsonl`;
}

export async function ensureLogDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
