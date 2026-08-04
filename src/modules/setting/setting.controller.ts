import type { Request, Response } from 'express';
import { asyncHandler, sendSuccess } from '../../utils';
import * as settingService from './setting.service';

export const get = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await settingService.getSettings();
  sendSuccess(res, settings);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const settings = await settingService.updateSettings(req.body);
  sendSuccess(res, settings, 'Settings updated');
});
