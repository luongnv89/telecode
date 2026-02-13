import { v4 as uuidv4 } from 'uuid';
import type { AuditEvent, AuditEventBase } from '../types/audit.js';

function createBase(params: {
  sessionId: string;
  userId: number;
  chatId: number;
  claudeSessionId?: string;
}): AuditEventBase {
  return {
    timestamp: new Date().toISOString(),
    sessionId: params.sessionId,
    claudeSessionId: params.claudeSessionId,
    userId: params.userId,
    chatId: params.chatId,
    correlationId: uuidv4(),
  };
}

export function sessionStarted(params: {
  sessionId: string;
  userId: number;
  chatId: number;
  claudeSessionId?: string;
}): AuditEvent {
  return { ...createBase(params), event: 'session_started' };
}

export function sessionStopped(params: {
  sessionId: string;
  userId: number;
  chatId: number;
  claudeSessionId?: string;
}): AuditEvent {
  return { ...createBase(params), event: 'session_stopped' };
}

export function sessionReset(params: {
  sessionId: string;
  userId: number;
  chatId: number;
  claudeSessionId?: string;
}): AuditEvent {
  return { ...createBase(params), event: 'session_reset' };
}

export function commandReceived(params: {
  sessionId: string;
  userId: number;
  chatId: number;
  claudeSessionId?: string;
  commandType: string;
  rawText: string;
}): AuditEvent {
  return {
    ...createBase(params),
    event: 'command_received',
    commandType: params.commandType,
    rawText: params.rawText,
  };
}

export function outputSanitized(params: {
  sessionId: string;
  userId: number;
  chatId: number;
  claudeSessionId?: string;
  redactionCount: number;
}): AuditEvent {
  return {
    ...createBase(params),
    event: 'output_sanitized',
    redactionCount: params.redactionCount,
  };
}

export function outputDelivered(params: {
  sessionId: string;
  userId: number;
  chatId: number;
  claudeSessionId?: string;
  charCount: number;
}): AuditEvent {
  return {
    ...createBase(params),
    event: 'output_delivered',
    charCount: params.charCount,
  };
}

export function lockRejected(params: {
  sessionId: string;
  userId: number;
  chatId: number;
  reason: string;
}): AuditEvent {
  return {
    ...createBase(params),
    event: 'lock_rejected',
    reason: params.reason,
  };
}

export function errorOccurred(params: {
  sessionId: string;
  userId: number;
  chatId: number;
  claudeSessionId?: string;
  errorCode: string;
  errorMessage: string;
}): AuditEvent {
  return {
    ...createBase(params),
    event: 'error_occurred',
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
  };
}
