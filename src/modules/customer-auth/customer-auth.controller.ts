import type { CookieOptions, Request, Response } from 'express';

import { isProduction } from '../../config/env';
import { SESSION_COOKIE } from '../../config/session';
import { User } from '../../models/User';
import { asyncHandler, sendSuccess } from '../../utils';
import { ApiError } from '../../utils/ApiError';
import * as otpService from './otp.service';
import type { RequestOtpInput, VerifyOtpInput } from './customer-auth.schema';

export { SESSION_COOKIE } from '../../config/session';

/**
 * The token lives in an httpOnly cookie, not localStorage.
 *
 * This is a shop: a stolen token is somebody else placing orders under a real
 * person's name and address. httpOnly puts it out of reach of any script that
 * manages to run on the page, which localStorage cannot do.
 */
function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // `lax` still sends the cookie when someone follows a link back into the
    // site, which `strict` does not — and a WhatsApp link is how much of this
    // site's traffic will arrive.
    sameSite: 'lax',
    // Must stay false in development: a `secure` cookie is never set over
    // plain http, so localhost would silently fail to log anyone in.
    secure: isProduction,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

/**
 * What the browser is allowed to know about the signed-in user.
 *
 * Not the whole document: `passwordHash`, `isBlocked` and the rest have no
 * business crossing the wire.
 */
function publicUser(user: { _id: unknown; name?: string; phone?: string; role: string }) {
  return {
    id: String(user._id),
    name: user.name ?? null,
    phone: user.phone ?? null,
    role: user.role,
  };
}

export const requestOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.body as RequestOtpInput;

  const result = await otpService.requestOtp(phone);

  // Deliberately says nothing about whether that number has an account —
  // an endpoint that answers differently for known and unknown numbers is a
  // way to enumerate customers.
  sendSuccess(res, result, 'Code sent');
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone, code } = req.body as VerifyOtpInput;

  const { user, token } = await otpService.verifyOtp(phone, code);

  res.cookie(SESSION_COOKIE, token, cookieOptions());

  // The user comes back with the cookie so the interface can render straight
  // away instead of bouncing off /me first.
  sendSuccess(res, { user: publicUser(user) }, 'Signed in');
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id).select('name phone role');

  if (!user) throw ApiError.unauthorized('Account no longer exists');

  sendSuccess(res, { user: publicUser(user) });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  // Cleared with the same options it was set with — a mismatch on path or
  // sameSite leaves the original cookie in place and the user still signed in.
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });

  sendSuccess(res, null, 'Signed out');
});

