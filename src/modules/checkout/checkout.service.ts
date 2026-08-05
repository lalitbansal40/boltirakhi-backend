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
import { buildPaginated, parsePagination } from '../../utils';
import { notify } from '../../services/notify';
import { orderConfirmationEmail } from '../../services/notify/templates/order-confirmation';
import { SUPPORT_PHONE } from '../../config/business';
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
    customerEmail: input.customerEmail,
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

  /**
   * Stock comes off here — not at order creation. See D10 at the top.
   *
   * 🔴 In rakhis, not in lines: two packs of 8 take sixteen. Decrementing by
   * qty alone would sell eight and record one, and the shelf count would drift
   * quietly for weeks before anyone noticed it was wrong.
   */
  await Promise.all(
    order.items.map((item) =>
      Product.updateOne(
        { _id: item.productId },
        { $inc: { stock: -((item.packSize ?? 1) * item.qty) } },
      ),
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

  /**
   * Fire and forget: notify() never throws, and a confirmation SMS that fails
   * must not undo a payment that succeeded.
   *
   * No link in the message. A payment SMS carrying a URL is exactly what a
   * phishing SMS looks like, and teaching customers to tap links in messages
   * about their money is a habit worth not starting. The order number is
   * enough to find it on the site.
   */
  // Paise are the unit everywhere else; this is the one place the backend
  // converts, because a person is about to read it. Rounded, not truncated —
  // the total is always whole rupees in practice, and a stray paisa in an SMS
  // reads as a mistake.
  const rupees = Math.round(order.amount.totalPaise / 100);

  void notify('sms', {
    to: order.shippingAddress.phone,
    message: `Order ${order.orderNumber} confirmed. Rs ${rupees} paid. We will send an update when it ships. - Bolti Rakhi`,
  });

  /**
   * The receipt, when an email was given.
   *
   * Inside this function, which returns early if the order is already paid —
   * so the browser callback and the webhook between them can only ever send
   * one. Fire and forget, like the SMS: a receipt that fails must not undo a
   * payment that succeeded.
   */
  if (order.customerEmail) {
    const mail = orderConfirmationEmail({
      orderNumber: order.orderNumber,
      items: order.items.map((item) => ({
        title: item.title,
        qty: item.qty,
        pricePaise: item.pricePaise,
      })),
      subtotalPaise: order.amount.subtotalPaise,
      shippingPaise: order.amount.shippingPaise,
      discountPaise: order.amount.discountPaise,
      totalPaise: order.amount.totalPaise,
      address: order.shippingAddress,
      supportPhone: SUPPORT_PHONE,
    });

    void notify("email", { to: order.customerEmail, ...mail });
  }

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

/**
 * One of *this customer's* orders.
 *
 * 🔴 `userId` is part of the query, not a check applied afterwards.
 *
 * Order numbers run in sequence — BR-26-0001, 0002, 0003 — so anyone can type
 * a neighbour's. Looking up by number alone and then comparing owners would
 * work until the day someone edits this function and drops the comparison; a
 * query that cannot match another person's row has no such day.
 *
 * A miss is "not found", never "not yours": confirming the order exists is
 * itself information.
 */
export async function getOwnOrder(userId: string, orderNumber: string) {
  const order = await Order.findOne({
    orderNumber: orderNumber.trim().toUpperCase(),
    userId: new Types.ObjectId(userId),
  });

  if (!order) throw ApiError.notFound('Order not found');

  return order;
}

/**
 * This customer's orders, newest first.
 *
 * 🔴 `userId` is the first thing in the filter, exactly as in `getOwnOrder`.
 * A list route that forgets it does not leak one order — it hands over the
 * whole shop's history in one response.
 */
export async function listOwnOrders(userId: string, query: Record<string, unknown>) {
  const { page, limit, skip, sort } = parsePagination(query, {
    allowedSortFields: ['createdAt'] as const,
    defaultSort: '-createdAt',
  });

  const filter = { userId: new Types.ObjectId(userId) };

  const [rows, total] = await Promise.all([
    Order.find(filter)
      // Only what a list row shows. Fetching every item of every order to
      // render one thumbnail each is work nobody sees.
      .select('orderNumber status payment.status amount.totalPaise items hasBolti createdAt')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);

  const items = rows.map((order) => ({
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.payment.status,
    placedAt: order.createdAt,
    totalPaise: order.amount.totalPaise,
    itemCount: order.items.length,
    firstItemTitle: order.items[0]?.title ?? null,
    firstItemImage: order.items[0]?.image ?? null,
    // Just the flag. The token stays on the detail page — a list has no use
    // for it, and it is one more private string per row for nothing.
    hasBolti: order.hasBolti,
  }));

  return buildPaginated(items, total, page, limit);
}
