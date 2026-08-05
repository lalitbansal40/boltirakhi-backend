import type { Request, Response } from 'express';

import { asyncHandler, sendSuccess } from '../../utils';
import { priceCart, type PricedCart } from './pricing.service';
import type { PriceCartBody } from './pricing.schema';

/**
 * Shape the cart for the browser.
 *
 * ObjectIds become strings, and nothing that is not needed on screen goes out.
 * `availableQty` survives only because the cart has to say "only 2 left" — it
 * is set by the service solely when fewer are available than were asked for,
 * never as a running inventory count.
 */
function toPublicCart(cart: PricedCart) {
  return {
    lines: cart.lines.map((line) => ({
      productId: String(line.productId),
      title: line.title,
      slug: line.slug,
      image: line.image,
      pricePaise: line.pricePaise,
      qty: line.qty,
      packSize: line.packSize,
      packLabel: line.packLabel,
      type: line.type,
      lineTotalPaise: line.issue ? 0 : line.pricePaise * line.qty,
      issue: line.issue,
      availableQty: line.availableQty,
    })),
    subtotalPaise: cart.subtotalPaise,
    shippingPaise: cart.shippingPaise,
    discountPaise: cart.discountPaise,
    totalPaise: cart.totalPaise,
    // So the cart can say "add Rs 120 more for free delivery" — a line that
    // raises cart value on its own.
    freeDeliveryAbovePaise: cart.freeDeliveryAbovePaise,
    couponError: cart.couponError,
  };
}

export const price = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as PriceCartBody;

  /**
   * `strict: false`.
   *
   * A cart that refuses to load because one product went out of stock is worse
   * than a cart that shows the problem. The customer needs to see what they
   * have before they can decide what to do about it.
   */
  const cart = await priceCart({ ...body, strict: false });

  sendSuccess(res, toPublicCart(cart));
});
