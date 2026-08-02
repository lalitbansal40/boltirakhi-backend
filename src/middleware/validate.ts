import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { ApiError } from '../utils';

export interface FieldError {
  field: string;
  message: string;
}

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Flattens zod issues into what an admin form needs: one message per field,
 * dot-joined so nested paths line up with the form's field names
 * (`address.pincode`).
 *
 * `prefix` separates the three sources; without it a `query` error and a `body`
 * error on the same key would collide.
 */
function toFieldErrors(issues: readonly { path: PropertyKey[]; message: string }[], prefix = ''): FieldError[] {
  const seen = new Set<string>();
  const errors: FieldError[] = [];

  for (const issue of issues) {
    const path = issue.path.map(String).join('.');
    const field = [prefix, path].filter(Boolean).join('.') || prefix || '(root)';

    // First message per field wins; later ones are usually follow-on noise.
    if (seen.has(field)) continue;
    seen.add(field);

    errors.push({ field, message: issue.message });
  }

  return errors;
}

/**
 * Validates body/query/params against zod schemas.
 *
 * All three are checked before failing, so a form gets every bad field at once
 * rather than one per round trip.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const errors: FieldError[] = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) {
        // Assignable on Express 4; carries coercions and defaults forward.
        req.body = result.data;
      } else {
        errors.push(...toFieldErrors(result.error.issues, 'body'));
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        // req.query is a getter — parked on validatedQuery instead.
        req.validatedQuery = result.data;
      } else {
        errors.push(...toFieldErrors(result.error.issues, 'query'));
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) {
        req.params = result.data as typeof req.params;
      } else {
        errors.push(...toFieldErrors(result.error.issues, 'params'));
      }
    }

    if (errors.length > 0) {
      next(ApiError.validation(errors));
      return;
    }

    next();
  };
}
