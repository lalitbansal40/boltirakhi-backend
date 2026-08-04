import { rateLimit, ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Matches the error contract so a 429 is not the one response shape clients
// have to special-case.
function limitHandler(_req: Request, res: Response): void {
  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later',
    },
  });
}

const shared: Partial<Options> = {
  // `limit` — v7 renamed it from `max`, and passing `max` is ignored silently,
  // which looks exactly like a limiter that works until you test it.
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler,
};

/**
 * Blanket per-IP limit. `app.set('trust proxy', 1)` is what makes req.ip the
 * real client behind Railway's proxy rather than the proxy itself.
 *
 * The default memory store is per-process; more than one instance would need a
 * shared store to share counters.
 */
export const globalLimiter = rateLimit({
  ...shared,
  windowMs: FIFTEEN_MINUTES,
  limit: 200,
});

/**
 * Login is keyed on IP + email so one attacker cannot lock out an account by
 * hammering it, and one NAT'd office does not share a five-attempt budget.
 *
 * ipKeyGenerator normalises IPv6 into a subnet; a raw req.ip would give every
 * request from an IPv6 client a different key and no limit at all.
 */
/**
 * The public reveal page.
 *
 * The token is the only thing protecting a family's private video, so this is
 * the one endpoint where guessing is worth attempting. The global 200/15min is
 * far too generous for that; 30 keeps a real brother comfortable — he opens
 * the link a handful of times — while making enumeration pointless.
 */
export const revealLimiter = rateLimit({
  ...shared,
  windowMs: FIFTEEN_MINUTES,
  limit: 30,
});

export const loginLimiter = rateLimit({
  ...shared,
  windowMs: FIFTEEN_MINUTES,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request): string => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return `${ipKeyGenerator(req.ip ?? '')}:${email}`;
  },
});

/**
 * Coupon codes are short and guessable — SAVE10, SAVE20, RAKHI50 — and the
 * validate endpoint is public, so without a limit it becomes a free oracle for
 * discovering every live discount.
 *
 * 30 in fifteen minutes is far more than a real shopper needs; they try one
 * code, maybe two.
 */
export const couponLimiter = rateLimit({
  ...shared,
  windowMs: FIFTEEN_MINUTES,
  limit: 30,
});

/**
 * The storefront catalogue.
 *
 * Far more generous than the reveal or coupon limits: one shopper browsing a
 * category and opening a few products fires twenty or thirty requests in a
 * couple of minutes. A 30-per-window cap here would lock out the customers it
 * was meant to protect.
 */
export const catalogLimiter = rateLimit({
  ...shared,
  windowMs: FIFTEEN_MINUTES,
  limit: 120,
});

/**
 * Cart re-pricing.
 *
 * The most-called endpoint on the site: it fires on every quantity change,
 * every add, every coupon attempt. A shopper adjusting a few lines can send a
 * dozen requests inside a minute quite innocently.
 *
 * Generous on purpose — the request is cheap, and a rate-limited cart shows a
 * stale total, which is the one thing this whole endpoint exists to prevent.
 */
export const cartLimiter = rateLimit({
  ...shared,
  windowMs: FIFTEEN_MINUTES,
  limit: 300,
});
