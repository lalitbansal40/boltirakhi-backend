import type { NextFunction, Request, RequestHandler, Response } from 'express';

const MAX_DEPTH = 10;

/**
 * Strips keys that Mongo treats as operators.
 *
 * A body of `{ email: { $ne: null } }` reaching a query turns a login check
 * into "any user". Zod schemas already reject this wherever they are applied;
 * this is the layer for the places that do not have one yet.
 *
 * Written by hand rather than using express-mongo-sanitize, which reassigns
 * req.query — that breaks on Express 5 and the package is no longer maintained.
 */
function stripOperators(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripOperators(item, depth + 1));
  }

  const cleaned: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    // `$` starts an operator; `.` reaches into a nested path.
    if (key.startsWith('$') || key.includes('.')) continue;

    cleaned[key] = stripOperators(item, depth + 1);
  }

  return cleaned;
}

/** req.query is skipped — it is a getter, and validate() parses it anyway. */
export const sanitizeRequest: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (req.body && typeof req.body === 'object') {
    req.body = stripOperators(req.body);
  }

  if (req.params && typeof req.params === 'object') {
    req.params = stripOperators(req.params) as typeof req.params;
  }

  next();
};

export { stripOperators };
