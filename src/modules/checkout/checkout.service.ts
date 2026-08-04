import { Types } from 'mongoose';

import { Order, type IOrder } from '../../models/Order';
import { Product } from '../../models/Product';
import { incrementUsage } from '../coupon/coupon.service';
// The single source of truth for what a cart costs. The cart screen calls the
// same function, which is the only way the two can be guaranteed to agree.
import { priceCart } from '../pricing/pricing.service';
import { createRazorpayOrder, verifyPaymentSignature } from '../../services/razorpay';
import { nextOrderNumberWithRetry } from '../../utils/orderNumber';
import { ApiError } from '../../utils/ApiError';
import { notify } from '../../services/notify';
import type { CreateOrderInput, VerifyPaymentInput } from './checkout.schema';

/**
 * Checkout.
 *
 * Two rules run through everything below:
 *
 *   1. The browser is never trusted for money. Prices, discount and shipping
 *      are all read or computed server-side from the database.
 *   2. Stock moves when payment succeeds, not when the order is created (D10).
 *      Otherwise an abandoned checkout holds stock hostage — which in the week
 *      before Rakhi would empty the shop without selling anything.
 */

/**
 * Create an order and the Razorpay order that will pay for it.
 *
 * The row is written first, so a payment that succeeds always has somewhere to
 * land. An order with no payment is a recoverable mess; a payment with no
 * order is a customer whose money vanished.
 */
export async function createOrder(userId: string, input: CreateOrderInput) {
  // strict: at checkout a missing or short-stocked item stops everything. The
  // cart screen passes false, where the same problem is only marked on the line.
  const cart = await priceCart({ ...input, strict: true });

  const orderNumber = await nextOrderNumberWithRetry();

  const order = await Order.create({
    orderNumber,
    userId: new Types.ObjectId(userId),
    // In strict mode no line can carry an `issue`, so every line here is
    // payable and goes onto the order as-is.
    items: cart.lines,
    amount: {
      subtotalPaise: cart.subtotalPaise,
      shippingPaise: cart.shippingPaise,
      discountPaise: cart.discountPaise,
      taxPaise: 0,
      totalPaise: cart.totalPaise,
      currency: 'INR',
    },
    shippingAddress: input.shippingAddress,
    isInternational: input.shippingAddress.country.trim().toLowerCase() !== 'india',
    hasBolti: cart.hasBolti,
    couponId: cart.couponId,
    payment: { provider: 'razorpay', status: 'pending' },
    status: 'created',
    statusHistory: [{ status: 'created', at: new Date() }],
  });

  const razorpayOrder = await createRazorpayOrder({
    amountPaise: cart.totalPaise,
    receipt: orderNumber,
    notes: { orderId: String(order._id), orderNumber },
  });

  order.payment.orderId = razorpayOrder.id;
  await order.save();

  return {
    orderId: String(order._id),
    orderNumber,
    amount: order.amount,
    razorpayOrderId: razorpayOrder.id,
  };
}

/**
 * Everything that has to happen exactly once when a payment lands.
 *
 * Called from both the browser callback and the webhook, because either can
 * arrive first and either can be the only one that arrives. The guard is the
 * status check: a second call finds the order already paid and does nothing,
 * so stock is never decremented twice and a coupon is never counted twice.
 */
async function markPaid(order: IOrder, paymentId: string, signature?: string) {
  if (order.payment.status === 'paid') return false;

  // Stock comes off here — not at order creation. See D10 at the top.
  await Promise.all(
    order.items.map((item) =>
      Product.updateOne({ _id: item.productId }, { $inc: { stock: -item.qty } }),
    ),
  );

  if (order.couponId) await incrementUsage(order.couponId);

  order.payment.paymentId = paymentId;
  if (signature) order.payment.signature = signature;
  order.payment.status = 'paid';
  order.payment.paidAt = new Date();
  order.status = 'paid';
  order.statusHistory.push({ status: 'paid', at: new Date() });
  await order.save();

  // Fire and forget: notify() never throws, and a confirmation SMS that fails
  // must not undo a payment that succeeded.
  void notify('sms', {
    to: order.shippingAddress.phone,
    message: `Your Bolti Rakhi order ${order.orderNumber} is confirmed. We will let you know when it ships.`,
  });

  return true;
}

/**
 * The browser's word that the payment went through — checked, not believed.
 *
 * Without the signature check anyone could POST an invented payment id and
 * walk away with a free order.
 */
export async function verifyPayment(userId: string, input: VerifyPaymentInput) {
  const order = await Order.findOne({
    'payment.orderId': input.razorpayOrderId,
    userId: new Types.ObjectId(userId),
  });

  if (!order) {
    throw new ApiError(404, 'Order not found', 'ORDER_NOT_FOUND');
  }

  const valid = verifyPaymentSignature(input);

  if (!valid) {
    order.payment.status = 'failed';
    await order.save();
    throw new ApiError(400, 'Payment could not be verified', 'SIGNATURE_INVALID');
  }

  await markPaid(order, input.razorpayPaymentId, input.signature);

  return { orderId: String(order._id), orderNumber: order.orderNumber, status: order.status };
}

/**
 * The webhook — the signal that actually arrives every time.
 *
 * A customer can close the tab the instant they pay, in which case the
 * callback above never fires and this is the only thing that tells us money
 * moved. Signature is verified by the controller against the raw body.
 */
export async function handleWebhookEvent(event: {
  event?: string;
  payload?: { payment?: { entity?: { id?: string; order_id?: string; method?: string } } };
}) {
  const entity = event.payload?.payment?.entity;
  if (event.event !== 'payment.captured' || !entity?.order_id || !entity.id) {
    // Razorpay sends many event types. Anything we do not act on is still a
    // success as far as Razorpay is concerned — a non-2xx makes it retry for
    // days over an event we were never going to use.
    return { handled: false };
  }

  const order = await Order.findOne({ 'payment.orderId': entity.order_id });
  if (!order) return { handled: false };

  if (entity.method) order.payment.method = entity.method;

  const changed = await markPaid(order, entity.id);
  return { handled: true, changed };
}
