import { describe, it, expect, vi } from 'vitest';
import { createAuthMiddleware } from '../../src/telegram/middleware/auth.js';

function createMockContext(userId?: number) {
  return {
    from: userId !== undefined ? { id: userId } : undefined,
  } as any;
}

describe('createAuthMiddleware', () => {
  it('allows authorized users', async () => {
    const middleware = createAuthMiddleware([123, 456]);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(createMockContext(123), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('allows second authorized user', async () => {
    const middleware = createAuthMiddleware([123, 456]);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(createMockContext(456), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects unauthorized users silently', async () => {
    const middleware = createAuthMiddleware([123]);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(createMockContext(999), next);

    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when ctx.from is undefined', async () => {
    const middleware = createAuthMiddleware([123]);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(createMockContext(undefined), next);

    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when ctx.from.id is missing', async () => {
    const middleware = createAuthMiddleware([123]);
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = { from: {} } as any;

    await middleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });

  it('works with empty allowlist (rejects all)', async () => {
    const middleware = createAuthMiddleware([]);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(createMockContext(123), next);

    expect(next).not.toHaveBeenCalled();
  });
});
