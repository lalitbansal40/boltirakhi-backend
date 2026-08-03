import archiver from 'archiver';
import type { Request, Response } from 'express';

import { generateQrPng, generateQrSvg, qrFilename } from '../../services/qr';
import { asyncHandler, sendSuccess } from '../../utils';
import type { ListBoltiQuery, QrQuery } from './bolti.schema';
import * as boltiService from './bolti.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await boltiService.list(req.validatedQuery as ListBoltiQuery));
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await boltiService.getById(req.params.id!));
});

/** Streams the code itself, so it goes outside the JSON envelope. */
export const qr = asyncHandler(async (req: Request, res: Response) => {
  const { format = 'png', size } = req.validatedQuery as QrQuery;
  const { token, revealUrl, orderNumber } = await boltiService.getForQr(req.params.id!);

  if (format === 'svg') {
    const svg = await generateQrSvg(revealUrl);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${qrFilename(orderNumber, token, 'svg')}"`,
    );
    res.status(200).send(svg);
    return;
  }

  const png = await generateQrPng(revealUrl, size ? Number(size) : undefined);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${qrFilename(orderNumber, token, 'png')}"`,
  );
  res.status(200).send(png);
});

/** One ZIP for a print run. Capped by the schema at 200 codes. */
export const bulkQr = asyncHandler(async (req: Request, res: Response) => {
  const messages = await boltiService.getManyForQr(req.body.ids);

  const filename = `bolti-qr-${new Date().toISOString().slice(0, 10)}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });

  // Headers are already sent by the time an error can surface here, so the
  // response cannot be turned into a JSON error — destroy it instead and let
  // the client see a broken download rather than a silently truncated zip.
  archive.on('error', () => res.destroy());
  archive.pipe(res);

  for (const message of messages) {
    const png = await generateQrPng(message.revealUrl);
    archive.append(png, { name: qrFilename(message.orderNumber, message.token, 'png') });
  }

  await archive.finalize();
});

/** Public. No auth, and only whitelisted fields (D27). */
export const reveal = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await boltiService.reveal(req.params.token!));
});
