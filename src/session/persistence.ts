import { promises as fs } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { PersistedRegistryState, SessionMetadata } from '../types/session.js';
import type { SessionRegistry } from './registry.js';
import type { FocusManager } from './focus-manager.js';

const PERSISTENCE_VERSION = 4;

export interface PersistenceConfig {
  filePath: string;
}

export class SessionPersistence {
  private config: PersistenceConfig;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;

  constructor(config: PersistenceConfig) {
    this.config = config;
  }

  /** Load persisted state from disk. Returns null if file doesn't exist. */
  async load(): Promise<PersistedRegistryState | null> {
    try {
      const json = await fs.readFile(this.config.filePath, 'utf-8');
      const state = JSON.parse(json) as PersistedRegistryState;

      // v1→v2 migration: additive (claudeSessionId field is optional)
      if (state.version === 1) {
        console.log('[persistence] Migrating v1 → v2 (adding optional claudeSessionId)');
        state.version = 2;
      }

      // v2→v3 migration: add backendType and backendSessionId
      if (state.version === 2) {
        console.log('[persistence] Migrating v2 → v3 (adding backendType + backendSessionId)');
        for (const s of state.sessions) {
          if (!s.backendType) {
            s.backendType = 'claude';
          }
          if (!s.backendSessionId && s.claudeSessionId) {
            s.backendSessionId = s.claudeSessionId;
          }
        }
        state.version = 3;
      }

      // v3→v4 migration: add label
      if (state.version === 3) {
        console.log('[persistence] Migrating v3 → v4 (adding session label)');
        for (const s of state.sessions) {
          if (!s.label) {
            const bt = s.backendType ?? 'claude';
            s.label = s.name
              ? `${s.name}/${bt}`
              : `${basename(s.workingDirectory)}/${bt}`;
          }
        }
        state.version = 4;
      }

      if (state.version !== PERSISTENCE_VERSION) {
        console.warn(
          `[persistence] Ignoring state file with version ${state.version} (expected ${PERSISTENCE_VERSION})`,
        );
        return null;
      }

      return state;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      console.error(`[persistence] Failed to load session state: ${err}`);
      return null;
    }
  }

  /** Save current state to disk. */
  async save(registry: SessionRegistry, focusManager: FocusManager): Promise<void> {
    if (this.saving) return;
    this.saving = true;

    try {
      const sessions: SessionMetadata[] = [];

      for (const [id, entry] of registry.getAllEntries()) {
        const session = entry.manager.getSession();
        if (session) {
          sessions.push({
            sessionId: session.sessionId,
            backendSessionId: session.backendSessionId ?? session.claudeSessionId,
            claudeSessionId: session.claudeSessionId ?? session.backendSessionId,
            name: entry.name,
            workingDirectory: entry.workingDirectory,
            userId: session.userId,
            chatId: session.chatId,
            startedAt: session.startedAt.toISOString(),
            lastActivityAt: session.lastActivityAt.toISOString(),
            backendType: session.backendType ?? entry.backendType ?? 'claude',
            label: entry.label,
          });
        }
      }

      const state: PersistedRegistryState = {
        sessions,
        focusMap: focusManager.getFocusMap(),
        version: PERSISTENCE_VERSION,
      };

      const dir = dirname(this.config.filePath);
      await fs.mkdir(dir, { recursive: true });

      const json = JSON.stringify(state, null, 2);
      await fs.writeFile(this.config.filePath, json, 'utf-8');
    } catch (err) {
      console.error(`[persistence] Failed to save session state: ${err}`);
    } finally {
      this.saving = false;
    }
  }

  /** Schedule a debounced save (1 second). */
  scheduleSave(registry: SessionRegistry, focusManager: FocusManager): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.save(registry, focusManager).catch((err) => {
        console.error(`[persistence] Debounced save failed: ${err}`);
      });
    }, 1000);
  }

  /** Cancel any pending save. */
  cancelPendingSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }
}
