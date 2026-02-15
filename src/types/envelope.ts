export type ErrorCode =
  | 'AUTH_DENIED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_LOCKED'
  | 'SESSION_TIMEOUT'
  | 'SESSION_LIMIT_EXCEEDED'
  | 'NO_FOCUSED_SESSION'
  | 'INVALID_WORKING_DIR'
  | 'COMMAND_PARSE_ERROR'
  | 'COMMAND_VALIDATION_ERROR'
  | 'CLAUDE_ERROR'
  | 'CLAUDE_TIMEOUT'
  | 'TELEGRAM_SEND_ERROR'
  | 'BOOKMARK_NOT_FOUND'
  | 'DISCOVERY_ERROR'
  | 'ATTACH_FAILED'
  | 'INTERNAL_ERROR';

export interface EnvelopeMetadata {
  showButtons?: boolean;
  buttonStyle?: 'full' | 'status-only';
  durationMs?: number;
  costUsd?: number;
}

export type ResponseEnvelope =
  | { type: 'ack'; commandType: string; timestamp: Date; metadata?: EnvelopeMetadata }
  | { type: 'progress'; text: string; timestamp: Date; metadata?: EnvelopeMetadata }
  | { type: 'result'; text: string; timestamp: Date; metadata?: EnvelopeMetadata }
  | { type: 'error'; code: ErrorCode; message: string; timestamp: Date; metadata?: EnvelopeMetadata }
  | {
      type: 'status';
      sessionActive: boolean;
      sessionId?: string;
      state?: string;
      uptime?: number;
      locked?: boolean;
      lockOwnerUserId?: number;
      timestamp: Date;
      metadata?: EnvelopeMetadata;
    };

export function createAck(commandType: string, metadata?: EnvelopeMetadata): ResponseEnvelope {
  return { type: 'ack', commandType, timestamp: new Date(), metadata };
}

export function createProgress(text: string, metadata?: EnvelopeMetadata): ResponseEnvelope {
  return { type: 'progress', text, timestamp: new Date(), metadata };
}

export function createResult(text: string, metadata?: EnvelopeMetadata): ResponseEnvelope {
  return { type: 'result', text, timestamp: new Date(), metadata };
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
}, metadata?: EnvelopeMetadata): ResponseEnvelope {
  return { type: 'status', ...info, timestamp: new Date(), metadata };
}
