import type { Request, Response } from 'express';
import { asyncHandler, sendCreated, sendSuccess } from '../../utils';
import * as productService from './product.service';
import type { ListProductQuery } from './product.schema';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await productService.list(req.validatedQuery as ListProductQuery);
  sendSuccess(res, result);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await productService.getById(req.params.id!));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  sendCreated(res, await productService.create(req.body), 'Product created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await productService.update(req.params.id!, req.body), 'Product updated');
});

export const updatePrice = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await productService.updatePrice(req.params.id!, req.body), 'Price updated');
});

export const updateStock = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await productService.updateStock(req.params.id!, req.body), 'Stock updated');
});

export const setStatus = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.setStatus(req.params.id!, req.body.isActive);
  sendSuccess(res, product, req.body.isActive ? 'Product activated' : 'Product deactivated');
});

export const setFeatured = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.setFeatured(req.params.id!, req.body.isFeatured);
  sendSuccess(res, product, req.body.isFeatured ? 'Product featured' : 'Product unfeatured');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await productService.softDelete(req.params.id!);
  sendSuccess(res, null, 'Product deleted');
});
