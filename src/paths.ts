import { homedir } from 'node:os';
import { join } from 'node:path';

export function getDataDir(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'telecode');
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'telecode');
}

export function getLogDir(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Logs', 'telecode');
  }
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'telecode', 'log');
}
