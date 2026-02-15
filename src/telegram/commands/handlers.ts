import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ValidatedCommand } from '../../types/commands.js';
import {
  createAck,
  createStatus,
  createResult,
  createError,
  type ResponseEnvelope,
} from '../../types/envelope.js';
import type { TelegramSender } from '../sender.js';
import type { AuditWriter } from '../../audit/writer.js';
import type { SessionRegistry } from '../../session/registry.js';
import type { FocusManager } from '../../session/focus-manager.js';
import type { SessionPersistence } from '../../session/persistence.js';
import type { ResilienceMonitor } from '../../resilience/monitor.js';
import { TelecodeError } from '../../types/errors.js';
import type { CommandHandlers } from './router.js';
import type { BookmarkStore } from '../../session/bookmarks.js';
import type { SessionDiscovery } from '../../session/discovery.js';

export interface HandlerDeps {
  sessionRegistry: SessionRegistry;
  focusManager: FocusManager;
  persistence: SessionPersistence;
  sender: TelegramSender;
  auditWriter: AuditWriter;
  sessionTimeoutMs?: number;
  monitor?: ResilienceMonitor;
  bookmarkStore?: BookmarkStore;
  sessionDiscovery?: SessionDiscovery;
}

/** Resolve a path, expanding ~ to home directory. */
function resolvePath(inputPath: string): string {
  if (inputPath.startsWith('~')) {
    return resolve(homedir(), inputPath.slice(2));
  }
  return resolve(inputPath);
}

export function createCommandHandlers(deps: HandlerDeps): CommandHandlers {
  const { sessionRegistry, focusManager, persistence, sender, auditWriter, monitor, bookmarkStore, sessionDiscovery } = deps;

  async function safeAuditWrite(event: Parameters<AuditWriter['write']>[0], chatId?: number): Promise<void> {
    try {
      await auditWriter.write(event);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[audit] Write failure: ${error.message}`);
      if (monitor && chatId) {
        await monitor.notifyAuditWriteFailure(chatId, error);
      }
    }
  }

  function handleError(err: unknown): ResponseEnvelope {
    if (err instanceof TelecodeError) {
      const code = err.code === 'SESSION_NOT_FOUND' || err.code === 'SESSION_LOCKED'
        ? err.code
        : err.code === 'CLAUDE_ERROR' || err.code === 'CLAUDE_TIMEOUT'
          ? err.code
          : err.code === 'SESSION_LIMIT_EXCEEDED' || err.code === 'NO_FOCUSED_SESSION' || err.code === 'INVALID_WORKING_DIR'
            ? err.code
            : err.code === 'BOOKMARK_NOT_FOUND' || err.code === 'DISCOVERY_ERROR' || err.code === 'ATTACH_FAILED'
              ? err.code
              : 'INTERNAL_ERROR';
      return createError(code, err.message);
    }
    if (err instanceof Error) {
      return createError('INTERNAL_ERROR', err.message);
    }
    return createError('INTERNAL_ERROR', 'An unexpected error occurred');
  }

  function schedulePersist(): void {
    persistence.scheduleSave(sessionRegistry, focusManager);
  }

  return {
    async start_session(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        const { userId, chatId } = cmd.context;

        let workingDir: string;
        let name: string | undefined;

        if (cmd.command.type === 'start_session') {
          workingDir = cmd.command.workingDir
            ? resolvePath(cmd.command.workingDir)
            : process.cwd();
          name = cmd.command.name;
        } else {
          workingDir = process.cwd();
        }

        // Validate working directory exists
        if (!existsSync(workingDir)) {
          return createError(
            'INVALID_WORKING_DIR',
            `Working directory does not exist: ${workingDir}`,
          );
        }

        const session = await sessionRegistry.createSession(
          userId,
          chatId,
          workingDir,
          name,
        );

        // Auto-focus the new session
        focusManager.setFocus(userId, session.sessionId);

        await auditWriter.open(session.sessionId, session.startedAt);
        await safeAuditWrite({
          event: 'session_started',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          claudeSessionId: session.claudeSessionId,
          userId,
          chatId,
          correlationId: session.sessionId,
        }, chatId);
        await safeAuditWrite({
          event: 'lock_acquired',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          userId,
          chatId,
          correlationId: session.sessionId,
        }, chatId);

        schedulePersist();

        const displayName = name ? ` "${name}"` : '';
        const shortId = session.sessionId.slice(0, 8);
        return createResult(
          `Session${displayName} started [${shortId}] in ${workingDir}\n` +
          `Sessions: ${sessionRegistry.size}/${sessionRegistry.maxSessions}`,
          { showButtons: true },
        );
      } catch (err) {
        return handleError(err);
      }
    },

    async send(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'send') {
          return createError('INTERNAL_ERROR', 'Expected send command');
        }

        const { userId, chatId } = cmd.context;

        // Get focused session
        const sessionId = focusManager.getFocusedSessionId(userId);
        if (!sessionId) {
          return createError(
            'NO_FOCUSED_SESSION',
            'No focused session. Use /start_session to create one or /switch to select one.',
          );
        }

        const entry = sessionRegistry.getEntry(sessionId);
        if (!entry) {
          focusManager.clearFocus(userId);
          return createError('SESSION_NOT_FOUND', 'Focused session no longer exists.');
        }

        const session = entry.manager.getSession();
        if (!session || !entry.manager.isActive()) {
          return createError('SESSION_NOT_FOUND', 'Focused session is not active.');
        }

        // Check lock ownership
        const lockInfo = entry.lock.getLockInfo();
        if (!lockInfo || lockInfo.userId !== userId || lockInfo.chatId !== chatId) {
          return createError('SESSION_LOCKED', 'Session is owned by another connection.');
        }

        const { prompt } = cmd.command;
        entry.manager.updateState('busy');

        await safeAuditWrite({
          event: 'command_received',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          claudeSessionId: session.claudeSessionId,
          userId: session.userId,
          chatId: session.chatId,
          correlationId: session.sessionId,
          commandType: 'send',
          rawText: cmd.context.rawText,
        }, chatId);

        const result = await entry.adapter.sendPrompt(session.sessionId, prompt);

        entry.manager.updateState('active');

        await safeAuditWrite({
          event: 'output_delivered',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          claudeSessionId: session.claudeSessionId,
          userId: session.userId,
          chatId: session.chatId,
          correlationId: session.sessionId,
          charCount: result.text.length,
        }, chatId);

        if (!result.success) {
          return createError('CLAUDE_ERROR', result.text);
        }

        return createResult(result.text, { showButtons: true });
      } catch (err) {
        // Recover state on error
        const sessionId = focusManager.getFocusedSessionId(cmd.context.userId);
        if (sessionId) {
          const entry = sessionRegistry.getEntry(sessionId);
          if (entry) entry.manager.updateState('active');
        }

        if (monitor && err instanceof Error) {
          await monitor.notifySessionCrash(cmd.context.chatId, err);
        }

        return handleError(err);
      }
    },

    async status(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        const { userId } = cmd.context;
        const sessionId = focusManager.getFocusedSessionId(userId);

        if (!sessionId) {
          return createStatus({
            sessionActive: false,
            locked: false,
          });
        }

        const entry = sessionRegistry.getEntry(sessionId);
        if (!entry) {
          return createStatus({ sessionActive: false, locked: false });
        }

        const session = entry.manager.getSession();
        const claudeInfo = entry.adapter.getStatus();
        const lockInfo = entry.lock.getLockInfo();

        return createStatus({
          sessionActive: entry.manager.isActive(),
          sessionId: session?.sessionId,
          state: session?.state ?? claudeInfo.state,
          uptime: session ? Date.now() - session.startedAt.getTime() : undefined,
          locked: entry.lock.isLocked(),
          lockOwnerUserId: lockInfo?.userId,
        }, { showButtons: true, buttonStyle: 'status-only' });
      } catch (err) {
        return handleError(err);
      }
    },

    async stop(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        const { userId, chatId } = cmd.context;

        const sessionId = focusManager.getFocusedSessionId(userId);
        if (!sessionId) {
          return createError('NO_FOCUSED_SESSION', 'No focused session to stop.');
        }

        const entry = sessionRegistry.getEntry(sessionId);
        if (!entry) {
          focusManager.clearFocus(userId);
          return createAck('stop');
        }

        // Check lock ownership
        const lockInfo = entry.lock.getLockInfo();
        if (lockInfo && lockInfo.userId !== userId) {
          return createError('SESSION_LOCKED', 'Only the session owner can stop the session.');
        }

        const session = entry.manager.getSession();

        if (session) {
          await safeAuditWrite({
            event: 'session_stopped',
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
            claudeSessionId: session.claudeSessionId,
            userId: session.userId,
            chatId: session.chatId,
            correlationId: session.sessionId,
          }, session.chatId);

          entry.lock.release(session.sessionId);

          await safeAuditWrite({
            event: 'lock_released',
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
            userId: session.userId,
            chatId: session.chatId,
            correlationId: session.sessionId,
          }, session.chatId);
        }

        await sessionRegistry.removeSession(sessionId);
        focusManager.clearFocusForSession(sessionId);
        await auditWriter.close();

        schedulePersist();

        return createAck('stop');
      } catch (err) {
        return handleError(err);
      }
    },

    async claude_command(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'claude_command') {
          return createError('INTERNAL_ERROR', 'Expected claude_command');
        }

        const { userId, chatId } = cmd.context;

        const sessionId = focusManager.getFocusedSessionId(userId);
        if (!sessionId) {
          return createError('NO_FOCUSED_SESSION', 'No focused session. Use /start_session first.');
        }

        const entry = sessionRegistry.getEntry(sessionId);
        if (!entry) {
          return createError('SESSION_NOT_FOUND', 'No active session. Use /start_session first.');
        }

        const session = entry.manager.getSession();
        if (!session || !entry.manager.isActive()) {
          return createError('SESSION_NOT_FOUND', 'No active session. Use /start_session first.');
        }

        // Check lock ownership
        const lockInfo = entry.lock.getLockInfo();
        if (!lockInfo || lockInfo.userId !== userId || lockInfo.chatId !== chatId) {
          return createError('SESSION_LOCKED', 'Session is owned by another connection.');
        }

        const { ccCommand } = cmd.command;
        const prompt = `/${ccCommand}`;

        entry.manager.updateState('busy');

        await safeAuditWrite({
          event: 'command_received',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          claudeSessionId: session.claudeSessionId,
          userId: session.userId,
          chatId: session.chatId,
          correlationId: session.sessionId,
          commandType: `cc_${ccCommand}`,
          rawText: cmd.context.rawText,
        }, chatId);

        const result = await entry.adapter.sendPrompt(session.sessionId, prompt);

        entry.manager.updateState('active');

        await safeAuditWrite({
          event: 'output_delivered',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          claudeSessionId: session.claudeSessionId,
          userId: session.userId,
          chatId: session.chatId,
          correlationId: session.sessionId,
          charCount: result.text.length,
        }, chatId);

        if (!result.success) {
          return createError('CLAUDE_ERROR', result.text);
        }

        return createResult(result.text);
      } catch (err) {
        const sessionId = focusManager.getFocusedSessionId(cmd.context.userId);
        if (sessionId) {
          const entry = sessionRegistry.getEntry(sessionId);
          if (entry) entry.manager.updateState('active');
        }

        if (monitor && err instanceof Error) {
          await monitor.notifySessionCrash(cmd.context.chatId, err);
        }

        return handleError(err);
      }
    },

    async new_session(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        const { userId, chatId } = cmd.context;

        const sessionId = focusManager.getFocusedSessionId(userId);
        if (!sessionId) {
          return createError(
            'NO_FOCUSED_SESSION',
            'No focused session to reset. Use /start_session first.',
          );
        }

        const entry = sessionRegistry.getEntry(sessionId);
        if (!entry) {
          return createError('SESSION_NOT_FOUND', 'Focused session no longer exists.');
        }

        // Check lock ownership
        const lockInfo = entry.lock.getLockInfo();
        if (!lockInfo || lockInfo.userId !== userId || lockInfo.chatId !== chatId) {
          return createError('SESSION_LOCKED', 'Only the session owner can reset the session.');
        }

        const oldSession = entry.manager.getSession();

        if (oldSession) {
          await safeAuditWrite({
            event: 'session_reset',
            timestamp: new Date().toISOString(),
            sessionId: oldSession.sessionId,
            claudeSessionId: oldSession.claudeSessionId,
            userId: oldSession.userId,
            chatId: oldSession.chatId,
            correlationId: oldSession.sessionId,
          }, chatId);
          await auditWriter.close();
        }

        const newSession = await entry.manager.resetSession();
        entry.lock.acquire(userId, chatId, newSession.sessionId);

        // Update registry entry reference
        // (the SessionManager already updated internally, but we need to update
        // the focus to point to the new session ID if it changed)
        // Since resetSession creates a new session in the same manager,
        // the entry in the registry map still points to old ID.
        // We need to re-register under the new ID.
        sessionRegistry.getAllEntries().delete(sessionId);
        sessionRegistry.getAllEntries().set(newSession.sessionId, entry);
        focusManager.setFocus(userId, newSession.sessionId);

        await auditWriter.open(newSession.sessionId, newSession.startedAt);
        await safeAuditWrite({
          event: 'session_started',
          timestamp: new Date().toISOString(),
          sessionId: newSession.sessionId,
          claudeSessionId: newSession.claudeSessionId,
          userId,
          chatId,
          correlationId: newSession.sessionId,
        }, chatId);

        schedulePersist();

        return createAck('new_session', { showButtons: true, buttonStyle: 'status-only' });
      } catch (err) {
        return handleError(err);
      }
    },

    async list_sessions(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        const { userId } = cmd.context;
        const focusedId = focusManager.getFocusedSessionId(userId);
        const sessionList = sessionRegistry.listSessions(focusedId);

        if (sessionList.length === 0) {
          return createResult(
            'No active sessions.\nUse /start_session [path] [name] to create one.',
          );
        }

        const lines = sessionList.map((s, idx) => {
          const prefix = s.isFocused ? '>' : ' ';
          const nameStr = s.name ? ` (${s.name})` : '';
          const shortId = s.sessionId.slice(0, 8);
          return `${prefix} ${idx + 1}. [${shortId}]${nameStr} ${s.workingDirectory} [${s.state}]`;
        });

        const text =
          `Sessions (${sessionList.length}/${sessionRegistry.maxSessions}):\n\n` +
          lines.join('\n') +
          '\n\n> = focused session';

        return createResult(text, { showButtons: true });
      } catch (err) {
        return handleError(err);
      }
    },

    async switch_session(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'switch_session') {
          return createError('INTERNAL_ERROR', 'Expected switch_session command');
        }

        const { userId } = cmd.context;
        const { target } = cmd.command;

        // Find session by name or ID
        const targetId = sessionRegistry.findSessionId(target);
        if (!targetId) {
          return createError(
            'SESSION_NOT_FOUND',
            `No session found matching "${target}". Use /sessions to list available sessions.`,
          );
        }

        focusManager.setFocus(userId, targetId);
        schedulePersist();

        const entry = sessionRegistry.getEntry(targetId);
        const nameStr = entry?.name ? ` "${entry.name}"` : '';
        const shortId = targetId.slice(0, 8);

        return createResult(
          `Switched to session${nameStr} [${shortId}] in ${entry?.workingDirectory ?? 'unknown'}`,
        );
      } catch (err) {
        return handleError(err);
      }
    },

    async remove_session(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'remove_session') {
          return createError('INTERNAL_ERROR', 'Expected remove_session command');
        }

        const { userId, chatId } = cmd.context;
        const { target } = cmd.command;

        const targetId = sessionRegistry.findSessionId(target);
        if (!targetId) {
          return createError(
            'SESSION_NOT_FOUND',
            `No session found matching "${target}". Use /sessions to list available sessions.`,
          );
        }

        const entry = sessionRegistry.getEntry(targetId);
        if (!entry) {
          return createError('SESSION_NOT_FOUND', 'Session no longer exists.');
        }

        // Check lock ownership
        const lockInfo = entry.lock.getLockInfo();
        if (lockInfo && lockInfo.userId !== userId) {
          return createError('SESSION_LOCKED', 'Only the session owner can remove this session.');
        }

        const session = entry.manager.getSession();
        if (session) {
          await safeAuditWrite({
            event: 'session_stopped',
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
            claudeSessionId: session.claudeSessionId,
            userId: session.userId,
            chatId: session.chatId,
            correlationId: session.sessionId,
          }, chatId);
        }

        await sessionRegistry.removeSession(targetId);
        focusManager.clearFocusForSession(targetId);

        schedulePersist();

        const nameStr = entry.name ? ` "${entry.name}"` : '';
        return createResult(`Session${nameStr} [${targetId.slice(0, 8)}] removed.`);
      } catch (err) {
        return handleError(err);
      }
    },

    async discover(_cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (!sessionDiscovery) {
          return createError('DISCOVERY_ERROR', 'Session discovery is not configured.');
        }

        const discovered = await sessionDiscovery.scan();

        if (discovered.length === 0) {
          return createResult('No running Claude Code sessions discovered.');
        }

        const lines = discovered.map((d, idx) => {
          const shortId = d.claudeSessionId.slice(0, 8);
          const ago = Math.round((Date.now() - d.lastModified.getTime()) / 60000);
          return `  ${idx + 1}. [${shortId}] ${d.projectPath} (${ago}m ago)`;
        });

        return createResult(
          `Discovered ${discovered.length} session(s):\n\n${lines.join('\n')}\n\nUse /attach <number> to connect.`,
        );
      } catch (err) {
        return handleError(err);
      }
    },

    async attach(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'attach') {
          return createError('INTERNAL_ERROR', 'Expected attach command');
        }

        if (!sessionDiscovery) {
          return createError('DISCOVERY_ERROR', 'Session discovery is not configured.');
        }

        const { userId, chatId } = cmd.context;
        const { target } = cmd.command;

        const discovered = await sessionDiscovery.scan();
        if (discovered.length === 0) {
          return createError('ATTACH_FAILED', 'No discoverable sessions. Run /discover first.');
        }

        // Try as 1-based index first
        const idx = parseInt(target, 10);
        let match;
        if (!isNaN(idx) && idx >= 1 && idx <= discovered.length) {
          match = discovered[idx - 1];
        } else {
          // Try as session ID prefix
          match = discovered.find(d => d.claudeSessionId.startsWith(target));
        }

        if (!match) {
          return createError('ATTACH_FAILED', `No discovered session matching "${target}".`);
        }

        const session = await sessionRegistry.attachSession(
          userId,
          chatId,
          match.claudeSessionId,
          match.projectPath,
        );

        focusManager.setFocus(userId, session.sessionId);
        schedulePersist();

        const shortId = session.sessionId.slice(0, 8);
        return createResult(
          `Attached to session [${shortId}] in ${match.projectPath}\n` +
          `Sessions: ${sessionRegistry.size}/${sessionRegistry.maxSessions}`,
        );
      } catch (err) {
        return handleError(err);
      }
    },

    async cd(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'cd') {
          return createError('INTERNAL_ERROR', 'Expected cd command');
        }

        const { userId, chatId } = cmd.context;
        const targetPath = resolvePath(cmd.command.path);

        if (!existsSync(targetPath)) {
          return createError('INVALID_WORKING_DIR', `Directory does not exist: ${targetPath}`);
        }

        // Check if a session already exists for this directory
        for (const [id, entry] of sessionRegistry.getAllEntries()) {
          if (entry.workingDirectory === targetPath) {
            focusManager.setFocus(userId, id);
            schedulePersist();
            const nameStr = entry.name ? ` "${entry.name}"` : '';
            return createResult(`Switched to existing session${nameStr} [${id.slice(0, 8)}] in ${targetPath}`);
          }
        }

        // No existing session — create a new one
        const session = await sessionRegistry.createSession(userId, chatId, targetPath);
        focusManager.setFocus(userId, session.sessionId);
        schedulePersist();

        return createResult(
          `Created session [${session.sessionId.slice(0, 8)}] in ${targetPath}\n` +
          `Sessions: ${sessionRegistry.size}/${sessionRegistry.maxSessions}`,
        );
      } catch (err) {
        return handleError(err);
      }
    },

    async goto(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'goto') {
          return createError('INTERNAL_ERROR', 'Expected goto command');
        }

        // Delegate to switch_session logic
        const { userId } = cmd.context;
        const { target } = cmd.command;

        const targetId = sessionRegistry.findSessionId(target);
        if (!targetId) {
          // Try as 1-based index
          const idx = parseInt(target, 10);
          if (!isNaN(idx)) {
            const list = sessionRegistry.listSessions();
            if (idx >= 1 && idx <= list.length) {
              const targetSession = list[idx - 1];
              focusManager.setFocus(userId, targetSession.sessionId);
              schedulePersist();
              const nameStr = targetSession.name ? ` "${targetSession.name}"` : '';
              return createResult(
                `Switched to session${nameStr} [${targetSession.sessionId.slice(0, 8)}] in ${targetSession.workingDirectory}`,
              );
            }
          }
          return createError(
            'SESSION_NOT_FOUND',
            `No session found matching "${target}". Use /sessions to list available sessions.`,
          );
        }

        focusManager.setFocus(userId, targetId);
        schedulePersist();

        const entry = sessionRegistry.getEntry(targetId);
        const nameStr = entry?.name ? ` "${entry.name}"` : '';
        return createResult(
          `Switched to session${nameStr} [${targetId.slice(0, 8)}] in ${entry?.workingDirectory ?? 'unknown'}`,
        );
      } catch (err) {
        return handleError(err);
      }
    },

    async back(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        const { userId } = cmd.context;

        const previousId = focusManager.popFocus(userId);
        if (!previousId) {
          return createError('SESSION_NOT_FOUND', 'No previous session in history.');
        }

        schedulePersist();

        const entry = sessionRegistry.getEntry(previousId);
        const nameStr = entry?.name ? ` "${entry.name}"` : '';
        return createResult(
          `Returned to session${nameStr} [${previousId.slice(0, 8)}] in ${entry?.workingDirectory ?? 'unknown'}`,
        );
      } catch (err) {
        return handleError(err);
      }
    },

    async resume(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'resume') {
          return createError('INTERNAL_ERROR', 'Expected resume command');
        }

        const { userId, chatId } = cmd.context;
        const { target } = cmd.command;

        if (target) {
          // Resume a specific session by name or ID
          const targetId = sessionRegistry.findSessionId(target);
          if (!targetId) {
            return createError(
              'SESSION_NOT_FOUND',
              `No session found matching "${target}".`,
            );
          }
          focusManager.setFocus(userId, targetId);
          schedulePersist();
          const entry = sessionRegistry.getEntry(targetId);
          const nameStr = entry?.name ? ` "${entry.name}"` : '';
          return createResult(
            `Resumed session${nameStr} [${targetId.slice(0, 8)}] in ${entry?.workingDirectory ?? 'unknown'}`,
          );
        }

        // No target — resume the focused session or the most recent
        const focusedId = focusManager.getFocusedSessionId(userId);
        if (focusedId) {
          const entry = sessionRegistry.getEntry(focusedId);
          const nameStr = entry?.name ? ` "${entry.name}"` : '';
          return createResult(
            `Current session${nameStr} [${focusedId.slice(0, 8)}] is already active.`,
          );
        }

        // Try to find any available session
        const sessions = sessionRegistry.listSessions();
        if (sessions.length > 0) {
          const latest = sessions[0];
          focusManager.setFocus(userId, latest.sessionId);
          schedulePersist();
          const nameStr = latest.name ? ` "${latest.name}"` : '';
          return createResult(
            `Resumed session${nameStr} [${latest.sessionId.slice(0, 8)}] in ${latest.workingDirectory}`,
          );
        }

        return createError('SESSION_NOT_FOUND', 'No sessions available to resume. Use /start_session to create one.');
      } catch (err) {
        return handleError(err);
      }
    },

    async bookmark(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'bookmark') {
          return createError('INTERNAL_ERROR', 'Expected bookmark command');
        }

        if (!bookmarkStore) {
          return createError('INTERNAL_ERROR', 'Bookmark store is not configured.');
        }

        const { name, path } = cmd.command;
        const resolvedPath = resolvePath(path);

        if (!existsSync(resolvedPath)) {
          return createError('INVALID_WORKING_DIR', `Directory does not exist: ${resolvedPath}`);
        }

        bookmarkStore.add(name, resolvedPath);
        await bookmarkStore.save();

        return createResult(`Bookmark "${name}" saved → ${resolvedPath}`);
      } catch (err) {
        return handleError(err);
      }
    },

    async list_bookmarks(_cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (!bookmarkStore) {
          return createError('INTERNAL_ERROR', 'Bookmark store is not configured.');
        }

        const list = bookmarkStore.list();
        if (list.length === 0) {
          return createResult('No bookmarks saved.\nUse /bookmark <name> <path> to add one.');
        }

        const lines = list.map((b, idx) =>
          `  ${idx + 1}. ${b.name} → ${b.path}`,
        );

        return createResult(`Bookmarks (${list.length}):\n\n${lines.join('\n')}\n\nUse /open <name> to start a session.`);
      } catch (err) {
        return handleError(err);
      }
    },

    async open_bookmark(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'open_bookmark') {
          return createError('INTERNAL_ERROR', 'Expected open_bookmark command');
        }

        if (!bookmarkStore) {
          return createError('INTERNAL_ERROR', 'Bookmark store is not configured.');
        }

        const { userId, chatId } = cmd.context;
        const { name } = cmd.command;

        const bookmark = bookmarkStore.get(name);
        if (!bookmark) {
          return createError('BOOKMARK_NOT_FOUND', `No bookmark named "${name}". Use /bookmarks to list them.`);
        }

        if (!existsSync(bookmark.path)) {
          return createError('INVALID_WORKING_DIR', `Bookmarked directory no longer exists: ${bookmark.path}`);
        }

        // Check if a session already exists for this path
        for (const [id, entry] of sessionRegistry.getAllEntries()) {
          if (entry.workingDirectory === bookmark.path) {
            focusManager.setFocus(userId, id);
            schedulePersist();
            const nameStr = entry.name ? ` "${entry.name}"` : '';
            return createResult(`Switched to existing session${nameStr} [${id.slice(0, 8)}] in ${bookmark.path}`);
          }
        }

        const session = await sessionRegistry.createSession(userId, chatId, bookmark.path, name);
        focusManager.setFocus(userId, session.sessionId);
        schedulePersist();

        return createResult(
          `Session "${name}" started [${session.sessionId.slice(0, 8)}] in ${bookmark.path}\n` +
          `Sessions: ${sessionRegistry.size}/${sessionRegistry.maxSessions}`,
        );
      } catch (err) {
        return handleError(err);
      }
    },

    async unbookmark(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      try {
        if (cmd.command.type !== 'unbookmark') {
          return createError('INTERNAL_ERROR', 'Expected unbookmark command');
        }

        if (!bookmarkStore) {
          return createError('INTERNAL_ERROR', 'Bookmark store is not configured.');
        }

        const { name } = cmd.command;
        const removed = bookmarkStore.remove(name);

        if (!removed) {
          return createError('BOOKMARK_NOT_FOUND', `No bookmark named "${name}".`);
        }

        await bookmarkStore.save();
        return createResult(`Bookmark "${name}" removed.`);
      } catch (err) {
        return handleError(err);
      }
    },
  };
}
