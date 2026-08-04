import type { AboveTopSlab } from '../models/Setting';

/**
 * What to charge the customer when the courier quotes `actualPaise`.
 *
 * Always rounds UP to the next slab: Rs 0-49 becomes Rs 49, Rs 49.01-79
 * becomes Rs 79. Rounding down would mean losing money on every order that
 * falls between two slabs.
 *
 * Past the top slab, `aboveTopSlab` decides: 'cap' charges the top slab and we
 * absorb the rest, 'actual' passes the real cost through.
 */
export function pickSlab(
  actualPaise: number,
  slabs: number[],
  aboveTopSlab: AboveTopSlab,
): number {
  // Copied before sorting: `.sort()` mutates in place, and this array belongs
  // to a mongoose document.
  //
  // Sorting at all rather than trusting the order matters — an admin can save
  // the slabs in any order, and an unsorted list would quietly pick the wrong
  // one with no error to notice.
  const sorted = [...slabs].sort((a, b) => a - b);

  if (sorted.length === 0) {
    throw new Error('pickSlab called with no slabs — settings validation should prevent this');
  }

  const match = sorted.find((slab) => actualPaise <= slab);
  if (match !== undefined) return match;

  return aboveTopSlab === 'cap' ? sorted[sorted.length - 1] : actualPaise;
}

/**
 * Whether this cart ships free.
 *
 * ⚠️ Takes the subtotal BEFORE any coupon discount, deliberately.
 *
 * A Rs 999 cart that a coupon brings down to Rs 799 still ships free. Showing
 * "free delivery" in the cart and then adding a charge at payment is one of
 * the most reliable ways to lose the order, so the promise is kept once it has
 * been made.
 *
 * `>=` and not `>`: a Rs 499 cart against a Rs 499 threshold has met it. With
 * `>` the customer either adds one more rupee or leaves.
 */
export function isFreeDelivery(subtotalPaise: number, thresholdPaise: number): boolean {
  return subtotalPaise >= thresholdPaise;
}

/**
 * The whole delivery decision in one call, for the checkout to use later.
 */
export function deliveryChargePaise(options: {
  /** Cart subtotal before discount. */
  subtotalPaise: number;
  /** What the courier quoted. */
  actualPaise: number;
  freeDeliveryAbovePaise: number;
  slabs: number[];
  aboveTopSlab: AboveTopSlab;
}): number {
  if (isFreeDelivery(options.subtotalPaise, options.freeDeliveryAbovePaise)) return 0;
  return pickSlab(options.actualPaise, options.slabs, options.aboveTopSlab);
}
