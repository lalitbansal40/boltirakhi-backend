import type { Types } from 'mongoose';

import { Coupon, type ICoupon } from '../../models/Coupon';
import { ApiError, buildPaginated, parsePagination, type Paginated } from '../../utils';
import { containsRegex } from '../../utils/escapeRegex';
import { istDayEnd, istDayStart } from '../../utils/istDate';
import type {
  CreateCouponInput,
  ListCouponQuery,
  UpdateCouponInput,
} from './coupon.schema';

const SORTABLE = ['createdAt', 'validTo', 'usedCount', 'code'] as const;

/**
 * The date strings arrive as plain IST calendar days.
 *
 * `istDayEnd` is exclusive — the instant the next day begins — so a coupon
 * valid "to 20 Aug" works right up to 20 Aug 23:59:59 IST. Storing the start
 * of 20 Aug instead would kill it a full day early, on the last day the admin
 * meant it to run.
 */
function toDateRange(input: { validFrom?: string; validTo?: string }) {
  const range: { validFrom?: Date; validTo?: Date } = {};
  if (input.validFrom) range.validFrom = istDayStart(input.validFrom);
  if (input.validTo) range.validTo = istDayEnd(input.validTo);
  return range;
}

export async function list(query: ListCouponQuery): Promise<Paginated<ICoupon>> {
  const { page, limit, skip, sort } = parsePagination(query as Record<string, unknown>, {
    allowedSortFields: SORTABLE,
    defaultSort: '-createdAt',
  });

  const filter: Record<string, unknown> = {};

  if (query.q) filter.code = containsRegex(query.q);
  if (query.isActive) filter.isActive = query.isActive === 'true';
  // validTo is exclusive, so a coupon is expired once now has reached it.
  if (query.expired) filter.validTo = { $lte: new Date() };

  const [items, total] = await Promise.all([
    Coupon.find(filter).sort(sort).skip(skip).limit(limit),
    Coupon.countDocuments(filter),
  ]);

  return buildPaginated(items, total, page, limit);
}

export async function getById(id: string): Promise<ICoupon> {
  const coupon = await Coupon.findById(id);
  if (!coupon) throw ApiError.notFound('Coupon');
  return coupon;
}

export async function create(input: CreateCouponInput): Promise<ICoupon> {
  const code = input.code.toUpperCase();

  // Checked up front so the admin gets a named error instead of a raw E11000
  // from the unique index.
  if (await Coupon.exists({ code })) {
    throw new ApiError(409, `Coupon ${code} already exists`, 'COUPON_CODE_EXISTS');
  }

  return Coupon.create({ ...input, code, ...toDateRange(input) });
}

export async function update(id: string, input: UpdateCouponInput): Promise<ICoupon> {
  const coupon = await getById(id);

  if (input.code !== undefined) {
    const next = input.code.toUpperCase();

    // The code is out in the world by now — in WhatsApp forwards, on a story.
    // Renaming it would break it for everyone already holding it.
    if (next !== coupon.code && coupon.usedCount > 0) {
      throw new ApiError(
        409,
        'This coupon has already been used, so its code cannot be changed',
        'COUPON_CODE_LOCKED',
        { usedCount: coupon.usedCount },
      );
    }

    if (next !== coupon.code && (await Coupon.exists({ code: next }))) {
      throw new ApiError(409, `Coupon ${next} already exists`, 'COUPON_CODE_EXISTS');
    }
  }

  Object.assign(coupon, input, toDateRange(input));
  await coupon.save();

  return coupon;
}

export async function setStatus(id: string, isActive: boolean): Promise<ICoupon> {
  const coupon = await getById(id);
  coupon.isActive = isActive;
  await coupon.save();
  return coupon;
}

export async function remove(id: string): Promise<void> {
  const coupon = await getById(id);
  await coupon.deleteOne();
}

/**
 * Works out what this coupon is worth on this cart.
 *
 * Reads only — `usedCount` moves when an order is confirmed, not here.
 *
 * ⚠️ There is no shipping parameter, deliberately. The discount applies to
 * goods alone; a function that cannot see the shipping charge cannot
 * accidentally discount it.
 */
export async function applyCoupon(
  code: string,
  subtotalPaise: number,
): Promise<{ discountPaise: number; coupon: ICoupon }> {
  // The model upper-cases documents, not query filters — without this a
  // customer typing `save20` is told their valid coupon does not exist.
  const coupon = await Coupon.findOne({ code: code.trim().toUpperCase() });

  if (!coupon) {
    throw new ApiError(404, 'That coupon code is not valid', 'COUPON_NOT_FOUND');
  }
  if (!coupon.isActive) {
    throw new ApiError(400, 'This coupon is no longer active', 'COUPON_INACTIVE');
  }

  const now = new Date();
  if (now < coupon.validFrom) {
    throw new ApiError(400, 'This coupon is not active yet', 'COUPON_NOT_STARTED');
  }
  // validTo is exclusive, so `>=` is the correct expiry test.
  if (now >= coupon.validTo) {
    throw new ApiError(400, 'This coupon has expired', 'COUPON_EXPIRED');
  }

  if (subtotalPaise < coupon.minOrderPaise) {
    const shortByPaise = coupon.minOrderPaise - subtotalPaise;
    // The number matters more than the message: "add Rs 200 more" sends the
    // customer back for another item, where "minimum Rs 999" just ends the
    // visit.
    throw new ApiError(
      400,
      `Add ${formatRupees(shortByPaise)} more to use this coupon`,
      'COUPON_MIN_ORDER',
      { minOrderPaise: coupon.minOrderPaise, shortByPaise },
    );
  }

  let discountPaise: number;

  if (coupon.type === 'percent') {
    // floor, not round: rounding up gives away a paisa on roughly half of all
    // orders, and breaks the whole-paise rule the rest of the system relies on.
    discountPaise = Math.floor((subtotalPaise * coupon.valuePercent!) / 100);

    if (coupon.maxDiscountPaise !== undefined) {
      discountPaise = Math.min(discountPaise, coupon.maxDiscountPaise);
    }
  } else {
    discountPaise = coupon.valueFlatPaise!;
  }

  // A Rs 500 flat coupon on a Rs 300 cart would otherwise produce a negative
  // total, which Razorpay refuses outright.
  discountPaise = Math.min(discountPaise, subtotalPaise);

  return { discountPaise, coupon };
}

/**
 * Called once an order is confirmed.
 *
 * No compare-and-set guard: these coupons have no usage cap, so the count is
 * only ever a tally. If a cap is ever added, this becomes a conditional update.
 */
export async function incrementUsage(couponId: Types.ObjectId): Promise<void> {
  await Coupon.updateOne({ _id: couponId }, { $inc: { usedCount: 1 } });
}

function formatRupees(paise: number): string {
  return `Rs ${Math.ceil(paise / 100)}`;
}
