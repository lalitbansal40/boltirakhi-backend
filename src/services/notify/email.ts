import { env } from '../../config/env';
import type { ChannelSender, NotifyPayload, NotifyResult } from './types';

/**
 * Email through Resend.
 *
 * Built to the same shape as sms.ts on purpose — same timeout, same disabled
 * behaviour, same rule that the key never appears in an error. Two senders
 * that behave differently are two sets of surprises.
 *
 * This carries one thing only: the order details after a payment. Sign-in
 * codes and order confirmations go by SMS and stay there.
 */

const ENDPOINT = 'https://api.resend.com/emails';

/** Same as the SMS gateway. A hung request must not hold a checkout open. */
const TIMEOUT_MS = 10_000;

const enabled = env.EMAIL_ENABLED;

export interface EmailPayload extends NotifyPayload {
  subject: string;
  html: string;
  /**
   * The plain-text alternative.
   *
   * Not optional in practice: an HTML-only email scores worse with spam
   * filters, and this one has to reach an inbox on the first try or the
   * customer simply never sees their receipt.
   */
  text: string;
}

function isEmailPayload(payload: NotifyPayload): payload is EmailPayload {
  return 'subject' in payload && 'html' in payload;
}

export const emailSender: ChannelSender = {
  channel: 'email',
  enabled,

  async send(payload: NotifyPayload): Promise<NotifyResult> {
    if (!isEmailPayload(payload)) {
      return { ok: false, channel: 'email', error: 'Email needs a subject and body' };
    }

    // A rough check only. Resend does the real validation, and rejecting
    // something it would have accepted helps nobody.
    if (!payload.to.includes('@')) {
      return { ok: false, channel: 'email', error: 'Not a valid email address' };
    }

    if (!enabled) {
      // Same as SMS: printed in development so the flow can be exercised
      // without spending a send or waiting on a verified domain.
      console.info(`[email:disabled] to ${payload.to}: ${payload.subject}`);
      return { ok: true, channel: 'email', id: 'console' };
    }

    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      return { ok: false, channel: 'email', error: 'Email credentials are missing' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        }),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => null)) as
        | { id?: string; message?: string; name?: string }
        | null;

      if (!response.ok) {
        /**
         * 403 from Resend almost always means the `from` domain is not
         * verified. That reads like a credentials problem and sends people off
         * to check the key, when the answer is in DNS — so it is spelled out.
         */
        if (response.status === 403) {
          return {
            ok: false,
            channel: 'email',
            error: `Resend rejected the sender. The domain in EMAIL_FROM is probably not verified yet — check DNS. Resend said: ${body?.message ?? 'no detail'}`,
          };
        }

        // The provider's message is worth surfacing; the Authorization header
        // never is.
        return {
          ok: false,
          channel: 'email',
          error: `Resend responded ${response.status}: ${(body?.message ?? '').slice(0, 200)}`,
        };
      }

      return { ok: true, channel: 'email', id: body?.id };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return {
        ok: false,
        channel: 'email',
        error: aborted ? 'Email provider timed out' : 'Could not reach the email provider',
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
