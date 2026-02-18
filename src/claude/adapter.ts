/**
 * Backward-compatibility shim.
 * The canonical adapter now lives at src/backends/claude/adapter.ts.
 * This re-exports everything so existing imports continue to work.
 */
export { createClaudeAdapter } from '../backends/claude/adapter.js';
export type { ClaudeAdapterConfig } from '../backends/claude/adapter.js';
export type { CodingAdapter as ClaudeAdapter } from '../backends/types.js';
export type { AdapterSessionInfo as ClaudeSessionInfo } from '../backends/types.js';
export type { AdapterOutputChunk as ClaudeOutputChunk, AdapterResult as ClaudeResult } from '../backends/types.js';
