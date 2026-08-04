import type { Request, Response } from 'express';
import { asyncHandler, sendCreated, sendSuccess } from '../../utils';
import * as couponService from './coupon.service';
import type { ListCouponQuery } from './coupon.schema';

export const list = asyncHandler(async (req: Request, res: Response) => {
  // validatedQuery, not query — the raw one is all strings.
  const result = await couponService.list(req.validatedQuery as ListCouponQuery);
  sendSuccess(res, result);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await couponService.getById(req.params.id!);
  sendSuccess(res, coupon);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await couponService.create(req.body);
  sendCreated(res, coupon, 'Coupon created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await couponService.update(req.params.id!, req.body);
  sendSuccess(res, coupon, 'Coupon updated');
});

export const setStatus = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await couponService.setStatus(req.params.id!, req.body.isActive);
  sendSuccess(res, coupon, req.body.isActive ? 'Coupon activated' : 'Coupon deactivated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await couponService.remove(req.params.id!);
  sendSuccess(res, null, 'Coupon deleted');
});

/**
 * Public — the checkout calls this before creating an order.
 *
 * The response is a whitelist, not the document. `minOrderPaise`, `usedCount`
 * and the validity window are internal, and a public endpoint has no reason to
 * hand them out.
 */
export const validateForCart = asyncHandler(async (req: Request, res: Response) => {
  const { discountPaise, coupon } = await couponService.applyCoupon(
    req.body.code,
    req.body.subtotalPaise,
  );

  sendSuccess(res, {
    code: coupon.code,
    type: coupon.type,
    discountPaise,
  });
});
