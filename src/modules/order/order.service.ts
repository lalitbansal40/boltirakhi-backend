import { Types } from 'mongoose';

import {
  BoltiMessage,
  Order,
  Product,
  User,
  type IOrder,
  type OrderStatus,
} from '../../models';
import {
  ApiError,
  buildPaginated,
  containsRegex,
  istDateRange,
  parsePagination,
  toCsv,
  type Paginated,
} from '../../utils';
import type {
  AddNoteInput,
  CancelOrderInput,
  ExportOrderQuery,
  ListOrderQuery,
  UpdateShippingInput,
  UpdateStatusInput,
} from './order.schema';

const SORTABLE = ['createdAt', 'updatedAt', 'orderNumber', 'status'] as const;

/**
 * Which status can move where.
 *
 * `delivered` and `cancelled` are terminal. `shipped` cannot be cancelled —
 * the goods have left; that is a refund, which is a different flow with
 * different money implications.
 *
 * This lives in the service, not the model: it is a business rule, and the
 * model is shared with the public site.
 */
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  created: ['paid', 'cancelled'],
  paid: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

/**
 * Statuses by which stock has already been taken out of inventory.
 *
 * Stock is decremented on payment success (D10), not on order creation — an
 * abandoned checkout must not hold the last piece during rakhi season. So a
 * `created` order never reserved anything, and "restoring" it on cancel would
 * invent stock that was never removed.
 */
const STOCK_RESERVED_FROM: OrderStatus[] = ['paid', 'processing', 'shipped', 'delivered'];

export function allowedTransitions(status: OrderStatus): OrderStatus[] {
  return NEXT[status] ?? [];
}

function assertTransition(from: OrderStatus, to: OrderStatus): void {
  const allowed = allowedTransitions(from);

  if (!allowed.includes(to)) {
    throw new ApiError(
      409,
      `An order cannot go from ${from} to ${to}`,
      'INVALID_STATUS_TRANSITION',
      { from, to, allowed },
    );
  }
}

async function findOrFail(id: string): Promise<IOrder> {
  const order = await Order.findById(id);
  if (!order) throw ApiError.notFound('Order');
  return order;
}

/** Shared filter builder so `/` and `/export` can never drift apart. */
async function buildFilter(query: ListOrderQuery | ExportOrderQuery): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {};

  if (query.status) filter.status = query.status;
  if (query.paymentStatus) filter['payment.status'] = query.paymentStatus;
  if (query.isInternational) filter.isInternational = true;
  if (query.hasBolti) filter.hasBolti = true;

  const createdAt = istDateRange(query.from, query.to);
  if (createdAt) filter.createdAt = createdAt;

  if (query.q) {
    const pattern = containsRegex(query.q);

    // Customer name and phone live on User, not Order. Resolving the ids first
    // keeps this a plain indexed query instead of a $lookup on every list call;
    // at this catalogue's size that is both simpler and faster.
    const users = await User.find({ $or: [{ name: pattern }, { phone: pattern }] })
      .select('_id')
      .lean();

    filter.$or = [
      { orderNumber: pattern },
      ...(users.length ? [{ userId: { $in: users.map((user) => user._id) } }] : []),
    ];
  }

  return filter;
}

/**
 * List rows are deliberately light: the admin table shows a count, never the
 * items themselves. Sending 100 orders × 5 items each makes the response many
 * times larger for data nothing renders.
 */
export async function list(query: ListOrderQuery): Promise<Paginated<Record<string, unknown>>> {
  const { page, limit, skip, sort } = parsePagination(query as Record<string, unknown>, {
    allowedSortFields: SORTABLE,
    defaultSort: '-createdAt',
  });

  const filter = await buildFilter(query);

  const [rows, total] = await Promise.all([
    Order.find(filter)
      .select(
        'orderNumber userId amount.totalPaise status payment.status isInternational hasBolti createdAt items',
      )
      .populate('userId', 'name phone email')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);

  const items = rows.map(({ items: orderItems, ...rest }) => ({
    ...rest,
    itemCount: Array.isArray(orderItems) ? orderItems.length : 0,
  }));

  return buildPaginated(items, total, page, limit);
}

export async function getById(id: string): Promise<Record<string, unknown>> {
  const order = await Order.findById(id)
    .populate('userId', 'name phone email addresses isBlocked')
    .lean();

  if (!order) throw ApiError.notFound('Order');

  // Bolti messages are linked from the items. The admin needs them on this
  // screen to play the video and print the QR.
  const boltiIds = (order.items ?? [])
    .map((item) => item.boltiMessageId)
    .filter((value): value is Types.ObjectId => Boolean(value));

  const bolti = boltiIds.length
    ? await BoltiMessage.find({ _id: { $in: boltiIds } }).lean()
    : [];

  return {
    ...order,
    bolti,
    // Derived from the one state machine so the admin dropdown cannot offer a
    // transition the server will reject (D22).
    allowedTransitions: allowedTransitions(order.status),
  };
}

export async function updateStatus(
  id: string,
  input: UpdateStatusInput,
  adminId: string,
): Promise<IOrder> {
  const order = await findOrFail(id);

  // Setting the status it already has is a no-op, not an error — but it must
  // not add a history entry, or the timeline fills with duplicates.
  if (order.status === input.status) return order;

  assertTransition(order.status, input.status);

  order.status = input.status;
  order.statusHistory.push({
    status: input.status,
    at: new Date(),
    by: new Types.ObjectId(adminId),
    note: input.note,
  });

  await order.save();
  return order;
}

export async function addNote(id: string, input: AddNoteInput, adminId: string): Promise<IOrder> {
  const order = await findOrFail(id);

  order.adminNotes.push({
    text: input.text,
    by: new Types.ObjectId(adminId),
    at: new Date(),
  });

  await order.save();
  return order;
}

export async function cancel(
  id: string,
  input: CancelOrderInput,
  adminId: string,
): Promise<IOrder> {
  const order = await findOrFail(id);

  assertTransition(order.status, 'cancelled');

  const shouldRestoreStock = STOCK_RESERVED_FROM.includes(order.status);

  order.status = 'cancelled';
  order.cancelReason = input.reason;
  order.statusHistory.push({
    status: 'cancelled',
    at: new Date(),
    by: new Types.ObjectId(adminId),
    note: input.reason,
  });

  await order.save();

  // Only after the cancel is durable, and only for orders that actually took
  // stock out. Restoring a `created` order would create inventory from nothing.
  if (shouldRestoreStock) {
    await Promise.all(
      order.items.map((item) =>
        Product.updateOne(
          { _id: item.productId },
          {
            /**
             * 🔴 Rakhis, not packs — the same arithmetic that took them out.
             *
             * Payment decrements `packSize x qty`. Adding back `qty` alone
             * returned one rakhi for a cancelled pack of eight and quietly
             * destroyed the other seven: no error, no log, and the shelf count
             * only ever drifts one way. Over a season of cancellations the shop
             * would refuse orders for stock it was still holding.
             */
            $inc: { stock: (item.packSize ?? 1) * item.qty },
          },
        ),
      ),
    );
  }

  return order;
}

/**
 * Sets whatever shipping fields were supplied, leaving the rest alone.
 *
 * Deliberately dumb: no Shiprocket call, no status machine. It exists so the
 * admin can paste an AWB from Shiprocket's own dashboard while C.6 does not
 * exist, and the order detail has something real to show.
 */
export async function updateShipping(
  id: string,
  input: UpdateShippingInput,
): Promise<IOrder> {
  const order = await findOrFail(id);

  for (const [field, value] of Object.entries(input)) {
    if (value === undefined) continue;
    // An empty string is how the form clears a field.
    order.set(`shipping.${field}`, value === '' ? undefined : value);
  }

  order.set('shipping.lastSyncedAt', new Date());

  await order.save();
  return order;
}

const CSV_HEADERS = [
  'Order Number',
  'Date (IST)',
  'Customer',
  'Phone',
  'Status',
  'Payment Status',
  'Items',
  'Total (INR)',
  'International',
  'Bolti',
] as const;

export async function exportCsv(query: ExportOrderQuery): Promise<string> {
  const filter = await buildFilter(query);

  const orders = await Order.find(filter)
    .populate('userId', 'name phone')
    .sort({ createdAt: -1 })
    .lean();

  const rows = orders.map((order) => {
    const customer = order.userId as unknown as { name?: string; phone?: string } | null;

    return [
      order.orderNumber,
      new Date(order.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      customer?.name ?? '',
      customer?.phone ?? '',
      order.status,
      order.payment?.status ?? '',
      order.items?.length ?? 0,
      // Rupees with two decimals: this file is read by a human in Excel, not
      // parsed back by us.
      (order.amount.totalPaise / 100).toFixed(2),
      order.isInternational ? 'Yes' : 'No',
      order.hasBolti ? 'Yes' : 'No',
    ];
  });

  return toCsv(CSV_HEADERS, rows);
}
