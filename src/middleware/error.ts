import type { NextFunction, Request, Response } from 'express';
import { isProduction } from '../config/env';

interface ErrorShape {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Maps the errors this app actually produces onto the response contract.
 * Anything unrecognised becomes a generic 500 — internal messages must not
 * reach clients.
 */
function classify(err: unknown): ErrorShape {
  const error = err as Record<string, any>;

  // Body-parser errors carry their own statusCode, so they must be matched
  // before the generic statusCode branch below or they fall through to it.
  if (error?.type === 'entity.parse.failed') {
    return { status: 400, code: 'INVALID_JSON', message: 'Malformed JSON body' };
  }

  if (error?.type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' };
  }

  // Thrown deliberately (ApiError sets statusCode).
  if (typeof error?.statusCode === 'number') {
    return {
      status: error.statusCode,
      code: error.code ?? 'ERROR',
      message: error.message ?? 'Request failed',
      details: error.details,
    };
  }

  // Mongoose schema validation.
  if (error?.name === 'ValidationError' && error.errors) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: Object.values(error.errors).map((e: any) => ({
        field: e.path,
        message: e.message,
      })),
    };
  }

  // Malformed ObjectId and friends.
  if (error?.name === 'CastError') {
    return {
      status: 400,
      code: 'INVALID_ID',
      message: `Invalid value for "${error.path}"`,
    };
  }

  // Unique index violation.
  if (error?.code === 11000) {
    const field = Object.keys(error.keyValue ?? {})[0] ?? 'field';
    return {
      status: 409,
      code: 'DUPLICATE',
      message: `${field} already exists`,
    };
  }

  if (error?.name === 'JsonWebTokenError') {
    return { status: 401, code: 'INVALID_TOKEN', message: 'Invalid token' };
  }

  if (error?.name === 'TokenExpiredError') {
    return { status: 401, code: 'TOKEN_EXPIRED', message: 'Token expired' };
  }

  return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
}

// Express identifies error handlers by arity — `next` must stay in the signature.
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const { status, code, message, details } = classify(err);

  // Client mistakes are noise; server faults are not.
  if (status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
  }

  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      // Stack traces describe internals — development only.
      ...(!isProduction && err instanceof Error ? { stack: err.stack } : {}),
    },
  });
}
