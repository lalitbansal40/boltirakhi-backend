import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { loginLimiter } from '../../middleware/rateLimit';
import { changePasswordSchema, loginSchema } from './auth.schema';
import * as authController from './auth.controller';

const router = Router();

// Not behind requireAuth, for obvious reasons — the limiter is what protects
// it, and it only counts failures.
router.post('/login', loginLimiter, validate({ body: loginSchema }), authController.login);

router.get('/me', requireAuth, authController.me);
router.post('/logout', requireAuth, authController.logout);
router.post(
  '/change-password',
  requireAuth,
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);

export default router;
