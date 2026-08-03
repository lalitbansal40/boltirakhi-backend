import { Router } from 'express';

import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as orderController from './order.controller';
import {
  addNoteSchema,
  cancelOrderSchema,
  exportOrderQuerySchema,
  idParamSchema,
  listOrderQuerySchema,
  updateShippingSchema,
  updateStatusSchema,
} from './order.schema';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', validate({ query: listOrderQuerySchema }), orderController.list);

// Must be declared before `/:id`. Express takes the first match, so with the
// order reversed "export" is read as an order id and Mongo throws a CastError.
router.get('/export', validate({ query: exportOrderQuerySchema }), orderController.exportCsv);

router.get('/:id', validate({ params: idParamSchema }), orderController.getById);

router.patch(
  '/:id/status',
  validate({ params: idParamSchema, body: updateStatusSchema }),
  orderController.updateStatus,
);
router.post(
  '/:id/note',
  validate({ params: idParamSchema, body: addNoteSchema }),
  orderController.addNote,
);
router.post(
  '/:id/cancel',
  validate({ params: idParamSchema, body: cancelOrderSchema }),
  orderController.cancel,
);

// Manual AWB entry until C.6 (Shiprocket) exists.
router.patch(
  '/:id/shipping',
  validate({ params: idParamSchema, body: updateShippingSchema }),
  orderController.updateShipping,
);

export default router;
