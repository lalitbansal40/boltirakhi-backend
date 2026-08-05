import type { Request, Response } from 'express';

import { asyncHandler, sendSuccess } from '../../utils';
import { ApiError } from '../../utils/ApiError';
import { verifyWebhookSignature } from '../../services/razorpay';
import { paymentStatus } from '../../config/payment';
import type { IOrder } from '../../models/Order';
import { BoltiMessage } from '../../models/BoltiMessage';
import * as checkoutService from './checkout.service';
import type { CreateOrderInput, VerifyPaymentInput } from './checkout.schema';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const order = await checkoutService.createOrder(
    req.user!.id,
    req.body as CreateOrderInput,
  );
  sendSuccess(res, order, 'Order created', 201);
});

export const verify = asyncHandler(async (req: Request, res: Response) => {
  const result = await checkoutService.verifyPayment(
    req.user!.id,
    req.body as VerifyPaymentInput,
  );
  sendSuccess(res, result, 'Payment verified');
});

/**
 * What the checkout screen reads to decide whether to show its TEST banner.
 *
 * Deliberately public and deliberately thin: a mode and a boolean, never a key.
 */
export const status = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, paymentStatus());
});

export const webhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.get('x-razorpay-signature');
  const rawBody = req.rawBody;

  if (!signature || !rawBody) {
    throw new ApiError(400, 'Missing webhook signature', 'WEBHOOK_UNSIGNED');
  }

  // Verified against the raw bytes, not req.body — re-serialising the JSON
  // changes key order and whitespace, and every signature would then fail.
  if (!verifyWebhookSignature(rawBody, signature)) {
    throw new ApiError(400, 'Invalid webhook signature', 'WEBHOOK_SIGNATURE_INVALID');
  }

  const result = await checkoutService.handleWebhookEvent(req.body);

  // Always 200 once the signature checks out. Razorpay retries for days on a
  // non-2xx, and an event we chose not to act on is not a failure.
  sendSuccess(res, result);
});

/**
 * What the confirmation page is allowed to see.
 *
 * Built field by field rather than sending the document. `payment.signature`
 * and `payment.orderId` are what verification is built on, `userId` is nobody's
 * business, and a serializer that lists what goes out cannot leak a field
 * somebody adds to the model later.
 */
function toPublicOrder(order: IOrder) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.payment.status,
    paidAt: order.payment.paidAt ?? null,
    placedAt: order.createdAt,
    hasBolti: order.hasBolti,
    items: order.items.map((item) => ({
      title: item.title,
      slug: item.slug,
      image: item.image,
      pricePaise: item.pricePaise,
      qty: item.qty,
      type: item.type,
    })),
    amount: {
      subtotalPaise: order.amount.subtotalPaise,
      shippingPaise: order.amount.shippingPaise,
      discountPaise: order.amount.discountPaise,
      totalPaise: order.amount.totalPaise,
      currency: order.amount.currency,
    },
    shippingAddress: {
      name: order.shippingAddress.name,
      phone: order.shippingAddress.phone,
      line1: order.shippingAddress.line1,
      line2: order.shippingAddress.line2,
      city: order.shippingAddress.city,
      state: order.shippingAddress.state,
      pincode: order.shippingAddress.pincode,
      country: order.shippingAddress.country,
    },
    tracking: {
      awb: order.shipping.awb ?? null,
      courierName: order.shipping.courierName ?? null,
      trackingUrl: order.shipping.trackingUrl ?? null,
    },
  };
}

/**
 * The bolti tokens on this order, so the confirmation page can link straight
 * to the recorder.
 *
 * Safe to include: the order was already proved to belong to this customer,
 * and these are her own messages.
 */
async function boltiTokensFor(order: IOrder): Promise<Record<string, string>> {
  const ids = order.items
    .map((item) => item.boltiMessageId)
    .filter((id): id is NonNullable<typeof id> => Boolean(id));

  if (ids.length === 0) return {};

  const messages = await BoltiMessage.find({ _id: { $in: ids } }).select('token status');

  return Object.fromEntries(messages.map((m) => [String(m._id), m.token]));
}

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const order = await checkoutService.getOwnOrder(req.user!.id, req.params.orderNumber);
  const boltiTokens = await boltiTokensFor(order);

  sendSuccess(res, {
    order: {
      ...toPublicOrder(order),
      boltiTokens: Object.values(boltiTokens),
    },
  });
});

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  const result = await checkoutService.listOwnOrders(
    req.user!.id,
    (req.validatedQuery ?? req.query) as Record<string, unknown>,
  );
  sendSuccess(res, result);
});
