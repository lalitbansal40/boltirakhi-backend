import crypto from 'crypto';

import { env } from '../config/env';
import { isPaymentConfigured } from '../config/payment';
import { ApiError } from '../utils/ApiError';

/**
 * Razorpay, over plain fetch.
 *
 * The official SDK wraps what amounts to one REST call and two HMACs, and it
 * pulls a dependency tree into a deploy that has already broken once over
 * pruning. This is the whole surface we need.
 *
 * Amounts here are paise, which is also Razorpay's unit — so nothing is
 * converted anywhere in this file. That is deliberate: every rupee/paise bug
 * this project could have would start with a conversion nobody asked for.
 */

const API_BASE = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 15_000;

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
}

function authHeader(): string {
  // Basic auth: key id as the user, key secret as the password.
  const token = Buffer.from(
    `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`,
  ).toString('base64');
  return `Basic ${token}`;
}

async function razorpayFetch(path: string, init: RequestInit): Promise<unknown> {
  if (!isPaymentConfigured) {
    throw new ApiError(
      503,
      'Online payment is not available yet',
      'PAYMENT_NOT_CONFIGURED',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(),
        ...init.headers,
      },
      signal: controller.signal,
    });

    const body = (await response.json().catch(() => null)) as
      | { error?: { description?: string } }
      | null;

    if (!response.ok) {
      // Razorpay's own description is worth surfacing — it says useful things
      // like "amount must be at least 100". The auth header never is.
      const description = body?.error?.description ?? 'Payment gateway error';
      throw new ApiError(502, description, 'RAZORPAY_ERROR');
    }

    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new ApiError(
      504,
      aborted ? 'Payment gateway timed out' : 'Could not reach the payment gateway',
      'RAZORPAY_UNREACHABLE',
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Create a Razorpay order.
 *
 * `receipt` is our own order number. It is what makes a Razorpay payment
 * traceable back to a row in our database when a customer writes in asking
 * where their money went.
 */
export async function createRazorpayOrder(input: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new ApiError(400, 'Payment amount is invalid', 'INVALID_AMOUNT');
  }

  return (await razorpayFetch('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: 'INR',
      receipt: input.receipt,
      notes: input.notes ?? {},
    }),
  })) as RazorpayOrder;
}

/**
 * Verify the signature the browser hands back after checkout.
 *
 * Without this, anyone could POST a made-up payment id and get a free order —
 * the browser is not a trustworthy source for "this was paid".
 */
export function verifyPaymentSignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}): boolean {
  if (!env.RAZORPAY_KEY_SECRET) return false;

  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest('hex');

  return timingSafeEqual(expected, input.signature);
}

/**
 * Verify a webhook.
 *
 * Webhooks are the *reliable* signal — a customer can close the tab mid-payment
 * and never hit our callback, but Razorpay still calls us. Uses its own secret,
 * not the key secret.
 *
 * `rawBody` must be the exact bytes Razorpay sent: the HMAC is computed over
 * the raw body, so a re-serialised `req.body` produces a different string and
 * every webhook fails verification.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;

  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  return timingSafeEqual(expected, signature);
}

/**
 * Constant-time compare.
 *
 * A plain `===` leaks how many leading characters matched through how long it
 * took to fail, which is enough to forge a signature one byte at a time.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // crypto.timingSafeEqual throws on a length mismatch, so length is checked
  // first — a length is not a secret.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
