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
    if (!payload.message) {
      return { ok: false, channel: 'sms', error: 'SMS needs a message' };
    }

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
        body: JSON.stringify({
          username,
          password,
          mobile,
          message: payload.message,
          // Required by the gateway. Without it the message is accepted and
          // then dropped, with every layer reporting success.
          senderId: env.SMS_SENDER_ID,
        }),
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

      /**
       * A 200 is not a sent message.
       *
       * NotifyNow answers 200 with `success` inside the body, so treating the
       * status alone as success reported delivery for messages that never
       * left — which is exactly how a whole evening was lost once.
       */
      let body: {
        success?: boolean;
        message?: string;
        messageId?: string;
        metadata?: { resolvedPeId?: string };
      } | null = null;

      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON. Older gateways answer in plain text; treat a 200 as sent
        // rather than failing an order over a response we cannot read.
        return { ok: true, channel: 'sms' };
      }

      if (body?.success === false) {
        return {
          ok: false,
          channel: 'sms',
          error: `Gateway refused: ${body.message ?? 'no reason given'}`,
        };
      }

      /**
       * NotifyNow returns an empty resolvedPeId even for messages that are
       * delivered, so it is not a useful signal and is deliberately not warned
       * about — a warning on every single SMS is a log nobody reads.
       */
      return { ok: true, channel: 'sms', id: body?.messageId };
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
