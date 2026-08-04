import { Router } from 'express';
import { catalogLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import {
  listProductQuerySchema,
  searchQuerySchema,
  slugParamSchema,
} from './catalog.schema';
import * as catalogController from './catalog.controller';

/**
 * The storefront catalogue. Entirely public — a visitor browses before there
 * is any account to authenticate, so `requireAuth` must never reach these.
 * They are mounted in app.ts outside the admin block for that reason.
 */
const categoryRouter = Router();
categoryRouter.use(catalogLimiter);
categoryRouter.get('/', catalogController.listCategories);
categoryRouter.get('/:slug', validate({ params: slugParamSchema }), catalogController.getCategory);

const productRouter = Router();
productRouter.use(catalogLimiter);
productRouter.get('/', validate({ query: listProductQuerySchema }), catalogController.listProducts);
productRouter.get('/:slug', validate({ params: slugParamSchema }), catalogController.getProduct);

const searchRouter = Router();
searchRouter.use(catalogLimiter);
searchRouter.get('/', validate({ query: searchQuerySchema }), catalogController.search);

export {
  categoryRouter as publicCategoryRoutes,
  productRouter as publicProductRoutes,
  searchRouter as publicSearchRoutes,
};
