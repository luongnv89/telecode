import { describe, it, expect, vi } from 'vitest';
import { createAdapterForBackend } from '../../src/backends/factory.js';

// Mock both adapter constructors so they don't need real SDKs
vi.mock('../../src/backends/claude/adapter.js', () => ({
  createClaudeAdapter: vi.fn((config: any) => ({
    backendType: 'claude' as const,
    _mockConfig: config,
    startSession: vi.fn(),
    attachSession: vi.fn(),
    sendPrompt: vi.fn(),
    stopSession: vi.fn(),
    resetSession: vi.fn(),
    getStatus: vi.fn(() => ({ state: 'idle' })),
  })),
}));

vi.mock('../../src/backends/opencode/adapter.js', () => ({
  createOpencodeAdapter: vi.fn((config: any) => ({
    backendType: 'opencode' as const,
    _mockConfig: config,
    startSession: vi.fn(),
    attachSession: vi.fn(),
    sendPrompt: vi.fn(),
    stopSession: vi.fn(),
    resetSession: vi.fn(),
    getStatus: vi.fn(() => ({ state: 'idle' })),
  })),
}));

describe('createAdapterForBackend', () => {
  it('creates a Claude adapter when backend is "claude"', () => {
    const adapter = createAdapterForBackend({
      backend: 'claude',
      claudeModel: 'claude-sonnet-4-20250514',
      cwd: '/project',
    });
    expect(adapter.backendType).toBe('claude');
  });

  it('creates an OpenCode adapter when backend is "opencode"', () => {
    const adapter = createAdapterForBackend({
      backend: 'opencode',
      opencodeBaseUrl: 'http://localhost:9000',
      opencodeModel: 'anthropic/claude-sonnet-4-20250514',
      cwd: '/project',
    });
    expect(adapter.backendType).toBe('opencode');
  });

  it('passes claude-specific config to the Claude adapter', async () => {
    const { createClaudeAdapter } = await import('../../src/backends/claude/adapter.js');
    vi.mocked(createClaudeAdapter).mockClear();

    createAdapterForBackend({
      backend: 'claude',
      claudeModel: 'test-model',
      cwd: '/my/dir',
      allowedTools: ['Read', 'Write'],
    });

    expect(createClaudeAdapter).toHaveBeenCalledWith({
      model: 'test-model',
      cwd: '/my/dir',
      canUseTool: undefined,
      allowedTools: ['Read', 'Write'],
    });
  });

  it('passes opencode-specific config to the OpenCode adapter', async () => {
    const { createOpencodeAdapter } = await import('../../src/backends/opencode/adapter.js');
    vi.mocked(createOpencodeAdapter).mockClear();

    createAdapterForBackend({
      backend: 'opencode',
      opencodeBaseUrl: 'http://custom:5000',
      opencodeModel: 'openai/gpt-4o',
      cwd: '/other/dir',
    });

    expect(createOpencodeAdapter).toHaveBeenCalledWith({
      baseUrl: 'http://custom:5000',
      model: 'openai/gpt-4o',
      cwd: '/other/dir',
    });
  });

  it('throws on unknown backend type', () => {
    expect(() =>
      createAdapterForBackend({
        backend: 'unknown' as any,
      }),
    ).toThrow('Unknown backend type');
  });
});
