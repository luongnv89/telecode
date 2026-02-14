import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

export interface DiscoveredSession {
  claudeSessionId: string;
  projectPath: string;
  lastModified: Date;
  fileName: string;
}

export interface SessionDiscovery {
  scan(maxAgeMs?: number): Promise<DiscoveredSession[]>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export function createSessionDiscovery(
  claudeProjectsDir?: string,
): SessionDiscovery {
  const projectsDir = claudeProjectsDir ?? join(homedir(), '.claude', 'projects');

  return {
    async scan(maxAgeMs: number = DEFAULT_MAX_AGE_MS): Promise<DiscoveredSession[]> {
      const results: DiscoveredSession[] = [];
      const cutoff = Date.now() - maxAgeMs;

      let projectDirs: string[];
      try {
        projectDirs = await fs.readdir(projectsDir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }
        throw err;
      }

      for (const dirName of projectDirs) {
        const dirPath = join(projectsDir, dirName);

        let stat;
        try {
          stat = await fs.stat(dirPath);
        } catch {
          continue;
        }
        if (!stat.isDirectory()) continue;

        // Decode project path from directory name
        // Claude encodes paths as: -Users-name-project → /Users/name/project
        const projectPath = '/' + dirName.replace(/-/g, '/').replace(/^\/+/, '');

        let files: string[];
        try {
          files = await fs.readdir(dirPath);
        } catch {
          continue;
        }

        for (const file of files) {
          if (!UUID_PATTERN.test(file)) continue;

          const filePath = join(dirPath, file);
          let fileStat;
          try {
            fileStat = await fs.stat(filePath);
          } catch {
            continue;
          }

          if (fileStat.mtimeMs < cutoff) continue;

          const sessionId = file.replace('.jsonl', '');
          results.push({
            claudeSessionId: sessionId,
            projectPath,
            lastModified: fileStat.mtime,
            fileName: file,
          });
        }
      }

      // Sort by most recently modified first
      results.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
      return results;
    },
  };
}
