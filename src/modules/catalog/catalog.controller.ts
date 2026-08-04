import type { Request, Response } from 'express';
import { asyncHandler, sendSuccess } from '../../utils';
import * as catalogService from './catalog.service';
import type { ListProductQuery, SearchQuery } from './catalog.schema';

export const listCategories = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await catalogService.listCategories());
});

export const getCategory = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await catalogService.getCategoryBySlug(req.params.slug!));
});

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  // validatedQuery, not query — the raw one is all strings.
  sendSuccess(res, await catalogService.listProducts(req.validatedQuery as ListProductQuery));
});

export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await catalogService.getProductBySlug(req.params.slug!));
});

export const search = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await catalogService.search(req.validatedQuery as SearchQuery));
});
