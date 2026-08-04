/**
 * WhatsApp is not wired up yet.
 *
 * Same arrangement as email: the shape is settled so nothing outside this
 * folder has to change when a provider is added.
 */
import type { ChannelSender, NotifyPayload, NotifyResult } from './types';

export const whatsappSender: ChannelSender = {
  channel: 'whatsapp',
  enabled: false,
  async send(payload: NotifyPayload): Promise<NotifyResult> {
    void payload;
    return { ok: false, channel: 'whatsapp', error: 'WhatsApp is not configured yet' };
  },
};
