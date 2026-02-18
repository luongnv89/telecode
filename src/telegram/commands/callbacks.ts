import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { CommandHandlers } from './router.js';
import type { TelegramSender } from '../sender.js';
import type { ValidatedCommand } from '../../types/commands.js';
import type { BackendType } from '../../backends/types.js';
import type { SessionRegistry } from '../../session/registry.js';
import type { FocusManager } from '../../session/focus-manager.js';
import type { PermissionDecision } from '../permission-bridge.js';

const VALID_ACTIONS = ['status', 'stop', 'new_session'] as const;
type CallbackAction = (typeof VALID_ACTIONS)[number];

const VALID_PERM_DECISIONS = ['allow', 'deny', 'always_allow'] as const;

function parseCallbackData(data: string): CallbackAction | null {
  if (!data.startsWith('action:')) return null;
  const action = data.slice('action:'.length);
  if (VALID_ACTIONS.includes(action as CallbackAction)) {
    return action as CallbackAction;
  }
  return null;
}

function parsePermCallback(data: string): { decision: PermissionDecision; requestId: string } | null {
  if (!data.startsWith('perm:')) return null;
  const parts = data.slice('perm:'.length).split(':');
  // Format: perm:<decision>:<requestId>
  if (parts.length < 2) return null;

  // decision may be "always_allow" (contains underscore, not colon-separated)
  const requestId = parts[parts.length - 1];
  const decision = parts.slice(0, parts.length - 1).join('_');

  if (!VALID_PERM_DECISIONS.includes(decision as PermissionDecision)) return null;
  return { decision: decision as PermissionDecision, requestId };
}

function getWorkspaceDirs(workspace: string): string[] {
  try {
    return readdirSync(workspace, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

export interface CallbackDeps {
  handlers: CommandHandlers;
  sender: TelegramSender;
  sessionRegistry: SessionRegistry;
  focusManager: FocusManager;
  workspace?: string;
  allowedTools?: BackendType[];
}

export function registerCallbacks(
  bot: Bot,
  deps: CallbackDeps,
): void {
  const { handlers, sender, sessionRegistry, focusManager } = deps;

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const chatId = ctx.callbackQuery.message?.chat.id;

    if (!chatId) {
      await ctx.answerCallbackQuery({ text: 'Unable to determine chat' });
      return;
    }

    // Handle permission callbacks
    const permResult = parsePermCallback(data);
    if (permResult) {
      await ctx.answerCallbackQuery();

      const focusedSessionId = focusManager.getFocusedSessionId(userId);
      if (!focusedSessionId) {
        await sender.sendMessage(chatId, '⚠️ No focused session — permission request ignored.');
        return;
      }

      const entry = sessionRegistry.getEntry(focusedSessionId);
      if (!entry?.permissionBridge) {
        await sender.sendMessage(chatId, '⚠️ No permission bridge for this session.');
        return;
      }

      const resolved = entry.permissionBridge.resolvePermission(permResult.requestId, permResult.decision);
      if (resolved) {
        const label = permResult.decision === 'allow' ? '✅ Allowed'
          : permResult.decision === 'always_allow' ? '✅ Always Allowed'
          : '❌ Denied';
        await sender.sendMessage(chatId, `${label} — permission resolved.`);
      } else {
        await sender.sendMessage(chatId, '⚠️ Permission request already resolved or expired.');
      }
      return;
    }

    // Handle launch callbacks
    if (data.startsWith('launch:')) {
      await ctx.answerCallbackQuery();
      const workspace = deps.workspace;
      const allowedTools = deps.allowedTools ?? ['claude' as BackendType];

      if (!workspace) {
        await sender.sendMessage(chatId, '❌ Workspace not configured.');
        return;
      }

      if (data.startsWith('launch:f:')) {
        // Phase 1: folder selected → show tool selection or create session
        const folderIndex = parseInt(data.slice('launch:f:'.length), 10);
        const dirs = getWorkspaceDirs(workspace);

        if (isNaN(folderIndex) || folderIndex < 0 || folderIndex >= dirs.length) {
          await sender.sendMessage(chatId, '❌ Invalid folder selection. Please use /launch again.');
          return;
        }

        const folderName = dirs[folderIndex];

        if (allowedTools.length === 1) {
          // Only one tool — immediately create session
          const fullPath = resolve(workspace, folderName);
          const validated: ValidatedCommand = {
            command: {
              type: 'start_session',
              workingDir: fullPath,
              name: folderName,
              backend: allowedTools[0],
            },
            context: {
              userId,
              chatId,
              messageId: ctx.callbackQuery.message?.message_id ?? 0,
              timestamp: new Date(),
              rawText: `[launch:${folderName}:${allowedTools[0]}]`,
            },
          };

          const response = await handlers.start_session(validated);
          if (response) {
            await sender.sendResponse(chatId, response);
          }
        } else {
          // Multiple tools — show tool selection
          const keyboard = new InlineKeyboard();
          for (const tool of allowedTools) {
            keyboard.text(tool, `launch:t:${tool}:${folderIndex}`).row();
          }
          await sender.sendMessage(chatId, `Select a tool for ${folderName}:`, keyboard);
        }
        return;
      }

      if (data.startsWith('launch:t:')) {
        // Phase 2: tool selected → create session
        const rest = data.slice('launch:t:'.length);
        const lastColon = rest.lastIndexOf(':');
        if (lastColon === -1) {
          await sender.sendMessage(chatId, '❌ Invalid tool selection. Please use /launch again.');
          return;
        }

        const tool = rest.slice(0, lastColon) as BackendType;
        const folderIndex = parseInt(rest.slice(lastColon + 1), 10);

        if (!allowedTools.includes(tool)) {
          await sender.sendMessage(chatId, `❌ Tool "${tool}" is not in the allowed tools list.`);
          return;
        }

        const dirs = getWorkspaceDirs(workspace);
        if (isNaN(folderIndex) || folderIndex < 0 || folderIndex >= dirs.length) {
          await sender.sendMessage(chatId, '❌ Invalid folder selection. Please use /launch again.');
          return;
        }

        const folderName = dirs[folderIndex];
        const fullPath = resolve(workspace, folderName);

        const validated: ValidatedCommand = {
          command: {
            type: 'start_session',
            workingDir: fullPath,
            name: folderName,
            backend: tool,
          },
          context: {
            userId,
            chatId,
            messageId: ctx.callbackQuery.message?.message_id ?? 0,
            timestamp: new Date(),
            rawText: `[launch:${folderName}:${tool}]`,
          },
        };

        const response = await handlers.start_session(validated);
        if (response) {
          await sender.sendResponse(chatId, response);
        }
        return;
      }

      await sender.sendMessage(chatId, '❌ Unknown launch action.');
      return;
    }

    // Handle switch callbacks
    if (data.startsWith('switch:s:')) {
      await ctx.answerCallbackQuery();

      const sessionIndex = parseInt(data.slice('switch:s:'.length), 10);
      const focusedId = focusManager.getFocusedSessionId(userId);
      const sessionList = sessionRegistry.listSessions(focusedId);

      if (isNaN(sessionIndex) || sessionIndex < 0 || sessionIndex >= sessionList.length) {
        await sender.sendMessage(chatId, '❌ Invalid session selection. Use /switch again.');
        return;
      }

      const target = sessionList[sessionIndex];
      const validated: ValidatedCommand = {
        command: { type: 'switch_session', target: target.sessionId },
        context: {
          userId,
          chatId,
          messageId: ctx.callbackQuery.message?.message_id ?? 0,
          timestamp: new Date(),
          rawText: `[switch:${target.label}]`,
        },
      };

      const response = await handlers.switch_session(validated);
      if (response) {
        await sender.sendResponse(chatId, response);
      }
      return;
    }

    // Handle action callbacks
    const action = parseCallbackData(data);
    if (!action) {
      await ctx.answerCallbackQuery({ text: 'Unknown action' });
      return;
    }

    // Dismiss the loading animation immediately
    await ctx.answerCallbackQuery();

    // Create a synthetic ValidatedCommand from callback context
    const validated: ValidatedCommand = {
      command: { type: action },
      context: {
        userId,
        chatId,
        messageId: ctx.callbackQuery.message?.message_id ?? 0,
        timestamp: new Date(),
        rawText: `[button:${action}]`,
      },
    };

    const response = await handlers[action](validated);
    if (response) {
      await sender.sendResponse(chatId, response);
    }
  });
}
