import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { User } from '../models/User';
import { ApiError, asyncHandler } from '../utils';
import { extractBearerToken, verifyToken, type TokenRole } from '../utils/jwt';

/**
 * Verifies the bearer token and loads the user.
 *
 * The database read is deliberate. Trusting the token alone is faster, but a
 * blocked or deleted user would keep full access until the token expires seven
 * days later, and a role change would not take effect either. Admin traffic is
 * a handful of requests, and this is one indexed lookup.
 */
export const requireAuth: RequestHandler = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      throw ApiError.unauthorized('Authentication required');
    }

    // Throws JsonWebTokenError / TokenExpiredError; the error handler maps
    // both to 401 with a specific code.
    const payload = verifyToken(token);

    const user = await User.findById(payload.sub).select('_id role isBlocked');

    if (!user) {
      throw ApiError.unauthorized('Account no longer exists');
    }

    if (user.isBlocked) {
      throw new ApiError(403, 'This account has been blocked', 'USER_BLOCKED');
    }

    req.user = { id: String(user._id), role: user.role };
    next();
  },
);

/**
 * Must sit after `requireAuth`.
 *
 * Mount both once on the router (`router.use(requireAuth, requireRole('admin'))`)
 * rather than per route — one forgotten route is the whole guard.
 */
export function requireRole(...roles: TokenRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized('Authentication required'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(ApiError.forbidden('You do not have permission to do that'));
      return;
    }

    next();
  };
}
