import { Router } from 'express';

import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as controller from './bolti.customer.controller';
import {
  boltiTokenSchema,
  boltiUploadSchema,
  updateBoltiSchema,
} from './bolti.customer.schema';

/**
 * The sister recording her message.
 *
 * Separate from `/api/admin/bolti`, which lists and prints QR codes for the
 * whole shop. Same records, entirely different reasons to touch them.
 */
export const boltiCustomerRoutes = Router();

boltiCustomerRoutes.use(requireAuth, requireRole('customer'));

boltiCustomerRoutes.get('/:token', validate({ params: boltiTokenSchema }), controller.get);

boltiCustomerRoutes.patch(
  '/:token',
  validate({ params: boltiTokenSchema, body: updateBoltiSchema }),
  controller.update,
);

boltiCustomerRoutes.post(
  '/:token/video',
  validate({ params: boltiTokenSchema, body: boltiUploadSchema }),
  controller.videoUrl,
);

boltiCustomerRoutes.post(
  '/:token/photos',
  validate({ params: boltiTokenSchema, body: boltiUploadSchema }),
  controller.photoUrl,
);

boltiCustomerRoutes.post(
  '/:token/submit',
  validate({ params: boltiTokenSchema }),
  controller.submit,
);
