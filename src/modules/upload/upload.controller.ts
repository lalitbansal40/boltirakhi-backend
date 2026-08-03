import type { Request, Response } from 'express';
import { asyncHandler, sendNoContent, sendSuccess } from '../../utils';
import * as uploadService from './upload.service';

export const presign = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await uploadService.presign(req.body));
});

export const readUrl = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await uploadService.readUrl(req.body));
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await uploadService.remove(req.body);
  sendNoContent(res);
});
