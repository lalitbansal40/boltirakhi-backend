import { Types } from 'mongoose';

import { Order, User, type IUser, type OrderStatus } from '../../models';
import {
  ApiError,
  buildPaginated,
  containsRegex,
  parsePagination,
  type Paginated,
} from '../../utils';
import type { ListUserQuery, UserOrdersQuery } from './user.schema';

/**
 * Only these count as money the customer actually spent.
 *
 * `created` is an unpaid order and `cancelled` was refunded or never taken —
 * counting either makes "top spender" a lie, and that list decides who gets
 * called first when stock is short.
 */
const EARNING_STATUSES: OrderStatus[] = ['paid', 'processing', 'shipped', 'delivered'];

const SORTABLE = ['createdAt', 'totalSpentPaise', 'orderCount', 'name'] as const;

/** Fields that may ever leave the server. `passwordHash` is not among them. */
const PUBLIC_FIELDS = {
  name: 1,
  phone: 1,
  email: 1,
  role: 1,
  isBlocked: 1,
  addresses: 1,
  lastLoginAt: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

/**
 * List with spend stats in a single aggregate.
 *
 * Fetching users and then querying orders per row is the N+1 that makes this
 * page crawl once there are a few hundred customers.
 *
 * `passwordHash` is `select: false` on the model, but an aggregation pipeline
 * ignores that — so the projection here is explicit rather than inherited.
 */
export async function list(query: ListUserQuery): Promise<Paginated<Record<string, unknown>>> {
  const { page, limit, skip, sort } = parsePagination(query as Record<string, unknown>, {
    allowedSortFields: SORTABLE,
    defaultSort: '-createdAt',
  });

  const match: Record<string, unknown> = { role: 'customer' };

  if (query.q) {
    const pattern = containsRegex(query.q);
    match.$or = [{ name: pattern }, { phone: pattern }, { email: pattern }];
  }

  const [result] = await User.aggregate<{
    items: Record<string, unknown>[];
    meta: { total: number }[];
  }>([
    { $match: match },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'userId',
        pipeline: [
          { $match: { status: { $in: EARNING_STATUSES } } },
          { $project: { totalPaise: '$amount.totalPaise' } },
        ],
        as: 'earningOrders',
      },
    },
    {
      $addFields: {
        orderCount: { $size: '$earningOrders' },
        totalSpentPaise: { $sum: '$earningOrders.totalPaise' },
      },
    },
    { $project: { ...PUBLIC_FIELDS, orderCount: 1, totalSpentPaise: 1 } },
    {
      $facet: {
        items: [{ $sort: sort }, { $skip: skip }, { $limit: limit }],
        meta: [{ $count: 'total' }],
      },
    },
  ]);

  const total = result?.meta[0]?.total ?? 0;
  return buildPaginated(result?.items ?? [], total, page, limit);
}

export async function getById(id: string): Promise<Record<string, unknown>> {
  const user = await User.findById(id).select(PUBLIC_FIELDS).lean();
  if (!user) throw ApiError.notFound('User');

  const [stats] = await Order.aggregate<{
    totalOrders: number;
    totalSpentPaise: number;
    lastOrderAt: Date | null;
  }>([
    { $match: { userId: new Types.ObjectId(id), status: { $in: EARNING_STATUSES } } },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalSpentPaise: { $sum: '$amount.totalPaise' },
        lastOrderAt: { $max: '$createdAt' },
      },
    },
  ]);

  const totalOrders = stats?.totalOrders ?? 0;
  const totalSpentPaise = stats?.totalSpentPaise ?? 0;

  return {
    ...user,
    stats: {
      totalOrders,
      totalSpentPaise,
      // A customer with no paid orders yet is the common case, not an error.
      avgOrderValuePaise: totalOrders === 0 ? 0 : Math.round(totalSpentPaise / totalOrders),
      lastOrderAt: stats?.lastOrderAt ?? null,
    },
  };
}

/** That customer's orders, in the same light shape the order list uses. */
export async function listOrders(
  id: string,
  query: UserOrdersQuery,
): Promise<Paginated<Record<string, unknown>>> {
  const exists = await User.exists({ _id: id });
  if (!exists) throw ApiError.notFound('User');

  const { page, limit, skip, sort } = parsePagination(query as Record<string, unknown>, {
    allowedSortFields: ['createdAt', 'updatedAt'],
    defaultSort: '-createdAt',
  });

  const filter = { userId: new Types.ObjectId(id) };

  const [rows, total] = await Promise.all([
    Order.find(filter)
      .select('orderNumber amount.totalPaise status payment.status hasBolti createdAt items')
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

export async function setBlocked(
  id: string,
  isBlocked: boolean,
  actingAdminId: string,
): Promise<IUser> {
  // Blocking yourself locks you out of the panel that would let you undo it,
  // and the only way back is editing the database by hand.
  if (id === actingAdminId) {
    throw ApiError.badRequest('You cannot block your own account');
  }

  const user = await User.findByIdAndUpdate(
    id,
    { isBlocked },
    { new: true, runValidators: true },
  ).select(PUBLIC_FIELDS);

  if (!user) throw ApiError.notFound('User');
  return user;
}
