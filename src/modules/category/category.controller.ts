import type { Request, Response } from 'express';
import { asyncHandler, sendCreated, sendSuccess } from '../../utils';
import * as categoryService from './category.service';
import type { ListCategoryQuery } from './category.schema';

export const list = asyncHandler(async (req: Request, res: Response) => {
  // validatedQuery, not query — the raw one is all strings.
  const result = await categoryService.list(req.validatedQuery as ListCategoryQuery);
  sendSuccess(res, result);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoryService.getById(req.params.id!);
  sendSuccess(res, category);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoryService.create(req.body);
  sendCreated(res, category, 'Category created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoryService.update(req.params.id!, req.body);
  sendSuccess(res, category, 'Category updated');
});

export const setStatus = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoryService.setStatus(req.params.id!, req.body.isActive);
  sendSuccess(res, category, req.body.isActive ? 'Category activated' : 'Category deactivated');
});

export const reorder = asyncHandler(async (req: Request, res: Response) => {
  const modified = await categoryService.reorder(req.body);
  sendSuccess(res, { modified }, 'Order updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await categoryService.softDelete(req.params.id!);
  sendSuccess(res, null, 'Category deleted');
});
