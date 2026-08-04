import { Types } from 'mongoose';

import { Order, type IOrder } from '../../models/Order';
import { Product } from '../../models/Product';
import { getSettings } from '../setting/setting.service';
import { applyCoupon, incrementUsage } from '../coupon/coupon.service';
import { createRazorpayOrder, verifyPaymentSignature } from '../../services/razorpay';
import { deliveryChargePaise } from '../../utils/shipping';
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
 * What the courier would charge.
 *
 * Shiprocket is not wired up yet, so there is no quote to pass in. Zero makes
 * `pickSlab` round up to the lowest slab, i.e. we charge the base rate and
 * absorb anything above it. That is the safe direction to be wrong in: the
 * customer is never overcharged for a guess, and it matches the decision that
 * whatever we do not collect, we pay.
 */
const UNKNOWN_COURIER_QUOTE_PAISE = 0;

interface PricedCart {
  items: IOrder['items'];
  subtotalPaise: number;
  shippingPaise: number;
  discountPaise: number;
  totalPaise: number;
  couponId?: Types.ObjectId;
  hasBolti: boolean;
}

/**
 * Turn a list of ids and quantities into money.
 *
 * Every product is re-read here. A price the browser sent, or a price it saw
 * ten minutes ago, is not the price that gets charged.
 */
async function priceCart(input: CreateOrderInput): Promise<PricedCart> {
  const ids = input.items.map((item) => new Types.ObjectId(item.productId));
  const products = await Product.find({ _id: { $in: ids }, isActive: true });

  const byId = new Map(products.map((product) => [String(product._id), product]));

  const items = input.items.map((line) => {
    const product = byId.get(line.productId);

    // Inactive and deleted look the same to a customer, and should: naming
    // which one it was tells them nothing useful.
    if (!product) {
      throw new ApiError(400, 'One of the items is no longer available', 'ITEM_UNAVAILABLE');
    }

    if (product.stock < line.qty) {
      throw new ApiError(
        409,
        `Only ${product.stock} left of ${product.title}`,
        'INSUFFICIENT_STOCK',
      );
    }

    return {
      productId: product._id,
      title: product.title,
      slug: product.slug,
      image: product.images?.[0]?.url,
      // `pricePaise` is what is actually charged; `mrpPaise` is only the
      // struck-through number next to it. Charging the MRP would overcharge
      // every discounted product in the shop.
      pricePaise: product.pricePaise,
      qty: line.qty,
      type: product.type,
      boltiMessageId: line.boltiMessageId
        ? new Types.ObjectId(line.boltiMessageId)
        : undefined,
    };
  });

  const subtotalPaise = items.reduce((sum, item) => sum + item.pricePaise * item.qty, 0);

  const settings = await getSettings();

  /**
   * Shipping is decided on the subtotal *before* discount — a settled
   * decision. Free delivery promised at Rs 499 stays free when a coupon takes
   * the cart to Rs 450; taking the delivery charge back after showing "free
   * delivery" is how a customer decides not to finish.
   */
  const shippingPaise = deliveryChargePaise({
    subtotalPaise,
    actualPaise: UNKNOWN_COURIER_QUOTE_PAISE,
    freeDeliveryAbovePaise: settings.freeDeliveryAbovePaise,
    slabs: settings.shippingSlabsPaise,
    aboveTopSlab: settings.aboveTopSlab,
  });

  let discountPaise = 0;
  let couponId: Types.ObjectId | undefined;

  if (input.couponCode) {
    // applyCoupon takes no shipping argument by design — the discount is on
    // goods only, and a function that cannot see the delivery charge cannot
    // accidentally discount it.
    const applied = await applyCoupon(input.couponCode, subtotalPaise);
    discountPaise = applied.discountPaise;
    couponId = applied.coupon._id as Types.ObjectId;
  }

  const totalPaise = subtotalPaise + shippingPaise - discountPaise;

  return {
    items: items as unknown as IOrder['items'],
    subtotalPaise,
    shippingPaise,
    discountPaise,
    totalPaise,
    couponId,
    hasBolti: items.some((item) => item.type === 'bolti'),
  };
}

/**
 * Create an order and the Razorpay order that will pay for it.
 *
 * The row is written first, so a payment that succeeds always has somewhere to
 * land. An order with no payment is a recoverable mess; a payment with no
 * order is a customer whose money vanished.
 */
export async function createOrder(userId: string, input: CreateOrderInput) {
  const cart = await priceCart(input);

  const orderNumber = await nextOrderNumberWithRetry();

  const order = await Order.create({
    orderNumber,
    userId: new Types.ObjectId(userId),
    items: cart.items,
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
