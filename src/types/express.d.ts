// No top-level import: that would make this a module and the global
// augmentation below would stop applying.

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Only the id and role — everything else goes stale. */
      user?: { id: string; role: 'customer' | 'admin' };

      /**
       * Output of `validate({ query })`.
       *
       * `req.query` is a getter and cannot be replaced, so the parsed value —
       * with zod's coercions and defaults applied — lives here instead.
       * Controllers must read this, not `req.query`, or `page` stays a string.
       */
      validatedQuery?: unknown;

      /**
       * The exact body bytes, captured by `express.json`'s verify hook for
       * webhook paths only. Razorpay's signature is an HMAC over these, so a
       * re-serialised `req.body` cannot be used in its place.
       */
      rawBody?: string;
    }
  }
}

export {};
