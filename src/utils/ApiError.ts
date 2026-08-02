/**
 * Errors we throw on purpose. `middleware/error.ts` reads statusCode, code and
 * details straight off it.
 *
 * `isOperational` separates "the client did something wrong" from "we have a
 * bug" — the former is expected traffic, the latter is worth waking up for.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly isOperational = true;

  constructor(statusCode: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    // Drop this constructor from the trace so the first frame is the caller.
    Error.captureStackTrace(this, ApiError);
  }

  /**
   * The constructor hides its own frame, but a static helper called it, so that
   * helper's frame is still on top. Re-capturing from the helper puts the
   * caller's line first, which is the one worth reading in a log.
   */
  private static build(
    caller: (...args: any[]) => unknown,
    statusCode: number,
    message: string,
    code: string,
    details?: unknown,
  ): ApiError {
    const error = new ApiError(statusCode, message, code, details);
    Error.captureStackTrace(error, caller);
    return error;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return ApiError.build(ApiError.badRequest, 400, message, 'BAD_REQUEST', details);
  }

  static validation(details: unknown, message = 'Validation failed'): ApiError {
    return ApiError.build(ApiError.validation, 400, message, 'VALIDATION_ERROR', details);
  }

  static unauthorized(message = 'Authentication required'): ApiError {
    return ApiError.build(ApiError.unauthorized, 401, message, 'UNAUTHORIZED');
  }

  static forbidden(message = 'You do not have permission to do that'): ApiError {
    return ApiError.build(ApiError.forbidden, 403, message, 'FORBIDDEN');
  }

  static notFound(resource = 'Resource'): ApiError {
    return ApiError.build(ApiError.notFound, 404, `${resource} not found`, 'NOT_FOUND');
  }

  static conflict(message: string, details?: unknown): ApiError {
    return ApiError.build(ApiError.conflict, 409, message, 'CONFLICT', details);
  }

  static tooMany(message = 'Too many requests, please try again later'): ApiError {
    return ApiError.build(ApiError.tooMany, 429, message, 'RATE_LIMITED');
  }

  static internal(message = 'Something went wrong'): ApiError {
    return ApiError.build(ApiError.internal, 500, message, 'INTERNAL_ERROR');
  }
}
