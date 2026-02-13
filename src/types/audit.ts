export interface AuditEventBase {
  timestamp: string;
  sessionId: string;
  claudeSessionId?: string;
  userId: number;
  chatId: number;
  correlationId: string;
}

export type AuditEvent =
  | AuditEventBase & { event: 'session_started' }
  | AuditEventBase & { event: 'session_stopped' }
  | AuditEventBase & { event: 'session_reset' }
  | AuditEventBase & { event: 'command_received'; commandType: string; rawText: string }
  | AuditEventBase & { event: 'output_sanitized'; redactionCount: number }
  | AuditEventBase & { event: 'output_delivered'; charCount: number }
  | AuditEventBase & { event: 'lock_rejected'; reason: string }
  | AuditEventBase & { event: 'error_occurred'; errorCode: string; errorMessage: string };
