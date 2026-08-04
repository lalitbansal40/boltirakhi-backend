import { env } from '../../config/env';
import type { ChannelSender, NotifyPayload, NotifyResult } from './types';

/**
 * SMS through NotifyNow.
 *
 * Credentials come from the environment and are never written down here, never
 * logged, and never echoed in an error — a request body in a log file makes
 * the .env pointless.
 */

const ENDPOINT = 'https://notifynow.in/api/sms-v1/send';

/**
 * Ten seconds.
 *
 * A gateway that hangs would otherwise hold a signup open until the browser
 * gives up, and the visitor sees a frozen form rather than "try again".
 */
const TIMEOUT_MS = 10_000;

const enabled = env.SMS_ENABLED;

/**
 * NotifyNow wants a bare 91XXXXXXXXXX — no plus, no spaces, no leading zero.
 *
 * Numbers reach us in every shape a person can type one, so this normalises
 * rather than trusting the caller.
 */
export function toGatewayNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  // 10 digits: a bare Indian mobile.
  if (digits.length === 10) return `91${digits}`;
  // 12 digits starting 91: already in the right shape.
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  // 11 digits starting 0: the old STD-prefixed form.
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;

  return null;
}

export const smsSender: ChannelSender = {
  channel: 'sms',
  enabled,

  async send(payload: NotifyPayload): Promise<NotifyResult> {
    const mobile = toGatewayNumber(payload.to);
    if (!mobile) {
      return { ok: false, channel: 'sms', error: 'Not a valid Indian mobile number' };
    }

    if (!enabled) {
      // Development has no gateway credentials, and an OTP nobody can read is
      // an OTP nobody can test with. Printed, never returned to the caller.
      console.info(`[sms:disabled] to ${mobile}: ${payload.message}`);
      return { ok: true, channel: 'sms', id: 'console' };
    }

    const username = env.SMS_USERNAME;
    const password = env.SMS_PASSWORD;

    if (!username || !password) {
      return { ok: false, channel: 'sms', error: 'SMS credentials are missing' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, mobile, message: payload.message }),
        signal: controller.signal,
      });

      const text = await response.text();

      if (!response.ok) {
        // The body is echoed because it is the provider's error text, but the
        // request — which carries the password — never is.
        return {
          ok: false,
          channel: 'sms',
          error: `Gateway responded ${response.status}: ${text.slice(0, 200)}`,
        };
      }

      // The response shape has not been confirmed against the live gateway
      // yet, so nothing is parsed out of it beyond the status. Once a real
      // send has been observed, read the message id from here.
      return { ok: true, channel: 'sms' };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return {
        ok: false,
        channel: 'sms',
        error: aborted ? 'Gateway timed out' : 'Could not reach the SMS gateway',
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
