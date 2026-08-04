import { Router } from 'express';

import { requireAuth } from '../../middleware/auth';
import { otpLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import * as controller from './customer-auth.controller';
import { requestOtpSchema, verifyOtpSchema } from './customer-auth.schema';

/**
 * Customer sign-in, entirely separate from `/api/admin/auth`.
 *
 * Different credential, different role, different threat: an admin logs in
 * with a password we chose, a customer with a code we pay to send. Sharing a
 * router would mean sharing rate limits that suit neither.
 */
export const customerAuthRoutes = Router();

// The IP limiter sits only on the endpoint that costs money to call.
customerAuthRoutes.post(
  '/otp/request',
  otpLimiter,
  validate({ body: requestOtpSchema }),
  controller.requestOtp,
);

customerAuthRoutes.post(
  '/otp/verify',
  validate({ body: verifyOtpSchema }),
  controller.verifyOtp,
);

customerAuthRoutes.get('/me', requireAuth, controller.me);

// No requireAuth: signing out with an expired cookie should clear it, not 401.
customerAuthRoutes.post('/logout', controller.logout);
