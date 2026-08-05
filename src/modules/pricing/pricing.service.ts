import { Types } from 'mongoose';

import { Product, type ProductType } from '../../models/Product';
import { getSettings } from '../setting/setting.service';
import { applyCoupon } from '../coupon/coupon.service';
import { deliveryChargePaise } from '../../utils/shipping';
import { ApiError } from '../../utils/ApiError';

/**
 * What a cart costs.
 *
 * This is the only place in the codebase that turns a list of product ids into
 * money, and both the cart screen and the checkout call it. That is the whole
 * point of the file: a total shown on the cart page and a total charged at
 * checkout must come from the same lines of code, or they will eventually
 * disagree — and the customer will find out at the moment their card is
 * charged.
 *
 * The browser never sends a price. Every rupee below is read from the database.
 */

/**
 * What the courier would charge.
 *
 * Shiprocket is not wired up, so there is no quote. Zero makes `pickSlab` round
 * up to the lowest slab: we charge the base rate and absorb anything above it.
 * That is the safe direction to guess in — the customer is never overcharged.
 */
const UNKNOWN_COURIER_QUOTE_PAISE = 0;

/** Why a line cannot be fulfilled as asked. */
export type LineIssue = 'unavailable' | 'insufficient_stock';

export interface PricedLine {
  /** How many rakhis are in one of these. 1 for a plain single. */
  packSize: number;
  /** "Pack of 4", or empty for a single. Copied onto the order as-is. */
  packLabel?: string;
  productId: Types.ObjectId;
  title: string;
  slug: string;
  image?: string;
  pricePaise: number;
  qty: number;
  type: ProductType;
  boltiMessageId?: Types.ObjectId;
  /**
   * Only ever set when `strict` is false. In strict mode a problem line throws
   * instead, because a checkout must not quietly proceed without it.
   */
  issue?: LineIssue;
  /**
   * How many are actually left, and only when fewer than asked for. Never the
   * full inventory count — that is not the customer's business.
   */
  availableQty?: number;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotalPaise: number;
  shippingPaise: number;
  discountPaise: number;
  totalPaise: number;
  freeDeliveryAbovePaise: number;
  couponId?: Types.ObjectId;
  /** Set instead of throwing when `strict` is false. */
  couponError?: string;
  hasBolti: boolean;
}

export interface PriceCartInput {
  items: {
    productId: string;
    qty: number;
    /** Missing means a single — that is what every pre-variant cart holds. */
    packSize?: number;
    boltiMessageId?: string;
  }[];
  couponCode?: string;
  /**
   * true  — checkout: anything wrong stops the whole thing.
   * false — cart: problems are marked on the line and priced out of the total.
   */
  strict: boolean;
}

export async function priceCart(input: PriceCartInput): Promise<PricedCart> {
  const settings = await getSettings();

  // An empty cart is a normal state, not an error. Return zeroes rather than
  // making the cart screen special-case a 400.
  if (input.items.length === 0) {
    return {
      lines: [],
      subtotalPaise: 0,
      shippingPaise: 0,
      discountPaise: 0,
      totalPaise: 0,
      freeDeliveryAbovePaise: settings.freeDeliveryAbovePaise,
      hasBolti: false,
    };
  }

  const ids = input.items.map((item) => new Types.ObjectId(item.productId));
  const products = await Product.find({ _id: { $in: ids }, isActive: true });
  const byId = new Map(products.map((product) => [String(product._id), product]));

  const lines: PricedLine[] = input.items.map((line) => {
    const product = byId.get(line.productId);

    if (!product) {
      if (input.strict) {
        // Inactive and deleted look the same to a customer, and should —
        // saying which tells them nothing they can act on.
        throw new ApiError(400, 'One of the items is no longer available', 'ITEM_UNAVAILABLE');
      }

      // Nothing is known about a product that is gone: no title, no price. The
      // cart screen falls back to what it already has on screen.
      return {
        productId: new Types.ObjectId(line.productId),
        title: 'Item no longer available',
        slug: '',
        pricePaise: 0,
        packSize: line.packSize ?? 1,
        qty: line.qty,
        type: 'normal' as ProductType,
        issue: 'unavailable',
      };
    }

    /**
     * A missing packSize means a single.
     *
     * Every cart saved before packs existed looks exactly like this, and they
     * are sitting in people's browsers right now.
     */
    const packSize = line.packSize ?? 1;

    /**
     * 🔴 The price comes from the variant, never from the product.
     *
     * A pack of 8 charged at the single price is the difference we would have
     * to absorb on every one of those orders — and it is invisible in testing
     * unless the variant's price is deliberately different.
     *
     * Only an active variant counts. One that was switched off must not still
     * be sellable through a stale cart.
     */
    const variant =
      packSize === 1
        ? undefined
        : product.variants?.find((v) => v.packSize === packSize && v.isActive);

    if (packSize !== 1 && !variant) {
      if (input.strict) {
        throw new ApiError(
          400,
          `That pack is no longer available for ${product.title}`,
          'VARIANT_UNAVAILABLE',
        );
      }

      return {
        productId: product._id,
        title: product.title,
        slug: product.slug,
        image: product.images?.[0]?.url,
        pricePaise: 0,
        packSize,
        qty: line.qty,
        type: product.type,
        issue: 'unavailable',
      };
    }

    const base: PricedLine = {
      productId: product._id,
      title: product.title,
      slug: product.slug,
      image: product.images?.[0]?.url,
      // A variant's price is the price of the whole pack. For a single it is
      // the product's own — `mrpPaise` is only the struck-through number, and
      // charging that would overcharge every discounted product in the shop.
      pricePaise: variant ? variant.pricePaise : product.pricePaise,
      packSize,
      packLabel: packSize > 1 ? `Pack of ${packSize}` : undefined,
      qty: line.qty,
      type: product.type,
      boltiMessageId: line.boltiMessageId
        ? new Types.ObjectId(line.boltiMessageId)
        : undefined,
    };

    /**
     * 🔴 Stock is counted in rakhis, so two packs of 8 need sixteen.
     *
     * Checking `qty` alone would sell eight rakhis off a shelf holding one.
     */
    const rakhisNeeded = packSize * line.qty;

    if (product.stock < rakhisNeeded) {
      if (input.strict) {
        throw new ApiError(
          409,
          `Only ${product.stock} left of ${product.title}`,
          'INSUFFICIENT_STOCK',
        );
      }

      // How many of THIS pack they could still have, not the shelf count.
      return {
        ...base,
        issue: 'insufficient_stock',
        availableQty: Math.floor(product.stock / packSize),
      };
    }

    return base;
  });

  /**
   * Only lines that can actually be bought count towards the money.
   *
   * A line the shop cannot fulfil must not inflate the subtotal — otherwise the
   * cart shows a total that includes something the customer will never receive,
   * and could even cross the free-delivery threshold on the strength of it.
   */
  const payableLines = lines.filter((line) => !line.issue);

  const subtotalPaise = payableLines.reduce(
    (sum, line) => sum + line.pricePaise * line.qty,
    0,
  );

  /**
   * Shipping is decided on the subtotal *before* discount — a settled decision.
   * Free delivery promised at Rs 499 stays free when a coupon brings the cart
   * to Rs 450. Showing "FREE delivery" and then taking it back is how a
   * customer decides not to finish.
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
  let couponError: string | undefined;

  if (input.couponCode) {
    try {
      // applyCoupon takes no shipping argument, deliberately: the discount is
      // on goods alone, and a function that cannot see the delivery charge
      // cannot accidentally discount it.
      const applied = await applyCoupon(input.couponCode, subtotalPaise);
      discountPaise = applied.discountPaise;
      couponId = applied.coupon._id as Types.ObjectId;
    } catch (error) {
      // On the cart screen a bad coupon must not take the cart with it — the
      // customer still needs to see what they are buying. At checkout it stops
      // everything, because the total they agreed to was based on it.
      if (input.strict || !(error instanceof ApiError)) throw error;
      couponError = error.message;
    }
  }

  return {
    lines,
    subtotalPaise,
    shippingPaise,
    discountPaise,
    totalPaise: subtotalPaise + shippingPaise - discountPaise,
    freeDeliveryAbovePaise: settings.freeDeliveryAbovePaise,
    couponId,
    couponError,
    hasBolti: payableLines.some((line) => line.type === 'bolti'),
  };
}
