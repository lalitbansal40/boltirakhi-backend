import { Router } from 'express';

import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as controller from './account.controller';
import {
  addressBodySchema,
  addressIdSchema,
  addressPatchSchema,
  profilePatchSchema,
} from './account.schema';

/**
 * The customer's own account data.
 *
 * Separate from `/api/users/*`, which is admin-only and stays that way. Mixing
 * them would mean one router where some routes must never be reachable by the
 * people the other routes are for.
 */
export const accountRoutes = Router();

accountRoutes.use(requireAuth, requireRole('customer'));

accountRoutes.get('/addresses', controller.list);

accountRoutes.post(
  '/addresses',
  validate({ body: addressBodySchema }),
  controller.create,
);

accountRoutes.patch(
  '/addresses/:id',
  validate({ params: addressIdSchema, body: addressPatchSchema }),
  controller.update,
);

accountRoutes.delete(
  '/addresses/:id',
  validate({ params: addressIdSchema }),
  controller.remove,
);

/**
 * The customer's own profile. Separate from /api/users, which is admin-only
 * and must stay that way.
 */
accountRoutes.patch(
  '/profile',
  validate({ body: profilePatchSchema }),
  controller.updateProfile,
);
