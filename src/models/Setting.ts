import { Schema, model, type Document, type Model, type Types } from 'mongoose';

/**
 * How the customer is charged for delivery when the courier quote is higher
 * than the top slab.
 *
 *   cap    — charge the top slab and absorb the difference
 *   actual — pass the real cost through
 */
export type AboveTopSlab = 'cap' | 'actual';

export interface ISetting extends Document<Types.ObjectId> {
  key: 'store';
  freeDeliveryAbovePaise: number;
  shippingSlabsPaise: number[];
  aboveTopSlab: AboveTopSlab;
  codEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const SLABS_MAX = 12;

/**
 * Money is whole paise, same as everywhere else — 4900 is Rs 49. Writing 49
 * here would silently make delivery cost 49 paise.
 *
 * The slabs run past the five we started with on purpose: a far pincode with a
 * heavy chocolate box quotes more than Rs 199, and a list that stops there
 * would quietly cap every one of those orders.
 */
export const SETTING_DEFAULTS = {
  freeDeliveryAbovePaise: 49900, // Rs 499
  shippingSlabsPaise: [4900, 7900, 9900, 14900, 19900, 24900, 29900, 39900],
  aboveTopSlab: 'cap' as AboveTopSlab,
  codEnabled: false,
};

const wholePaise = {
  type: Number,
  min: 0,
  validate: {
    validator: Number.isInteger,
    message: '{PATH} must be a whole number of paise (Rs 499 is 49900, not 499)',
  },
};

const settingSchema = new Schema<ISetting>(
  {
    // One row, always. `key` exists so the upsert has something to match on.
    key: { type: String, enum: ['store'], required: true, unique: true, default: 'store' },

    freeDeliveryAbovePaise: {
      ...wholePaise,
      required: true,
      default: SETTING_DEFAULTS.freeDeliveryAbovePaise,
    },

    shippingSlabsPaise: {
      type: [Number],
      required: true,
      default: () => [...SETTING_DEFAULTS.shippingSlabsPaise],
      validate: [
        {
          validator: (slabs: number[]) => slabs.length > 0,
          // pickSlab has nothing to return from an empty list.
          message: 'at least one shipping slab is required',
        },
        {
          validator: (slabs: number[]) => slabs.length <= SLABS_MAX,
          message: `at most ${SLABS_MAX} shipping slabs`,
        },
        {
          validator: (slabs: number[]) => slabs.every((s) => Number.isInteger(s) && s > 0),
          message: 'each slab must be a whole number of paise above zero',
        },
      ],
    },

    aboveTopSlab: {
      type: String,
      enum: ['cap', 'actual'],
      required: true,
      default: SETTING_DEFAULTS.aboveTopSlab,
    },

    // Not wired to anything yet; the checkout will read it in Phase 2.
    codEnabled: { type: Boolean, default: SETTING_DEFAULTS.codEnabled },
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

export const Setting: Model<ISetting> = model<ISetting>('Setting', settingSchema);
