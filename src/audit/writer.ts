import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuditEvent } from '../types/audit.js';
import { TelecodeError } from '../types/errors.js';
import { resolveLogDir, sessionLogFilename, ensureLogDir } from './paths.js';

export interface AuditWriter {
  open(sessionId: string, startTime: Date): Promise<void>;
  write(event: AuditEvent): Promise<void>;
  close(): Promise<void>;
}

export function createAuditWriter(configLogPath?: string): AuditWriter {
  let filePath: string | null = null;
  let logDir: string;

  return {
    async open(sessionId: string, startTime: Date): Promise<void> {
      logDir = resolveLogDir(configLogPath);
      await ensureLogDir(logDir);

      const filename = sessionLogFilename(sessionId, startTime);
      filePath = join(logDir, filename);

      // Create the file (or truncate if it exists)
      await writeFile(filePath, '', { flag: 'w' });
    },

    async write(event: AuditEvent): Promise<void> {
      if (!filePath) {
        throw new TelecodeError(
          'Audit writer not opened. Call open() first.',
          'AUDIT_WRITE_ERROR',
        );
      }

      const line = JSON.stringify(event) + '\n';

      try {
        await appendFile(filePath, line, 'utf-8');
      } catch (err) {
        throw new TelecodeError(
          `Failed to write audit event: ${err instanceof Error ? err.message : String(err)}`,
          'AUDIT_WRITE_ERROR',
          { cause: err instanceof Error ? err : undefined },
        );
      }
    },

    async close(): Promise<void> {
      filePath = null;
    },
  };
}
