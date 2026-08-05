import type { Request, Response } from 'express';

import { asyncHandler, sendSuccess } from '../../utils';
import type { IBoltiMessage } from '../../models/BoltiMessage';
import * as service from './bolti.customer.service';
import type { BoltiUploadInput, UpdateBoltiInput } from './bolti.customer.schema';

/**
 * What the sister's own screen may see.
 *
 * The S3 keys go out because her page needs to ask for a signed read; nothing
 * about the order, the user or the QR file does.
 */
function toDraft(message: IBoltiMessage) {
  return {
    token: message.token,
    status: message.status,
    letterText: message.letterText ?? null,
    senderName: message.senderName ?? null,
    receiverName: message.receiverName ?? null,
    hasVideo: Boolean(message.videoKey),
    photoCount: message.photos.length,
    revealUrl: message.status === 'ready' ? message.revealUrl : null,
  };
}

export const get = asyncHandler(async (req: Request, res: Response) => {
  const message = await service.getDraft(req.params.token, req.user!.id);
  sendSuccess(res, { bolti: toDraft(message) });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const message = await service.updateDraft(
    req.params.token,
    req.user!.id,
    req.body as UpdateBoltiInput,
  );
  sendSuccess(res, { bolti: toDraft(message) }, 'Saved');
});

export const videoUrl = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.presignVideo(
    req.params.token,
    req.user!.id,
    req.body as BoltiUploadInput,
  );
  sendSuccess(res, result);
});

export const photoUrl = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.presignPhoto(
    req.params.token,
    req.user!.id,
    req.body as BoltiUploadInput,
  );
  sendSuccess(res, result);
});

export const submit = asyncHandler(async (req: Request, res: Response) => {
  const message = await service.submitDraft(req.params.token, req.user!.id);
  sendSuccess(res, { bolti: toDraft(message) }, 'Your message is ready');
});
