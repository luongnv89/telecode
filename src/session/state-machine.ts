import type { SessionState } from '../types/session.js';

/**
 * Map of valid state transitions. Each key is a source state, and the value
 * is the set of states it may transition to.
 */
const VALID_TRANSITIONS: Record<SessionState, ReadonlySet<SessionState>> = {
  idle: new Set<SessionState>(['starting']),
  starting: new Set<SessionState>(['active', 'idle']),
  active: new Set<SessionState>(['busy', 'stopping', 'resetting']),
  busy: new Set<SessionState>(['active', 'stopping']),
  stopping: new Set<SessionState>(['idle']),
  resetting: new Set<SessionState>(['starting']),
  stopped: new Set<SessionState>([]),
};

export type TransitionListener = (from: SessionState, to: SessionState) => void;

export class SessionStateMachine {
  private state: SessionState;
  private listeners: TransitionListener[] = [];

  constructor(initialState: SessionState) {
    this.state = initialState;
  }

  /** Return the current state. */
  getState(): SessionState {
    return this.state;
  }

  /** Check whether a transition from the current state to `to` is allowed. */
  canTransition(to: SessionState): boolean {
    return VALID_TRANSITIONS[this.state].has(to);
  }

  /**
   * Transition to a new state.
   *
   * @throws Error if the transition is not permitted by the state graph.
   */
  transition(to: SessionState): void {
    if (!this.canTransition(to)) {
      throw new Error(
        `Invalid state transition: cannot move from '${this.state}' to '${to}'`,
      );
    }

    const from = this.state;
    this.state = to;

    for (const listener of this.listeners) {
      listener(from, to);
    }
  }

  /**
   * Register a callback that fires after every successful transition.
   * Callbacks are invoked synchronously in registration order.
   */
  onTransition(callback: TransitionListener): void {
    this.listeners.push(callback);
  }
}
