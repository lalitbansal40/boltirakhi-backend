import { randomBytes } from 'crypto';
import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import { env } from '../config/env';

export type BoltiStatus = 'draft' | 'ready' | 'qr_failed';

export interface IBoltiPhoto {
  key: string;
}

export interface IBoltiMessage extends Document<Types.ObjectId> {
  orderId?: Types.ObjectId;
  orderItemId?: Types.ObjectId;
  userId?: Types.ObjectId;
  token: string;
  videoKey?: string;
  videoThumbKey?: string;
  videoDurationSec?: number;
  letterText?: string;
  photos: Types.DocumentArray<IBoltiPhoto>;
  senderName?: string;
  receiverName?: string;
  revealUrl: string;
  qrKey?: string;
  qrGeneratedAt?: Date;
  status: BoltiStatus;
  isRevealed: boolean;
  revealedAt?: Date;
  revealCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The reveal page has no login — whoever holds the link sees the video, so the
 * token is the entire access control.
 *
 * 12 random bytes is 96 bits, which cannot be guessed or enumerated. A
 * sequential id or anything derived from an ObjectId would let someone walk
 * the range and watch other families' private messages. base64url keeps it
 * safe to drop straight into a URL.
 */
export function generateBoltiToken(): string {
  return randomBytes(12).toString('base64url');
}

const boltiPhotoSchema = new Schema<IBoltiPhoto>(
  { key: { type: String, required: true, trim: true } },
  { _id: false },
);

const boltiMessageSchema = new Schema<IBoltiMessage>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    orderItemId: { type: Schema.Types.ObjectId },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },

    token: {
      type: String,
      required: true,
      unique: true,
      default: generateBoltiToken,
    },

    // Keys only. bolti/ is a private prefix, so a URL stored today returns 403
    // tomorrow; the reveal page signs a fresh one from the key on each view.
    // That is also why the printed QR keeps working forever while no single
    // link stays valid.
    videoKey: { type: String, trim: true },
    videoThumbKey: { type: String, trim: true },
    videoDurationSec: { type: Number, min: 0 },

    letterText: { type: String, trim: true, maxlength: 2000 },
    photos: { type: [boltiPhotoSchema], default: [] },

    senderName: { type: String, trim: true, maxlength: 100 },
    receiverName: { type: String, trim: true, maxlength: 100 },

    revealUrl: { type: String, required: true },

    qrKey: { type: String, trim: true },
    qrGeneratedAt: { type: Date },

    status: {
      type: String,
      enum: ['draft', 'ready', 'qr_failed'],
      default: 'draft',
      index: true,
    },

    isRevealed: { type: Boolean, default: false },
    revealedAt: { type: Date },
    revealCount: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

boltiMessageSchema.index({ orderId: 1 });

/** revealUrl is derived from the token; PUBLIC_SITE_URL already has no trailing slash. */
boltiMessageSchema.pre('validate', function (this: IBoltiMessage) {
  if (!this.revealUrl && this.token) {
    this.revealUrl = `${env.PUBLIC_SITE_URL}/r/${this.token}`;
  }
});

export const BoltiMessage: Model<IBoltiMessage> = model<IBoltiMessage>(
  'BoltiMessage',
  boltiMessageSchema,
);
