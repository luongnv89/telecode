/**
 * Permission bridge: async bridge between SDK canUseTool callbacks and Telegram inline buttons.
 *
 * When the SDK asks for permission, a deferred promise is created and a Telegram message
 * with Allow/Deny/Always Allow buttons is sent to the user. The user's button tap resolves
 * the promise, unblocking the SDK.
 */

import { InlineKeyboard } from 'grammy';
import { randomUUID } from 'node:crypto';
import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { summarizeToolUse } from '../claude/message-parser.js';

export interface PermissionBridgeConfig {
  chatId: number;
  sendMessage: (chatId: number, text: string, keyboard: InlineKeyboard) => Promise<void>;
  timeoutMs?: number;
}

export type PermissionDecision = 'allow' | 'deny' | 'always_allow';

interface DeferredPermission {
  resolve: (result: PermissionResult) => void;
  toolName: string;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  toolUseID: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface PermissionBridge {
  canUseTool: CanUseTool;
  resolvePermission(requestId: string, decision: PermissionDecision): boolean;
  cancelAll(): void;
  pendingCount(): number;
}

export function createPermissionBridge(config: PermissionBridgeConfig): PermissionBridge {
  const { chatId, sendMessage, timeoutMs = 60_000 } = config;
  const pending = new Map<string, DeferredPermission>();

  const canUseTool: CanUseTool = async (toolName, input, options) => {
    const requestId = randomUUID().slice(0, 8);

    const summary = summarizeToolUse(toolName, input);
    const reason = options.decisionReason ? `\nReason: ${options.decisionReason}` : '';
    const text = `🔐 Permission requested\n\nTool: ${summary}${reason}\n\nAllow this action?`;

    const keyboard = new InlineKeyboard()
      .text('✅ Allow', `perm:allow:${requestId}`)
      .text('❌ Deny', `perm:deny:${requestId}`)
      .row()
      .text('✅ Always Allow', `perm:always_allow:${requestId}`);

    const promise = new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => {
        if (pending.delete(requestId)) {
          resolve({
            behavior: 'deny',
            message: 'Permission request timed out (no response within timeout).',
          });
        }
      }, timeoutMs);

      pending.set(requestId, {
        resolve,
        toolName,
        input,
        suggestions: options.suggestions,
        toolUseID: options.toolUseID,
        timer,
      });
    });

    // Listen for abort signal
    if (options.signal) {
      const onAbort = () => {
        const entry = pending.get(requestId);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(requestId);
          entry.resolve({
            behavior: 'deny',
            message: 'Operation aborted.',
            interrupt: true,
          });
        }
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      await sendMessage(chatId, text, keyboard);
    } catch {
      // If we can't send the Telegram message, auto-deny
      const entry = pending.get(requestId);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(requestId);
        return {
          behavior: 'deny',
          message: 'Failed to send permission request to Telegram.',
        };
      }
    }

    return promise;
  };

  function resolvePermission(requestId: string, decision: PermissionDecision): boolean {
    const entry = pending.get(requestId);
    if (!entry) return false;

    clearTimeout(entry.timer);
    pending.delete(requestId);

    switch (decision) {
      case 'allow':
        entry.resolve({
          behavior: 'allow',
          updatedInput: entry.input,
          toolUseID: entry.toolUseID,
        });
        break;

      case 'always_allow':
        entry.resolve({
          behavior: 'allow',
          updatedInput: entry.input,
          updatedPermissions: entry.suggestions,
          toolUseID: entry.toolUseID,
        });
        break;

      case 'deny':
        entry.resolve({
          behavior: 'deny',
          message: 'User denied permission.',
          interrupt: true,
        });
        break;
    }

    return true;
  }

  function cancelAll(): void {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({
        behavior: 'deny',
        message: 'Session stopped — permission request cancelled.',
        interrupt: true,
      });
    }
    pending.clear();
  }

  function pendingCount(): number {
    return pending.size;
  }

  return { canUseTool, resolvePermission, cancelAll, pendingCount };
}
