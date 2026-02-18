/**
 * Backward-compatibility shim.
 * The canonical message parser now lives at src/backends/claude/message-parser.ts.
 * This re-exports everything so existing imports continue to work.
 */
export {
  summarizeToolUse,
  extractTextFromAssistant,
  parseResultMessage,
  parseOutputChunks,
  parseOutputChunk,
} from '../backends/claude/message-parser.js';
export type { AdapterOutputChunk as ClaudeOutputChunk, AdapterResult as ClaudeResult } from '../backends/types.js';
