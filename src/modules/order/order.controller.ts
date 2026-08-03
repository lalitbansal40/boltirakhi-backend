import type { Request, Response } from 'express';

import { asyncHandler, sendSuccess } from '../../utils';
import type { ExportOrderQuery, ListOrderQuery } from './order.schema';
import * as orderService from './order.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await orderService.list(req.validatedQuery as ListOrderQuery));
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await orderService.getById(req.params.id!));
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.updateStatus(req.params.id!, req.body, req.user!.id);
  sendSuccess(res, order, `Order marked ${req.body.status}`);
});

export const addNote = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.addNote(req.params.id!, req.body, req.user!.id);
  sendSuccess(res, order, 'Note added');
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.cancel(req.params.id!, req.body, req.user!.id);
  sendSuccess(res, order, 'Order cancelled');
});

export const updateShipping = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.updateShipping(req.params.id!, req.body);
  sendSuccess(res, order, 'Shipping details updated');
});

/** Streams as a download rather than going through the JSON envelope. */
export const exportCsv = asyncHandler(async (req: Request, res: Response) => {
  const csv = await orderService.exportCsv(req.validatedQuery as ExportOrderQuery);
  const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
});
