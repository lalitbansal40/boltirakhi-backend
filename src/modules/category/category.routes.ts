import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  createCategorySchema,
  idParamSchema,
  listCategoryQuerySchema,
  reorderSchema,
  statusSchema,
  updateCategorySchema,
} from './category.schema';
import * as categoryController from './category.controller';

const router = Router();

// Mounted once for the whole router. Per-route guards are how one route ends
// up unprotected.
router.use(requireAuth, requireRole('admin'));

router.get('/', validate({ query: listCategoryQuerySchema }), categoryController.list);
router.post('/', validate({ body: createCategorySchema }), categoryController.create);

// Before '/:id' — Express matches in order, and '/reorder' would otherwise be
// read as an id and fail to cast.
router.patch('/reorder', validate({ body: reorderSchema }), categoryController.reorder);

router.get('/:id', validate({ params: idParamSchema }), categoryController.getById);
router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateCategorySchema }),
  categoryController.update,
);
router.patch(
  '/:id/status',
  validate({ params: idParamSchema, body: statusSchema }),
  categoryController.setStatus,
);
router.delete('/:id', validate({ params: idParamSchema }), categoryController.remove);

export default router;
