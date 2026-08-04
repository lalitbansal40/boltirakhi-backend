import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { couponLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import {
  createCouponSchema,
  idParamSchema,
  listCouponQuerySchema,
  statusSchema,
  updateCouponSchema,
  validateCouponSchema,
} from './coupon.schema';
import * as couponController from './coupon.controller';

const router = Router();

// Mounted once for the whole router. Per-route guards are how one route ends
// up unprotected.
router.use(requireAuth, requireRole('admin'));

router.get('/', validate({ query: listCouponQuerySchema }), couponController.list);
router.post('/', validate({ body: createCouponSchema }), couponController.create);

router.get('/:id', validate({ params: idParamSchema }), couponController.getById);
router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateCouponSchema }),
  couponController.update,
);
router.patch(
  '/:id/status',
  validate({ params: idParamSchema, body: statusSchema }),
  couponController.setStatus,
);
router.delete('/:id', validate({ params: idParamSchema }), couponController.remove);

/**
 * Public, for the checkout. Mounted separately in app.ts, outside the admin
 * block — the same shape as the bolti reveal route.
 */
const publicRouter = Router();

publicRouter.post(
  '/validate',
  couponLimiter,
  validate({ body: validateCouponSchema }),
  couponController.validateForCart,
);

export { router as couponRoutes, publicRouter as publicCouponRoutes };
