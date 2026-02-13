import type { ValidatedCommand } from '../../types/commands.js';
import {
  createAck,
  createStatus,
  createResult,
  createError,
  type ResponseEnvelope,
} from '../../types/envelope.js';
import type { ClaudeAdapter } from '../../claude/adapter.js';
import type { TelegramSender } from '../sender.js';
import type { AuditWriter } from '../../audit/writer.js';
import type { CommandHandlers } from './router.js';

export interface HandlerDeps {
  claudeAdapter: ClaudeAdapter;
  sender: TelegramSender;
  auditWriter: AuditWriter;
}

export function createCommandHandlers(deps: HandlerDeps): CommandHandlers {
  const { claudeAdapter, sender } = deps;

  return {
    async start_session(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      // Stub: will be wired to real session management in Wave 2
      return createAck('start_session');
    },

    async send(cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      if (cmd.command.type !== 'send') {
        return createError('INTERNAL_ERROR', 'Expected send command');
      }
      // Stub: will delegate to claude adapter in Wave 2
      return createResult(`Echo: ${cmd.command.prompt}`);
    },

    async status(_cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      const info = claudeAdapter.getStatus();
      return createStatus({
        sessionActive: info.state !== 'idle',
        sessionId: info.sessionId,
        state: info.state,
      });
    },

    async stop(_cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      // Stub: will stop real session in Wave 2
      return createAck('stop');
    },

    async new_session(_cmd: ValidatedCommand): Promise<ResponseEnvelope> {
      // Stub: will reset session in Wave 2
      return createAck('new_session');
    },
  };
}
