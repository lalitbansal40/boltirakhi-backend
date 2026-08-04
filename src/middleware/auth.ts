import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { User } from '../models/User';
import { ApiError, asyncHandler } from '../utils';
import { extractBearerToken, verifyToken, type TokenRole } from '../utils/jwt';
import { SESSION_COOKIE } from '../config/session';

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
    /**
     * Header first, cookie second.
     *
     * The admin panel signs in with a bearer token and has done since the
     * start; the storefront uses an httpOnly cookie. Checking the header first
     * keeps the admin path byte-for-byte unchanged, so adding customer login
     * cannot break the thing that was already working.
     */
    const token =
      extractBearerToken(req.headers.authorization) ??
      (req.cookies?.[SESSION_COOKIE] as string | undefined) ??
      null;

    if (!token) {
      throw ApiError.unauthorized('Authentication required');
    }

    // Throws JsonWebTokenError / TokenExpiredError; the error handler maps
    // both to 401 with a specific code.
    const payload = verifyToken(token);

    const user = await User.findById(payload.sub).select(
      '_id role isBlocked passwordChangedAt',
    );

    if (!user) {
      throw ApiError.unauthorized('Account no longer exists');
    }

    if (user.isBlocked) {
      throw new ApiError(403, 'This account has been blocked', 'USER_BLOCKED');
    }

    // A JWT cannot be recalled, so a password change has to invalidate the
    // tokens that predate it — otherwise changing a leaked password leaves the
    // attacker signed in until expiry.
    //
    // iat is in seconds; the 1s slack covers a token minted in the same second
    // the password was written.
    if (user.passwordChangedAt && payload.iat) {
      const issuedAtMs = payload.iat * 1000;
      if (issuedAtMs < user.passwordChangedAt.getTime() - 1000) {
        throw new ApiError(401, 'Password was changed, please sign in again', 'TOKEN_STALE');
      }
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
