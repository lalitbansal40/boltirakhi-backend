import { BoltiMessage, Order, Product, User, type OrderStatus } from '../../models';
import { istToday } from '../../utils';

/** Revenue means money taken, so unpaid and cancelled orders are excluded. */
const EARNING_STATUSES: OrderStatus[] = ['paid', 'processing', 'shipped', 'delivered'];

/** Waiting to go out of the door. */
const PENDING_SHIPMENT_STATUSES: OrderStatus[] = ['paid', 'processing'];

const LOW_STOCK_THRESHOLD = 5;

export interface DashboardStats {
  totalOrders: number;
  todayOrders: number;
  totalRevenuePaise: number;
  todayRevenuePaise: number;
  pendingShipments: number;
  lowStockCount: number;
  boltiPending: number;
  totalUsers: number;
}

/**
 * Every card in one round trip.
 *
 * `$facet` runs each branch over the same scanned set, so this is one query
 * instead of the eight it reads like. The three counts that are not about
 * orders cannot join that facet, so they ride along in a single Promise.all —
 * still one round trip's worth of latency rather than eight sequential ones.
 *
 * "Today" is an IST calendar day. On UTC boundaries every order placed before
 * 05:30 IST would count towards yesterday, and the admin's morning total would
 * never match what they see in the list.
 */
export async function getStats(): Promise<DashboardStats> {
  const { start, end } = istToday();

  const orderFacet = Order.aggregate<{
    totals: { count: number }[];
    today: { count: number }[];
    revenue: { sum: number }[];
    todayRevenue: { sum: number }[];
    pending: { count: number }[];
  }>([
    {
      $facet: {
        totals: [{ $count: 'count' }],
        today: [{ $match: { createdAt: { $gte: start, $lt: end } } }, { $count: 'count' }],
        revenue: [
          { $match: { status: { $in: EARNING_STATUSES } } },
          { $group: { _id: null, sum: { $sum: '$amount.totalPaise' } } },
        ],
        todayRevenue: [
          {
            $match: {
              status: { $in: EARNING_STATUSES },
              createdAt: { $gte: start, $lt: end },
            },
          },
          { $group: { _id: null, sum: { $sum: '$amount.totalPaise' } } },
        ],
        pending: [
          { $match: { status: { $in: PENDING_SHIPMENT_STATUSES } } },
          { $count: 'count' },
        ],
      },
    },
  ]);

  const [facet, lowStockCount, totalUsers, boltiPending] = await Promise.all([
    orderFacet,
    Product.countDocuments({ isActive: true, stock: { $lte: LOW_STOCK_THRESHOLD } }),
    User.countDocuments({ role: 'customer' }),
    // QR is printed and waiting to be attached — the print queue's length.
    BoltiMessage.countDocuments({ status: 'ready', isRevealed: false }),
  ]);

  const result = facet[0];

  return {
    totalOrders: result?.totals[0]?.count ?? 0,
    todayOrders: result?.today[0]?.count ?? 0,
    totalRevenuePaise: result?.revenue[0]?.sum ?? 0,
    todayRevenuePaise: result?.todayRevenue[0]?.sum ?? 0,
    pendingShipments: result?.pending[0]?.count ?? 0,
    lowStockCount,
    totalUsers,
    boltiPending,
  };
}

export async function recentOrders(limit = 10): Promise<Record<string, unknown>[]> {
  const rows = await Order.find()
    .select('orderNumber userId amount.totalPaise status payment.status hasBolti createdAt items')
    .populate('userId', 'name phone')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return rows.map(({ items, ...rest }) => ({
    ...rest,
    itemCount: Array.isArray(items) ? items.length : 0,
  }));
}
