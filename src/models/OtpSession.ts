import { Schema, model, type Document, type Model, type Types } from 'mongoose';

export type OtpChannel = 'sms' | 'whatsapp';

/** A 6-digit code is trivially brute-forced without a ceiling on tries. */
export const MAX_OTP_ATTEMPTS = 5;

export interface IOtpSession extends Document<Types.ObjectId> {
  phone: string;
  channel: OtpChannel;
  otpHash: string;
  expiresAt: Date;
  attempts: number;
  verifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const otpSessionSchema = new Schema<IOtpSession>(
  {
    phone: { type: String, required: true, trim: true },
    channel: { type: String, enum: ['sms', 'whatsapp'], required: true },

    // Hashed, never the code itself — a database dump must not hand out live OTPs.
    otpHash: { type: String, required: true },

    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 },
    verifiedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.otpHash;
        delete ret.__v;
        return ret;
      },
    },
  },
);

/**
 * Mongo's TTL monitor sweeps roughly once a minute, so an expired session can
 * still be sitting in the collection when it is looked up. Verification must
 * check expiresAt itself; this index is housekeeping, not the rule.
 */
otpSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

otpSessionSchema.index({ phone: 1, createdAt: -1 });

export const OtpSession: Model<IOtpSession> = model<IOtpSession>('OtpSession', otpSessionSchema);
