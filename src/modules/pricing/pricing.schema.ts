import { z } from 'zod';

/**
 * What the cart is allowed to send.
 *
 * Ids and quantities only — no prices. The same rule as checkout, for the same
 * reason: a client that can name its own price is a shop that gives things away.
 */

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');

export const priceCartSchema = z.object({
  /**
   * `.max()` on both, because there is no honest cart with 200 lines or 500 of
   * one thing — but there is a request built to make the server do work.
   * An empty array is allowed: an empty cart is a normal state, not an error.
   */
  items: z
    .array(
      z.object({
        productId: objectId,
        qty: z.number().int().min(1).max(20),
        // Absent means a single. A size outside the list is refused rather
        // than quietly treated as one — a cart asking for a pack of 3 is a
        // cart that has been tampered with.
        packSize: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(6), z.literal(8)]).optional(),
      }),
    )
    .max(50),
  couponCode: z.string().trim().min(1).max(40).optional(),
});

export type PriceCartBody = z.infer<typeof priceCartSchema>;
