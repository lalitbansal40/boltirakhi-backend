import type { Request, Response } from 'express';
import { asyncHandler, sendSuccess } from '../../utils';
import * as authService from './auth.service';

// Controllers stay this thin on purpose: request in, service call, response
// out. The logic lives in the service so the public site can reuse it.

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body);
  sendSuccess(res, result);
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getMe(req.user!.id);
  sendSuccess(res, user);
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.changePassword(req.user!.id, req.body);
  sendSuccess(res, null, 'Password changed. Sign in again on your other devices.');
});

/**
 * Nothing server-side happens here. A JWT is stateless, so the token stays
 * valid until it expires — this only tells the client to discard it. Real
 * revocation would need a blacklist; the case that matters (a leaked
 * password) is covered by passwordChangedAt instead.
 */
export const logout = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, null, 'Signed out. Discard the token on the client.');
});
