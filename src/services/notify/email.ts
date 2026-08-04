/**
 * Email is not wired up yet — no provider has been chosen.
 *
 * The file exists so `notify()` has something to import and the shape is
 * already agreed. When a provider is picked, only this file changes.
 */
import type { ChannelSender, NotifyPayload, NotifyResult } from './types';

export const emailSender: ChannelSender = {
  channel: 'email',
  enabled: false,
  async send(payload: NotifyPayload): Promise<NotifyResult> {
    void payload;
    return { ok: false, channel: 'email', error: 'Email is not configured yet' };
  },
};
