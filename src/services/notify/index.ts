import { emailSender } from './email';
import { smsSender } from './sms';
import type { Channel, ChannelSender, NotifyPayload, NotifyResult } from './types';

export type { Channel, NotifyPayload, NotifyResult } from './types';

/**
 * The one way to send a notification.
 *
 * Nothing outside this folder should import sms.ts or email.ts
 * directly. Keeping the entry point single is what lets a provider be swapped
 * — or email finally be turned on — without touching a single caller.
 */

const SENDERS: Record<Channel, ChannelSender> = {
  sms: smsSender,
  email: emailSender,
};

/**
 * Send on one channel. Never throws.
 *
 * A failed notification must not fail the thing that triggered it: an order
 * that was paid for and saved is still a real order even if the confirmation
 * SMS did not go out. Callers get a result they can log and carry on.
 */
export async function notify(
  channel: Channel,
  payload: NotifyPayload,
): Promise<NotifyResult> {
  const sender = SENDERS[channel];

  if (!sender) {
    return { ok: false, channel, error: `Unknown channel: ${channel}` };
  }

  try {
    return await sender.send(payload);
  } catch (error) {
    // A sender is meant to return a failure rather than throw one, but this
    // function's whole promise is that it never throws, so it cannot rely on
    // every future sender remembering that.
    const reason = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, channel, error: reason };
  }
}

/**
 * Send the same message on several channels.
 *
 * Deliberately `allSettled`-shaped: one dead channel must not stop the others,
 * because "the SMS failed so we skipped the email too" is the worst outcome.
 */
export async function notifyAll(
  channels: Channel[],
  payload: NotifyPayload,
): Promise<NotifyResult[]> {
  return Promise.all(channels.map((channel) => notify(channel, payload)));
}

/** Which channels are actually switched on — for the health endpoint. */
export function enabledChannels(): Channel[] {
  return (Object.keys(SENDERS) as Channel[]).filter((c) => SENDERS[c].enabled);
}
