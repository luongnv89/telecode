export type ErrorCode =
  | 'AUTH_DENIED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_LOCKED'
  | 'SESSION_TIMEOUT'
  | 'COMMAND_PARSE_ERROR'
  | 'COMMAND_VALIDATION_ERROR'
  | 'CLAUDE_ERROR'
  | 'CLAUDE_TIMEOUT'
  | 'TELEGRAM_SEND_ERROR'
  | 'INTERNAL_ERROR';

export type ResponseEnvelope =
  | { type: 'ack'; commandType: string; timestamp: Date }
  | { type: 'progress'; text: string; timestamp: Date }
  | { type: 'result'; text: string; timestamp: Date }
  | { type: 'error'; code: ErrorCode; message: string; timestamp: Date }
  | {
      type: 'status';
      sessionActive: boolean;
      sessionId?: string;
      state?: string;
      uptime?: number;
      locked?: boolean;
      lockOwnerUserId?: number;
      timestamp: Date;
    };

export function createAck(commandType: string): ResponseEnvelope {
  return { type: 'ack', commandType, timestamp: new Date() };
}

export function createProgress(text: string): ResponseEnvelope {
  return { type: 'progress', text, timestamp: new Date() };
}

export function createResult(text: string): ResponseEnvelope {
  return { type: 'result', text, timestamp: new Date() };
}

export function createError(code: ErrorCode, message: string): ResponseEnvelope {
  return { type: 'error', code, message, timestamp: new Date() };
}

export function createStatus(info: {
  sessionActive: boolean;
  sessionId?: string;
  state?: string;
  uptime?: number;
  locked?: boolean;
  lockOwnerUserId?: number;
}): ResponseEnvelope {
  return { type: 'status', ...info, timestamp: new Date() };
}
