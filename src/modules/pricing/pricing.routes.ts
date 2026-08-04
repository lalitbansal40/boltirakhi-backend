import { Router } from 'express';

import { cartLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import * as pricingController from './pricing.controller';
import { priceCartSchema } from './pricing.schema';

/**
 * Cart pricing.
 *
 * Public, with no auth at all — and that is the point. Shoppers fill a cart
 * before they have an account; asking them to log in first loses half of them
 * before they ever see a total.
 */
export const pricingRoutes = Router();

pricingRoutes.post(
  '/price',
  cartLimiter,
  validate({ body: priceCartSchema }),
  pricingController.price,
);
