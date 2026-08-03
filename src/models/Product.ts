import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import { slugifyOrFallback, uniqueSlug } from '../utils/slugify';
import { seoFields, storedImageSchema, type ISeoFields, type IStoredImage } from './Category';

export type ProductType = 'normal' | 'bolti';

export interface IDimensionsCm {
  l: number;
  b: number;
  h: number;
}

export interface IProduct extends Document<Types.ObjectId>, ISeoFields {
  title: string;
  slug: string;
  description: string;
  shortDescription?: string;
  categoryId: Types.ObjectId;
  images: Types.DocumentArray<IStoredImage>;
  pricePaise: number;
  mrpPaise: number;
  stock: number;
  sku?: string;
  type: ProductType;
  attributes: Map<string, string>;
  weightGrams: number;
  dimensionsCm: IDimensionsCm;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  readonly discountPercent: number;
}

/** Rejects 499.5 outright; the `Paise` suffix is what stops someone entering 499 for ₹499. */
const paiseField = {
  type: Number,
  required: true,
  min: 0,
  validate: {
    validator: Number.isInteger,
    message: '{PATH} must be a whole number of paise (₹499 is 49900, not 499)',
  },
};

const dimensionsSchema = new Schema<IDimensionsCm>(
  {
    l: { type: Number, required: true, min: 0.1 },
    b: { type: Number, required: true, min: 0.1 },
    h: { type: Number, required: true, min: 0.1 },
  },
  { _id: false },
);

const productSchema = new Schema<IProduct>(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    description: { type: String, required: true, trim: true },
    shortDescription: { type: String, trim: true, maxlength: 300 },

    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    images: { type: [storedImageSchema], default: [] },

    // Money is stored as whole paise. Floats accumulate error across an order's
    // line items, and Razorpay wants paise anyway.
    pricePaise: paiseField,
    mrpPaise: paiseField,

    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      validate: { validator: Number.isInteger, message: 'stock must be a whole number' },
    },

    sku: { type: String, trim: true, uppercase: true, unique: true, sparse: true },
    type: { type: String, enum: ['normal', 'bolti'], default: 'normal' },
    attributes: { type: Map, of: String, default: () => new Map<string, string>() },

    // Shiprocket refuses to create a shipment without these. Optional here would
    // mean re-editing every product on the day the first real order ships.
    weightGrams: { type: Number, required: true, min: 1 },
    dimensionsCm: { type: dimensionsSchema, required: true },

    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    ...seoFields,
  },
  {
    timestamps: true,
    // Without this the virtuals below never reach an API response.
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

productSchema.index({ categoryId: 1, isActive: 1 }); // category page
productSchema.index({ isFeatured: 1, isActive: 1 }); // homepage
productSchema.index({ isActive: 1, createdAt: -1 }); // admin list default sort
productSchema.index({ tags: 1 }); // /tag/<name> pages on the public site

// A collection may hold only one text index, so any future searchable field has
// to be folded in here rather than added alongside.
productSchema.index(
  { title: 'text', description: 'text' },
  { weights: { title: 10, description: 1 }, name: 'product_text' },
);

productSchema.path('pricePaise').validate(function (this: IProduct, value: number) {
  return value <= this.mrpPaise;
}, 'pricePaise cannot be greater than mrpPaise');

productSchema.virtual('discountPercent').get(function (this: IProduct) {
  if (!this.mrpPaise || this.mrpPaise <= this.pricePaise) return 0;
  return Math.round(((this.mrpPaise - this.pricePaise) / this.mrpPaise) * 100);
});

// Display helpers — nothing should do arithmetic on these.
productSchema.virtual('priceRupees').get(function (this: IProduct) {
  return this.pricePaise / 100;
});

productSchema.virtual('mrpRupees').get(function (this: IProduct) {
  return this.mrpPaise / 100;
});

/** Same lock as Category: set once, never regenerated on rename. */
productSchema.pre('validate', async function (this: IProduct) {
  if (this.slug) return;

  const ProductModel = this.constructor as Model<IProduct>;
  const base = slugifyOrFallback(this.title, 'product');

  this.slug = await uniqueSlug(base, async (candidate) => {
    const found = await ProductModel.exists({ slug: candidate });
    return found !== null;
  });
});

export const Product: Model<IProduct> = model<IProduct>('Product', productSchema);
