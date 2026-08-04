export type Channel = 'sms' | 'email' | 'whatsapp';

export interface NotifyPayload {
  /** Phone as 91XXXXXXXXXX for sms/whatsapp, an address for email. */
  to: string;
  message: string;
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
