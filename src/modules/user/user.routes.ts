import { Router } from 'express';

import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as userController from './user.controller';
import {
  blockSchema,
  idParamSchema,
  listUserQuerySchema,
  userOrdersQuerySchema,
} from './user.schema';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', validate({ query: listUserQuerySchema }), userController.list);

router.get('/:id', validate({ params: idParamSchema }), userController.getById);
router.get(
  '/:id/orders',
  validate({ params: idParamSchema, query: userOrdersQuerySchema }),
  userController.listOrders,
);

router.patch(
  '/:id/block',
  validate({ params: idParamSchema, body: blockSchema }),
  userController.setBlocked,
);

export default router;
