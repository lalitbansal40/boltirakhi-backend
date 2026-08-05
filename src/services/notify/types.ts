/**
 * WhatsApp was considered and dropped — everything transactional goes by SMS,
 * and the order receipt goes by email.
 *
 * Note this is NOT the same list as OtpSession.channel, which still carries a
 * whatsapp value for rows written earlier. Removing it there would break them.
 */
export type Channel = 'sms' | 'email';

export interface NotifyPayload {
  /** Phone as 91XXXXXXXXXX for sms/whatsapp, an address for email. */
  to: string;
  /**
   * The SMS body. Not used by email, which carries subject/html/text instead —
   * hence optional here and checked by the sender that needs it.
   */
  message?: string;
  /** Provider-side template name, once any provider needs one. */
  template?: string;
}

export interface NotifyResult {
  ok: boolean;
  channel: Channel;
  /** Provider's id for the message, when it gives one. */
  id?: string;
  /** Why it failed — safe to log, never contains credentials. */
  error?: string;
}

export interface ChannelSender {
  readonly channel: Channel;
  readonly enabled: boolean;
  send(payload: NotifyPayload): Promise<NotifyResult>;
}
