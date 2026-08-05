import { Router } from 'express';

import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as checkoutController from './checkout.controller';
import { createOrderSchema, orderNumberSchema, verifyPaymentSchema } from './checkout.schema';

/**
 * Customer-facing checkout.
 *
 * Both routes need a signed-in customer: an order has to belong to someone,
 * and `verify` looks the order up by user so one customer cannot confirm
 * another's payment by guessing a Razorpay order id.
 */
export const checkoutRoutes = Router();

checkoutRoutes.get('/payment-status', checkoutController.status);

checkoutRoutes.use(requireAuth, requireRole('customer'));

checkoutRoutes.post('/', validate({ body: createOrderSchema }), checkoutController.create);
checkoutRoutes.post(
  '/verify',
  validate({ body: verifyPaymentSchema }),
  checkoutController.verify,
);

/**
 * The webhook, on its own router.
 *
 * Mounted before the global rate limiter in app.ts, on purpose: Razorpay
 * bursts retries, and a 429 would make it back off and eventually give up on
 * telling us a customer paid.
 *
 * No auth either — the signature *is* the authentication.
 */
export const webhookRoutes = Router();

webhookRoutes.post('/razorpay', checkoutController.webhook);

/**
 * The customer's own list. Declared before /:orderNumber so a bare GET is
 * never read as an order number.
 */
checkoutRoutes.get('/', checkoutController.listMine);

/**
 * Placed after the two POST routes so `/verify` can never be read as an
 * order number.
 */
checkoutRoutes.get(
  '/:orderNumber',
  validate({ params: orderNumberSchema }),
  checkoutController.getOne,
);
