import type { Response } from 'express';

/**
 * The success half of the response contract. The failure half lives in
 * `middleware/error.ts`; both shapes are fixed so the admin panel and the
 * public site can share one client.
 *
 *   { success: true, data: {...}, message?: "..." }
 *
 * `message` is only for text a user should actually see ("Product created").
 * Leaving it off is the normal case.
 */
export function sendSuccess<T>(res: Response, data: T, message?: string, status = 200): void {
  res.status(status).json({
    success: true,
    data,
    ...(message ? { message } : {}),
  });
}

export function sendCreated<T>(res: Response, data: T, message?: string): void {
  sendSuccess(res, data, message, 201);
}

export function sendNoContent(res: Response): void {
  res.status(204).end();
}
