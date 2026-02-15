import { v4 as uuidv4 } from 'uuid';
import { createClaudeAdapter, type ClaudeAdapter, type ClaudeSessionConfig } from '../claude/adapter.js';
import { SessionManager } from '../claude/session-manager.js';
import { createLockManager, type LockManager } from '../lock/manager.js';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionBridge } from '../telegram/permission-bridge.js';
import type { Session, SessionState } from '../types/session.js';

export interface PermissionHandlerResult {
  canUseTool: CanUseTool;
  bridge: PermissionBridge;
}

export type PermissionHandlerFactory = (chatId: number) => PermissionHandlerResult;

export interface RegistryEntry {
  manager: SessionManager;
  adapter: ClaudeAdapter;
  lock: LockManager;
  workingDirectory: string;
  name?: string;
  permissionBridge?: PermissionBridge;
}

export interface SessionRegistryConfig {
  maxSessions: number;
  claudeModel?: string;
}

export interface SessionListItem {
  sessionId: string;
  name?: string;
  workingDirectory: string;
  state: SessionState;
  startedAt: Date;
  isFocused: boolean;
}

export class SessionRegistry {
  private entries: Map<string, RegistryEntry> = new Map();
  private config: SessionRegistryConfig;
  private permissionHandlerFactory?: PermissionHandlerFactory;

  constructor(config: SessionRegistryConfig) {
    this.config = config;
  }

  setPermissionHandlerFactory(factory: PermissionHandlerFactory): void {
    this.permissionHandlerFactory = factory;
  }

  get maxSessions(): number {
    return this.config.maxSessions;
  }

  get size(): number {
    return this.entries.size;
  }

  async createSession(
    userId: number,
    chatId: number,
    workingDirectory: string,
    name?: string,
  ): Promise<Session> {
    if (this.entries.size >= this.config.maxSessions) {
      throw new Error(
        `Maximum ${this.config.maxSessions} concurrent sessions reached. ` +
        `Use /stop or /remove to free a slot.`,
      );
    }

    // Check for duplicate names
    if (name) {
      for (const entry of this.entries.values()) {
        if (entry.name === name) {
          throw new Error(`A session named "${name}" already exists. Choose a different name.`);
        }
      }
    }

    let permissionBridge: PermissionBridge | undefined;
    let canUseTool: CanUseTool | undefined;

    if (this.permissionHandlerFactory) {
      const result = this.permissionHandlerFactory(chatId);
      canUseTool = result.canUseTool;
      permissionBridge = result.bridge;
    }

    const adapter = createClaudeAdapter({
      model: this.config.claudeModel,
      cwd: workingDirectory,
      canUseTool,
    });
    const manager = new SessionManager(adapter);
    const lock = createLockManager();

    const session = await manager.startSession(userId, chatId, workingDirectory, name);

    lock.acquire(userId, chatId, session.sessionId);

    this.entries.set(session.sessionId, {
      manager,
      adapter,
      lock,
      workingDirectory,
      name,
      permissionBridge,
    });

    return session;
  }

  /** Resume a session by attaching to an existing Claude session ID. */
  async resumeSession(
    userId: number,
    chatId: number,
    workingDirectory: string,
    claudeSessionId: string,
    name?: string,
  ): Promise<Session> {
    if (this.entries.size >= this.config.maxSessions) {
      throw new Error(
        `Maximum ${this.config.maxSessions} concurrent sessions reached. ` +
        `Use /stop or /remove to free a slot.`,
      );
    }

    if (name) {
      for (const entry of this.entries.values()) {
        if (entry.name === name) {
          throw new Error(`A session named "${name}" already exists. Choose a different name.`);
        }
      }
    }

    let permissionBridge: PermissionBridge | undefined;
    let canUseTool: CanUseTool | undefined;

    if (this.permissionHandlerFactory) {
      const result = this.permissionHandlerFactory(chatId);
      canUseTool = result.canUseTool;
      permissionBridge = result.bridge;
    }

    const adapter = createClaudeAdapter({
      model: this.config.claudeModel,
      cwd: workingDirectory,
      canUseTool,
    });
    const manager = new SessionManager(adapter);
    const lock = createLockManager();

    const session = await manager.resumeSession(userId, chatId, workingDirectory, claudeSessionId, name);

    lock.acquire(userId, chatId, session.sessionId);

    this.entries.set(session.sessionId, {
      manager,
      adapter,
      lock,
      workingDirectory,
      name,
      permissionBridge,
    });

    return session;
  }

  /** Attach to a discovered Claude session by its ID. */
  async attachSession(
    userId: number,
    chatId: number,
    claudeSessionId: string,
    projectPath: string,
    name?: string,
  ): Promise<Session> {
    return this.resumeSession(userId, chatId, projectPath, claudeSessionId, name);
  }

  getEntry(sessionId: string): RegistryEntry | undefined {
    return this.entries.get(sessionId);
  }

  getSession(sessionId: string): Session | null {
    const entry = this.entries.get(sessionId);
    return entry?.manager.getSession() ?? null;
  }

  /** Find session by name (case-insensitive) or by sessionId prefix. */
  findSession(target: string): RegistryEntry | undefined {
    // Try exact sessionId match first
    const exact = this.entries.get(target);
    if (exact) return exact;

    // Try name match (case-insensitive)
    for (const [, entry] of this.entries) {
      if (entry.name && entry.name.toLowerCase() === target.toLowerCase()) {
        return entry;
      }
    }

    // Try sessionId prefix match
    for (const [id, entry] of this.entries) {
      if (id.startsWith(target)) {
        return entry;
      }
    }

    return undefined;
  }

  /** Find the sessionId for a given target (name or ID prefix). */
  findSessionId(target: string): string | undefined {
    if (this.entries.has(target)) return target;

    for (const [id, entry] of this.entries) {
      if (entry.name && entry.name.toLowerCase() === target.toLowerCase()) {
        return id;
      }
    }

    for (const [id] of this.entries) {
      if (id.startsWith(target)) {
        return id;
      }
    }

    return undefined;
  }

  listSessions(focusedSessionId?: string): SessionListItem[] {
    const items: SessionListItem[] = [];

    for (const [id, entry] of this.entries) {
      const session = entry.manager.getSession();
      if (session) {
        items.push({
          sessionId: session.sessionId,
          name: entry.name,
          workingDirectory: entry.workingDirectory,
          state: session.state,
          startedAt: session.startedAt,
          isFocused: id === focusedSessionId,
        });
      }
    }

    return items;
  }

  async removeSession(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId);
    if (!entry) return;

    entry.permissionBridge?.cancelAll();

    if (entry.manager.isActive()) {
      await entry.manager.stopSession();
    }
    entry.lock.forceRelease();
    this.entries.delete(sessionId);
  }

  async removeAllSessions(): Promise<void> {
    for (const [id] of this.entries) {
      await this.removeSession(id);
    }
  }

  getAllEntries(): Map<string, RegistryEntry> {
    return this.entries;
  }
}
