import { describe, it, expect } from 'vitest';
import { createSessionButtons, createStatusButtons, getKeyboardForEnvelope } from '../../src/telegram/keyboards.js';
import type { ResponseEnvelope } from '../../src/types/envelope.js';

describe('createSessionButtons', () => {
  it('returns an InlineKeyboard with 3 buttons', () => {
    const kb = createSessionButtons();
    // InlineKeyboard stores rows as a 2d array in .inline_keyboard
    const rows = kb.inline_keyboard;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(3);
    expect(rows[0][0]).toEqual({ text: 'Status', callback_data: 'action:status' });
    expect(rows[0][1]).toEqual({ text: 'Stop', callback_data: 'action:stop' });
    expect(rows[0][2]).toEqual({ text: 'New Session', callback_data: 'action:new_session' });
  });
});

describe('createStatusButtons', () => {
  it('returns an InlineKeyboard with 2 buttons (no Status)', () => {
    const kb = createStatusButtons();
    const rows = kb.inline_keyboard;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(2);
    expect(rows[0][0]).toEqual({ text: 'Stop', callback_data: 'action:stop' });
    expect(rows[0][1]).toEqual({ text: 'New Session', callback_data: 'action:new_session' });
  });
});

describe('getKeyboardForEnvelope', () => {
  it('returns undefined when no metadata', () => {
    const envelope: ResponseEnvelope = {
      type: 'result',
      text: 'hello',
      timestamp: new Date(),
    };
    expect(getKeyboardForEnvelope(envelope)).toBeUndefined();
  });

  it('returns undefined when showButtons is false', () => {
    const envelope: ResponseEnvelope = {
      type: 'result',
      text: 'hello',
      timestamp: new Date(),
      metadata: { showButtons: false },
    };
    expect(getKeyboardForEnvelope(envelope)).toBeUndefined();
  });

  it('returns full session buttons when showButtons=true and no buttonStyle', () => {
    const envelope: ResponseEnvelope = {
      type: 'result',
      text: 'hello',
      timestamp: new Date(),
      metadata: { showButtons: true },
    };
    const kb = getKeyboardForEnvelope(envelope);
    expect(kb).toBeDefined();
    expect(kb!.inline_keyboard[0]).toHaveLength(3);
  });

  it('returns full session buttons when buttonStyle=full', () => {
    const envelope: ResponseEnvelope = {
      type: 'result',
      text: 'hello',
      timestamp: new Date(),
      metadata: { showButtons: true, buttonStyle: 'full' },
    };
    const kb = getKeyboardForEnvelope(envelope);
    expect(kb).toBeDefined();
    expect(kb!.inline_keyboard[0]).toHaveLength(3);
  });

  it('returns status-only buttons when buttonStyle=status-only', () => {
    const envelope: ResponseEnvelope = {
      type: 'status',
      sessionActive: true,
      timestamp: new Date(),
      metadata: { showButtons: true, buttonStyle: 'status-only' },
    };
    const kb = getKeyboardForEnvelope(envelope);
    expect(kb).toBeDefined();
    expect(kb!.inline_keyboard[0]).toHaveLength(2);
  });

  it('works with ack envelope type', () => {
    const envelope: ResponseEnvelope = {
      type: 'ack',
      commandType: 'new_session',
      timestamp: new Date(),
      metadata: { showButtons: true, buttonStyle: 'status-only' },
    };
    const kb = getKeyboardForEnvelope(envelope);
    expect(kb).toBeDefined();
    expect(kb!.inline_keyboard[0]).toHaveLength(2);
  });

  it('returns undefined for error envelopes even without metadata', () => {
    const envelope: ResponseEnvelope = {
      type: 'error',
      code: 'INTERNAL_ERROR',
      message: 'fail',
      timestamp: new Date(),
    };
    expect(getKeyboardForEnvelope(envelope)).toBeUndefined();
  });
});
