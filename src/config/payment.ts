import { env } from './env';

/**
 * Razorpay mode, in one place.
 *
 * The keys are not here yet. Everything below is written so the code runs,
 * boots and reports honestly without them — `isPaymentConfigured` is false and
 * the checkout route says so, rather than the server refusing to start.
 */

export type PaymentMode = 'test' | 'live';

export const paymentMode: PaymentMode = env.RAZORPAY_MODE;

/**
 * Whether a real payment can actually be taken.
 *
 * The key *secret* is what signs and verifies, so a key id on its own is not
 * enough — a build with only the id would look configured and then fail at the
 * moment a customer pays.
 */
export const isPaymentConfigured = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

/**
 * Razorpay key ids are prefixed `rzp_test_` or `rzp_live_`.
 *
 * If the declared mode and the key disagree, the declared mode is a lie — and
 * the dangerous direction is a live key sitting behind a "TEST" badge, where
 * someone tries a payment believing no money moves. Trust the key, not the
 * label, and say so loudly.
 */
export const keyLooksLive = env.RAZORPAY_KEY_ID?.startsWith('rzp_live_') ?? false;

export const modeMismatch =
  isPaymentConfigured && ((paymentMode === 'live') !== keyLooksLive);

/** What the health endpoint and the checkout banner both read. */
export function paymentStatus() {
  return {
    mode: paymentMode,
    configured: isPaymentConfigured,
    // Never the key itself, not even truncated — a key id in a public health
    // response is one screenshot away from being public.
    mismatch: modeMismatch,
  };
}

/**
 * Shouted at boot rather than logged quietly.
 *
 * The single most expensive mistake this project can make is running live
 * payments while believing it is in test, so the mode is printed every start.
 */
export function logPaymentMode(): void {
  if (!isPaymentConfigured) {
    console.log('   Payments: NOT CONFIGURED — Razorpay keys missing');
    return;
  }

  console.log(`   Payments: ${paymentMode.toUpperCase()} mode`);

  if (modeMismatch) {
    console.warn(
      `   ⚠️  RAZORPAY_MODE says "${paymentMode}" but the key looks ` +
        `${keyLooksLive ? 'LIVE' : 'TEST'}. Fix this before taking payments.`,
    );
  }
}
