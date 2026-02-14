export type TelecodeErrorCode =
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
  | 'AUDIT_WRITE_ERROR'
  | 'CONFIG_ERROR'
  | 'BOOKMARK_NOT_FOUND'
  | 'DISCOVERY_ERROR'
  | 'ATTACH_FAILED'
  | 'INTERNAL_ERROR';

export class TelecodeError extends Error {
  readonly code: TelecodeErrorCode;
  readonly recoverable: boolean;
  readonly cause?: Error;

  constructor(
    message: string,
    code: TelecodeErrorCode,
    options?: { recoverable?: boolean; cause?: Error }
  ) {
    super(message);
    this.name = 'TelecodeError';
    this.code = code;
    this.recoverable = options?.recoverable ?? false;
    this.cause = options?.cause;
  }
}
