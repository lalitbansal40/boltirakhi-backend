import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import { slugifyOrFallback, uniqueSlug } from '../utils/slugify';
import {
  seoFields,
  storedImageSchema,
  storedVideoSchema,
  type ISeoFields,
  type IStoredImage,
  type IStoredVideo,
} from './Category';

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
  /** Optional — most products are stills only. */
  video?: IStoredVideo;
  /**
   * The price of ONE rakhi. Also the price of the pack-of-1 variant.
   *
   * Kept on the product itself because the catalogue sorts and filters on it —
   * moving it onto a variant would take half the listing code with it.
   */
  pricePaise: number;
  mrpPaise: number;
  /**
   * Rakhis in stock, not packs.
   *
   * One pool, deliberately. A pack of 8 sold takes 8 from here. Per-pack
   * counters would be five numbers describing one shelf, and one day they
   * would stop agreeing — with nobody able to say which was right.
   */
  stock: number;
  /**
   * Multi-packs. Empty means the product sells as a single only, which is the
   * default and what every existing product does.
   */
  variants: Types.DocumentArray<IPackVariant>;
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

/**
 * The pack sizes a customer can buy.
 *
 * A closed list rather than any number: an arbitrary "pack of 3" would need
 * its own price, its own SKU and its own line in the warehouse, and nobody
 * asked for one.
 */
export const PACK_SIZES = [1, 2, 4, 6, 8] as const;
export type PackSize = (typeof PACK_SIZES)[number];

export interface IPackVariant {
  packSize: PackSize;
  /** What the whole pack costs. NOT the single price times the size. */
  pricePaise: number;
  mrpPaise: number;
  /** Its own code — this is what gets picked in the warehouse. */
  sku: string;
  isActive: boolean;
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

/**
 * A multi-pack.
 *
 * Its price is entered, not calculated. A pack priced at exactly the single
 * price times its size gives a customer no reason to buy it, so the number has
 * to be a decision somebody made, not arithmetic.
 */
const packVariantSchema = new Schema<IPackVariant>(
  {
    packSize: { type: Number, required: true, enum: PACK_SIZES },
    pricePaise: paiseField,
    mrpPaise: paiseField,
    sku: { type: String, required: true, trim: true, uppercase: true },
    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

packVariantSchema.path("pricePaise").validate(function (this: IPackVariant, value: number) {
  return value <= this.mrpPaise;
}, "pack price cannot be above its MRP");

const productSchema = new Schema<IProduct>(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    description: { type: String, required: true, trim: true },
    shortDescription: { type: String, trim: true, maxlength: 300 },

    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    images: { type: [storedImageSchema], default: [] },
    // Empty by default: every product sells as a single until somebody adds
    // packs, and the existing catalogue depends on that staying true.
    variants: { type: [packVariantSchema], default: [] },
    // Optional: every product entered before this existed has none.
    video: { type: storedVideoSchema },

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

// A collection may hold only one text index, so tags had to be folded into
// this one rather than added alongside.
//
// Changing the fields here does NOT drop the old index. Mongoose tries to
// build the new one, MongoDB refuses with 'only one text index allowed', and
// the server carries on with neither the error nor the index visible anywhere.
// `npm run reindex` is what actually swaps them.
productSchema.index(
  { title: 'text', description: 'text', tags: 'text' },
  {
    // Tags outrank description: a tag was chosen deliberately, whereas a word
    // can land in a description by coincidence.
    weights: { title: 10, tags: 5, description: 1 },
    name: 'product_text_v2',
  },
);

/**
 * One entry per pack size.
 *
 * Two "pack of 4" rows would leave the interface picking whichever came first,
 * and an admin staring at a price that is not the one they edited.
 */
productSchema.path('variants').validate(function (variants: IPackVariant[]) {
  const sizes = variants.map((variant) => variant.packSize);
  return new Set(sizes).size === sizes.length;
}, 'A product cannot have two variants of the same pack size');

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
