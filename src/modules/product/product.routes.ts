import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  createProductSchema,
  featureSchema,
  idParamSchema,
  listProductQuerySchema,
  priceSchema,
  statusSchema,
  stockSchema,
  updateProductSchema,
} from './product.schema';
import * as productController from './product.controller';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', validate({ query: listProductQuerySchema }), productController.list);
router.post('/', validate({ body: createProductSchema }), productController.create);

router.get('/:id', validate({ params: idParamSchema }), productController.getById);
router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateProductSchema }),
  productController.update,
);

// Inline edits from the product list.
router.patch(
  '/:id/price',
  validate({ params: idParamSchema, body: priceSchema }),
  productController.updatePrice,
);
router.patch(
  '/:id/stock',
  validate({ params: idParamSchema, body: stockSchema }),
  productController.updateStock,
);

router.patch(
  '/:id/status',
  validate({ params: idParamSchema, body: statusSchema }),
  productController.setStatus,
);
router.patch(
  '/:id/feature',
  validate({ params: idParamSchema, body: featureSchema }),
  productController.setFeatured,
);

router.delete('/:id', validate({ params: idParamSchema }), productController.remove);

export default router;
