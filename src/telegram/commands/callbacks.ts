import type { Bot } from 'grammy';
import type { CommandHandlers } from './router.js';
import type { TelegramSender } from '../sender.js';
import type { ValidatedCommand } from '../../types/commands.js';
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

export interface CallbackDeps {
  handlers: CommandHandlers;
  sender: TelegramSender;
  sessionRegistry: SessionRegistry;
  focusManager: FocusManager;
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
