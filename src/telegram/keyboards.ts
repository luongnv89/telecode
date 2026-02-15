import { InlineKeyboard } from 'grammy';
import type { ResponseEnvelope } from '../types/envelope.js';

/** Full button set: Status, Stop, New Session */
export function createSessionButtons(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Status', 'action:status')
    .text('Stop', 'action:stop')
    .text('New Session', 'action:new_session');
}

/** Status-only button set: Stop, New Session (already viewing status) */
export function createStatusButtons(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Stop', 'action:stop')
    .text('New Session', 'action:new_session');
}

/** Returns the appropriate keyboard for an envelope, or undefined if no buttons. */
export function getKeyboardForEnvelope(envelope: ResponseEnvelope): InlineKeyboard | undefined {
  const metadata = envelope.metadata;
  if (!metadata?.showButtons) return undefined;

  if (metadata.buttonStyle === 'status-only') {
    return createStatusButtons();
  }
  return createSessionButtons();
}
