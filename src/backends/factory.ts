import type { CodingAdapter, BackendType } from './types.js';
import { createClaudeAdapter, type ClaudeAdapterConfig } from './claude/adapter.js';
import { createOpencodeAdapter, type OpencodeAdapterConfig } from './opencode/adapter.js';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';

export interface BackendFactoryConfig {
  backend: BackendType;
  // Claude-specific
  claudeModel?: string;
  canUseTool?: CanUseTool;
  allowedTools?: string[];
  // OpenCode-specific
  opencodeBaseUrl?: string;
  opencodeModel?: string;
  // Shared
  cwd?: string;
}

export function createAdapterForBackend(config: BackendFactoryConfig): CodingAdapter {
  switch (config.backend) {
    case 'opencode':
      return createOpencodeAdapter({
        baseUrl: config.opencodeBaseUrl,
        model: config.opencodeModel,
        cwd: config.cwd,
      });

    case 'claude':
      return createClaudeAdapter({
        model: config.claudeModel,
        cwd: config.cwd,
        canUseTool: config.canUseTool,
        allowedTools: config.allowedTools,
      });

    default: {
      const _exhaustive: never = config.backend;
      throw new Error(`Unknown backend type: ${String(_exhaustive)}`);
    }
  }
}
