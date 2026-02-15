import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
    );
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function loadGitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: join(__dirname, '..'),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

export const VERSION = loadVersion();
export const GIT_HASH = loadGitHash();
export const VERSION_STRING = `v${VERSION} (${GIT_HASH})`;
