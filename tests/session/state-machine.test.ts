import { describe, it, expect, vi } from 'vitest';
import { SessionStateMachine } from '../../src/session/state-machine.js';
import type { SessionState } from '../../src/types/session.js';

describe('SessionStateMachine', () => {
  // ── getState ───────────────────────────────────────────────────────

  it('reports the initial state provided to the constructor', () => {
    const sm = new SessionStateMachine('idle');
    expect(sm.getState()).toBe('idle');
  });

  it('reports a non-idle initial state correctly', () => {
    const sm = new SessionStateMachine('active');
    expect(sm.getState()).toBe('active');
  });

  // ── canTransition ──────────────────────────────────────────────────

  describe('canTransition', () => {
    it('returns true for valid transitions from idle', () => {
      const sm = new SessionStateMachine('idle');
      expect(sm.canTransition('starting')).toBe(true);
    });

    it('returns false for invalid transitions from idle', () => {
      const sm = new SessionStateMachine('idle');
      expect(sm.canTransition('active')).toBe(false);
      expect(sm.canTransition('busy')).toBe(false);
      expect(sm.canTransition('stopping')).toBe(false);
      expect(sm.canTransition('resetting')).toBe(false);
      expect(sm.canTransition('idle')).toBe(false);
    });

    it('returns true for starting → active', () => {
      const sm = new SessionStateMachine('starting');
      expect(sm.canTransition('active')).toBe(true);
    });

    it('returns true for starting → idle (failure path)', () => {
      const sm = new SessionStateMachine('starting');
      expect(sm.canTransition('idle')).toBe(true);
    });

    it('returns true for active → busy', () => {
      const sm = new SessionStateMachine('active');
      expect(sm.canTransition('busy')).toBe(true);
    });

    it('returns true for active → stopping', () => {
      const sm = new SessionStateMachine('active');
      expect(sm.canTransition('stopping')).toBe(true);
    });

    it('returns true for active → resetting', () => {
      const sm = new SessionStateMachine('active');
      expect(sm.canTransition('resetting')).toBe(true);
    });

    it('returns true for busy → active', () => {
      const sm = new SessionStateMachine('busy');
      expect(sm.canTransition('active')).toBe(true);
    });

    it('returns true for busy → stopping', () => {
      const sm = new SessionStateMachine('busy');
      expect(sm.canTransition('stopping')).toBe(true);
    });

    it('returns true for stopping → idle', () => {
      const sm = new SessionStateMachine('stopping');
      expect(sm.canTransition('idle')).toBe(true);
    });

    it('returns true for resetting → starting', () => {
      const sm = new SessionStateMachine('resetting');
      expect(sm.canTransition('starting')).toBe(true);
    });

    it('returns false for any transition out of stopped', () => {
      const sm = new SessionStateMachine('stopped');
      const allStates: SessionState[] = [
        'idle', 'starting', 'active', 'busy', 'stopping', 'resetting', 'stopped',
      ];
      for (const state of allStates) {
        expect(sm.canTransition(state)).toBe(false);
      }
    });
  });

  // ── transition (valid) ─────────────────────────────────────────────

  describe('valid transitions', () => {
    it('idle → starting succeeds', () => {
      const sm = new SessionStateMachine('idle');
      sm.transition('starting');
      expect(sm.getState()).toBe('starting');
    });

    it('starting → active succeeds', () => {
      const sm = new SessionStateMachine('starting');
      sm.transition('active');
      expect(sm.getState()).toBe('active');
    });

    it('starting → idle succeeds (start failure)', () => {
      const sm = new SessionStateMachine('starting');
      sm.transition('idle');
      expect(sm.getState()).toBe('idle');
    });

    it('active → busy succeeds', () => {
      const sm = new SessionStateMachine('active');
      sm.transition('busy');
      expect(sm.getState()).toBe('busy');
    });

    it('busy → active succeeds', () => {
      const sm = new SessionStateMachine('busy');
      sm.transition('active');
      expect(sm.getState()).toBe('active');
    });

    it('active → stopping succeeds', () => {
      const sm = new SessionStateMachine('active');
      sm.transition('stopping');
      expect(sm.getState()).toBe('stopping');
    });

    it('busy → stopping succeeds', () => {
      const sm = new SessionStateMachine('busy');
      sm.transition('stopping');
      expect(sm.getState()).toBe('stopping');
    });

    it('stopping → idle succeeds', () => {
      const sm = new SessionStateMachine('stopping');
      sm.transition('idle');
      expect(sm.getState()).toBe('idle');
    });

    it('active → resetting succeeds', () => {
      const sm = new SessionStateMachine('active');
      sm.transition('resetting');
      expect(sm.getState()).toBe('resetting');
    });

    it('resetting → starting succeeds', () => {
      const sm = new SessionStateMachine('resetting');
      sm.transition('starting');
      expect(sm.getState()).toBe('starting');
    });
  });

  // ── transition (invalid) ──────────────────────────────────────────

  describe('invalid transitions throw descriptive errors', () => {
    it('throws when transitioning idle → active directly', () => {
      const sm = new SessionStateMachine('idle');
      expect(() => sm.transition('active')).toThrow(
        "Invalid state transition: cannot move from 'idle' to 'active'",
      );
    });

    it('throws when transitioning idle → busy', () => {
      const sm = new SessionStateMachine('idle');
      expect(() => sm.transition('busy')).toThrow(
        "Invalid state transition: cannot move from 'idle' to 'busy'",
      );
    });

    it('throws when transitioning active → idle directly', () => {
      const sm = new SessionStateMachine('active');
      expect(() => sm.transition('idle')).toThrow(
        "Invalid state transition: cannot move from 'active' to 'idle'",
      );
    });

    it('throws when transitioning active → starting', () => {
      const sm = new SessionStateMachine('active');
      expect(() => sm.transition('starting')).toThrow(
        "Invalid state transition: cannot move from 'active' to 'starting'",
      );
    });

    it('throws when transitioning stopping → active', () => {
      const sm = new SessionStateMachine('stopping');
      expect(() => sm.transition('active')).toThrow(
        "Invalid state transition: cannot move from 'stopping' to 'active'",
      );
    });

    it('does not change state on rejected transition', () => {
      const sm = new SessionStateMachine('idle');
      expect(() => sm.transition('busy')).toThrow();
      expect(sm.getState()).toBe('idle');
    });
  });

  // ── onTransition callback ─────────────────────────────────────────

  describe('onTransition listener', () => {
    it('fires the callback on a valid transition', () => {
      const sm = new SessionStateMachine('idle');
      const cb = vi.fn();
      sm.onTransition(cb);

      sm.transition('starting');

      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith('idle', 'starting');
    });

    it('does NOT fire the callback on a rejected transition', () => {
      const sm = new SessionStateMachine('idle');
      const cb = vi.fn();
      sm.onTransition(cb);

      expect(() => sm.transition('active')).toThrow();

      expect(cb).not.toHaveBeenCalled();
    });

    it('supports multiple listeners', () => {
      const sm = new SessionStateMachine('idle');
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      sm.onTransition(cb1);
      sm.onTransition(cb2);

      sm.transition('starting');

      expect(cb1).toHaveBeenCalledOnce();
      expect(cb1).toHaveBeenCalledWith('idle', 'starting');
      expect(cb2).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledWith('idle', 'starting');
    });

    it('fires listeners in registration order', () => {
      const sm = new SessionStateMachine('idle');
      const order: number[] = [];

      sm.onTransition(() => order.push(1));
      sm.onTransition(() => order.push(2));
      sm.onTransition(() => order.push(3));

      sm.transition('starting');

      expect(order).toEqual([1, 2, 3]);
    });

    it('fires for every transition in a sequence', () => {
      const sm = new SessionStateMachine('idle');
      const calls: Array<[SessionState, SessionState]> = [];
      sm.onTransition((from, to) => calls.push([from, to]));

      sm.transition('starting');
      sm.transition('active');
      sm.transition('busy');

      expect(calls).toEqual([
        ['idle', 'starting'],
        ['starting', 'active'],
        ['active', 'busy'],
      ]);
    });
  });

  // ── full lifecycle scenarios ──────────────────────────────────────

  describe('full lifecycle', () => {
    it('idle → starting → active → busy → active → stopping → idle', () => {
      const sm = new SessionStateMachine('idle');
      const transitions: Array<[SessionState, SessionState]> = [];
      sm.onTransition((from, to) => transitions.push([from, to]));

      sm.transition('starting');
      expect(sm.getState()).toBe('starting');

      sm.transition('active');
      expect(sm.getState()).toBe('active');

      sm.transition('busy');
      expect(sm.getState()).toBe('busy');

      sm.transition('active');
      expect(sm.getState()).toBe('active');

      sm.transition('stopping');
      expect(sm.getState()).toBe('stopping');

      sm.transition('idle');
      expect(sm.getState()).toBe('idle');

      expect(transitions).toEqual([
        ['idle', 'starting'],
        ['starting', 'active'],
        ['active', 'busy'],
        ['busy', 'active'],
        ['active', 'stopping'],
        ['stopping', 'idle'],
      ]);
    });

    it('reset lifecycle: active → resetting → starting → active', () => {
      const sm = new SessionStateMachine('active');
      const transitions: Array<[SessionState, SessionState]> = [];
      sm.onTransition((from, to) => transitions.push([from, to]));

      sm.transition('resetting');
      expect(sm.getState()).toBe('resetting');

      sm.transition('starting');
      expect(sm.getState()).toBe('starting');

      sm.transition('active');
      expect(sm.getState()).toBe('active');

      expect(transitions).toEqual([
        ['active', 'resetting'],
        ['resetting', 'starting'],
        ['starting', 'active'],
      ]);
    });

    it('stop during busy: idle → starting → active → busy → stopping → idle', () => {
      const sm = new SessionStateMachine('idle');

      sm.transition('starting');
      sm.transition('active');
      sm.transition('busy');
      sm.transition('stopping');
      sm.transition('idle');

      expect(sm.getState()).toBe('idle');
    });

    it('start failure: idle → starting → idle (retry) → starting → active', () => {
      const sm = new SessionStateMachine('idle');

      sm.transition('starting');
      sm.transition('idle'); // failure fallback
      sm.transition('starting'); // retry
      sm.transition('active');

      expect(sm.getState()).toBe('active');
    });
  });
});
