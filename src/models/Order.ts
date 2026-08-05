import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import type { ProductType } from './Product';

export type OrderStatus =
  | 'created'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface IOrderItem {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  title: string;
  slug: string;
  image?: string;
  pricePaise: number;
  qty: number;
  type: ProductType;
  boltiMessageId?: Types.ObjectId;
}

export interface IOrderAddress {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface IOrder extends Document<Types.ObjectId> {
  orderNumber: string;
  userId: Types.ObjectId;
  items: Types.DocumentArray<IOrderItem>;
  amount: {
    subtotalPaise: number;
    shippingPaise: number;
    discountPaise: number;
    taxPaise: number;
    totalPaise: number;
    currency: string;
  };
  shippingAddress: IOrderAddress;
  isInternational: boolean;
  hasBolti: boolean;
  /**
   * Which coupon was used, if any.
   *
   * Kept so `usedCount` can be incremented exactly once when payment lands,
   * and so a discount on an old order can still be traced back to the code
   * that caused it after that code has been edited or switched off.
   */
  couponId?: Types.ObjectId;
  /**
   * Where the receipt was sent, if one was given.
   *
   * Stored on the order, not on the user: User.email is unique+sparse and
   * belongs to admins, so two customers sharing an address there would break
   * checkout outright. This is a copy, like the shipping address.
   */
  customerEmail?: string;
  payment: {
    provider: string;
    orderId?: string;
    paymentId?: string;
    signature?: string;
    status: PaymentStatus;
    method?: string;
    paidAt?: Date;
  };
  shipping: {
    provider: string;
    shiprocketOrderId?: string;
    shipmentId?: string;
    awb?: string;
    courierName?: string;
    status?: string;
    trackingUrl?: string;
    pickupScheduledAt?: Date;
    lastSyncedAt?: Date;
  };
  status: OrderStatus;
  statusHistory: Types.DocumentArray<{ status: OrderStatus; at: Date; by?: Types.ObjectId; note?: string }>;
  adminNotes: Types.DocumentArray<{ text: string; by?: Types.ObjectId; at: Date }>;
  cancelReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paise = { type: Number, required: true, default: 0, min: 0, validate: { validator: Number.isInteger, message: '{PATH} must be whole paise' } };

/**
 * A copy of the product at purchase time, not a reference.
 *
 * Prices change. If an order only pointed at a productId, last week's order
 * would silently re-price itself and the invoice would stop matching what the
 * customer actually paid.
 */
const orderItemSchema = new Schema<IOrderItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    image: { type: String },
    pricePaise: paise,
    qty: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'qty must be a whole number' } },
    type: { type: String, enum: ['normal', 'bolti'], default: 'normal' },
    boltiMessageId: { type: Schema.Types.ObjectId, ref: 'BoltiMessage' },
  },
  { _id: true },
);

// Embedded for the same reason: the customer may edit or delete the address
// later, and a shipped order's record must not change with it.
const orderAddressSchema = new Schema<IOrderAddress>(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true, default: 'India' },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true, unique: true, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    items: { type: [orderItemSchema], required: true },

    amount: {
      subtotalPaise: paise,
      shippingPaise: paise,
      discountPaise: paise,
      taxPaise: paise,
      totalPaise: paise,
      currency: { type: String, default: 'INR' },
    },

    shippingAddress: { type: orderAddressSchema, required: true },

    // Stored rather than derived: the admin order list filters on both, and a
    // virtual can be neither queried nor indexed.
    isInternational: { type: Boolean, default: false },
    hasBolti: { type: Boolean, default: false },
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon' },
    customerEmail: { type: String, trim: true, lowercase: true },

    payment: {
      provider: { type: String, default: 'razorpay' },
      orderId: { type: String },
      paymentId: { type: String },
      signature: { type: String },
      status: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: 'pending',
      },
      method: { type: String },
      paidAt: { type: Date },
    },

    shipping: {
      provider: { type: String, default: 'shiprocket' },
      shiprocketOrderId: { type: String },
      shipmentId: { type: String },
      awb: { type: String },
      courierName: { type: String },
      status: { type: String },
      trackingUrl: { type: String },
      pickupScheduledAt: { type: Date },
      lastSyncedAt: { type: Date },
    },

    // Which transitions are legal is enforced in the order service, not here —
    // a schema-level rule would also block seeds and admin corrections.
    status: {
      type: String,
      enum: ['created', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'created',
    },

    statusHistory: {
      type: [
        new Schema(
          {
            status: { type: String, required: true },
            at: { type: Date, default: Date.now },
            by: { type: Schema.Types.ObjectId, ref: 'User' },
            note: { type: String },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    adminNotes: {
      type: [
        new Schema(
          {
            text: { type: String, required: true },
            by: { type: Schema.Types.ObjectId, ref: 'User' },
            at: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    cancelReason: { type: String },
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

orderSchema.index({ userId: 1, createdAt: -1 }); // a customer's order history
orderSchema.index({ status: 1, createdAt: -1 }); // admin status filter
orderSchema.index({ createdAt: -1 }); // admin default list
orderSchema.index({ hasBolti: 1 }); // QR print queue
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ 'shipping.awb': 1 }, { sparse: true }); // tracking lookups

/** Keeps the two filter flags in step with the data they summarise. */
orderSchema.pre('validate', function (this: IOrder) {
  if (this.shippingAddress?.country) {
    this.isInternational = this.shippingAddress.country.trim().toLowerCase() !== 'india';
  }

  if (Array.isArray(this.items)) {
    this.hasBolti = this.items.some((item) => item.type === 'bolti');
  }
});

export const Order: Model<IOrder> = model<IOrder>('Order', orderSchema);
