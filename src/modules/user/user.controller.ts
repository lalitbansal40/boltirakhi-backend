import type { Request, Response } from 'express';

import { asyncHandler, sendSuccess } from '../../utils';
import type { ListUserQuery, UserOrdersQuery } from './user.schema';
import * as userService from './user.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await userService.list(req.validatedQuery as ListUserQuery));
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await userService.getById(req.params.id!));
});

export const listOrders = asyncHandler(async (req: Request, res: Response) => {
  const result = await userService.listOrders(
    req.params.id!,
    req.validatedQuery as UserOrdersQuery,
  );
  sendSuccess(res, result);
});

export const setBlocked = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.setBlocked(req.params.id!, req.body.isBlocked, req.user!.id);
  sendSuccess(res, user, req.body.isBlocked ? 'User blocked' : 'User unblocked');
});
