import type { Context, NextFunction } from 'grammy';

export function createAuthMiddleware(allowedUserIds: number[]) {
  const allowedSet = new Set(allowedUserIds);

  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const userId = ctx.from?.id;

    if (!userId || !allowedSet.has(userId)) {
      console.warn(
        `[auth] Rejected message from unauthorized user: ${userId ?? 'unknown'}`
      );
      // Silent rejection — don't reveal the bot exists to unauthorized users
      return;
    }

    await next();
  };
}
