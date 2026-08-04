import { Schema, model, type Document, type Model, type Types } from 'mongoose';

export type CouponType = 'percent' | 'flat';

export interface ICoupon extends Document<Types.ObjectId> {
  code: string;
  type: CouponType;
  valuePercent?: number;
  valueFlatPaise?: number;
  maxDiscountPaise?: number;
  minOrderPaise: number;
  validFrom: Date;
  validTo: Date;
  usedCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 100% would hand an order away for free if someone mistyped. 90 is generous
 * enough for any real campaign.
 */
export const MAX_PERCENT = 90;

const couponSchema = new Schema<ICoupon>(
  {
    /**
     * Stored upper-case. Customers type `save20`, and a case-sensitive miss
     * shows them "invalid coupon" on a code that is perfectly valid — which is
     * where the cart gets abandoned.
     *
     * ⚠️ This setter runs on documents, NOT on query filters. Lookups have to
     * upper-case the input themselves.
     */
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 24,
    },

    type: { type: String, enum: ['percent', 'flat'], required: true },

    // Exactly one of these is set; which one is enforced in the zod schema,
    // where the error can name the field.
    valuePercent: { type: Number, min: 1, max: MAX_PERCENT },
    valueFlatPaise: { type: Number, min: 1 },

    /** The "upto Rs 200" cap. Only meaningful alongside `valuePercent`. */
    maxDiscountPaise: { type: Number, min: 1 },

    minOrderPaise: { type: Number, min: 0, default: 0 },

    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },

    /**
     * A tally, not a limit. Coupons here are open to everyone with no cap, so
     * nothing reads this to decide whether the coupon still applies — which is
     * also why incrementing it needs no atomic guard.
     */
    usedCount: { type: Number, min: 0, default: 0 },

    isActive: { type: Boolean, default: true },
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

// The admin list: active coupons, soonest to expire first.
couponSchema.index({ isActive: 1, validTo: 1 });

export const Coupon: Model<ICoupon> = model<ICoupon>('Coupon', couponSchema);
