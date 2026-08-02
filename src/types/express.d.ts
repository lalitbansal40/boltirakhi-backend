// No top-level import: that would make this a module and the global
// augmentation below would stop applying.

declare global {
  namespace Express {
    interface Request {
      /**
       * Output of `validate({ query })`.
       *
       * `req.query` is a getter and cannot be replaced, so the parsed value —
       * with zod's coercions and defaults applied — lives here instead.
       * Controllers must read this, not `req.query`, or `page` stays a string.
       */
      validatedQuery?: unknown;
    }
  }
}

export {};
