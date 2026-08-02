import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Express 4 does not catch rejected promises. An unwrapped async handler that
 * throws leaves the request hanging forever with no response and no log, so
 * every async controller goes through this.
 *
 * (Express 5 does this natively, but v4 is locked.)
 */
export const asyncHandler =
  (fn: AsyncRouteHandler): RequestHandler =>
  (req, res, next) => {
    // Promise.resolve so a synchronous throw inside fn is caught too.
    Promise.resolve(fn(req, res, next)).catch(next);
  };
