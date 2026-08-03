import type { Request, Response } from 'express';

import { asyncHandler, sendSuccess } from '../../utils';
import * as dashboardService from './dashboard.service';

export const stats = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await dashboardService.getStats());
});

export const recentOrders = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await dashboardService.recentOrders());
});
