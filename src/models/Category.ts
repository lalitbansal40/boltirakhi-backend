import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import { slugifyOrFallback, uniqueSlug } from '../utils/slugify';

export interface IStoredImage {
  key: string;
  url: string;
  alt?: string;
}

export interface IStoredVideo {
  key: string;
  url: string;
  thumbKey?: string;
  thumbUrl?: string;
  durationSec?: number;
  sizeBytes?: number;
}

/**
 * A product video.
 *
 * `products/` is public-read, so the URL is stored and served directly. Bolti
 * videos are the opposite — a private prefix, signed per request, key only.
 * Two rules for two different things; they must not be merged.
 */
export const storedVideoSchema = new Schema<IStoredVideo>(
  {
    key: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    thumbKey: { type: String, trim: true },
    thumbUrl: { type: String, trim: true },
    // Read off the browser's <video> element, so it is a hint the client
    // supplied rather than something measured here.
    durationSec: { type: Number, min: 0, max: 300 },
    sizeBytes: { type: Number, min: 0 },
  },
  { _id: false },
);

/** Shared by Category and Product — see `seoFields`. */
export interface ISeoFields {
  metaTitle?: string;
  metaDescription?: string;
  tags: string[];
}

export interface ICategory extends Document<Types.ObjectId>, ISeoFields {
  name: string;
  slug: string;
  image?: IStoredImage;
  description?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export const META_TITLE_MAX = 70;
export const META_DESCRIPTION_MAX = 160;
export const TAG_MAX_LENGTH = 40;
export const TAGS_MAX = 15;

/**
 * Lower-cases, trims, drops blanks and de-duplicates.
 *
 * Done in the model rather than the form because "Bhaiya Bhabhi" and
 * "bhaiya bhabhi" arriving as two tags would quietly split one /tag page into
 * two half-filled ones, and nothing would report it.
 */
function normaliseTags(value: unknown): unknown {
  if (!Array.isArray(value)) return value; // let the type cast fail loudly
  const cleaned = value.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
  return [...new Set(cleaned)];
}

/**
 * SEO fields, shared by Category and Product.
 *
 * There is deliberately no `metaKeywords`: Google stopped reading that tag in
 * 2009, so filling it in would be pure wasted effort. `tags` exists for
 * browsable /tag/<name> pages and related-product lookups — those pages are the
 * thing that actually gets indexed.
 *
 * All three are optional. Products entered before this field existed have to
 * keep saving untouched, and the public site falls back to title/description.
 */
export const seoFields = {
  metaTitle: { type: String, trim: true, maxlength: META_TITLE_MAX },
  metaDescription: { type: String, trim: true, maxlength: META_DESCRIPTION_MAX },
  tags: {
    type: [String],
    default: (): string[] => [],
    set: normaliseTags,
    validate: [
      {
        validator: (tags: string[]) => tags.length <= TAGS_MAX,
        message: `at most ${TAGS_MAX} tags`,
      },
      {
        validator: (tags: string[]) => tags.every((tag) => tag.length <= TAG_MAX_LENGTH),
        message: `each tag must be ${TAG_MAX_LENGTH} characters or less`,
      },
    ],
  },
};

/**
 * `key` is the S3 object key; `url` is safe to persist only because
 * products/ and categories/ are public-read. Private prefixes store the key
 * alone and sign a URL per request.
 */
export const storedImageSchema = new Schema<IStoredImage>(
  {
    key: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    alt: { type: String, trim: true, maxlength: 160 },
  },
  { _id: false },
);

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    image: { type: storedImageSchema },
    description: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    ...seoFields,
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

// The public listing: active categories in display order.
categorySchema.index({ isActive: 1, sortOrder: 1 });
categorySchema.index({ tags: 1 });

/**
 * Fills the slug once, on creation, and never again.
 *
 * The slug is the category's public URL and ends up in Google's index and in
 * links shared from Instagram. Regenerating it when someone edits the name
 * would 404 every one of those, which during rakhi season is the traffic.
 * Renaming is fine; the slug stays.
 */
categorySchema.pre('validate', async function (this: ICategory) {
  if (this.slug) return;

  const CategoryModel = this.constructor as Model<ICategory>;
  const base = slugifyOrFallback(this.name, 'category');

  // Counts inactive rows too — the unique index does not care about isActive.
  this.slug = await uniqueSlug(base, async (candidate) => {
    const found = await CategoryModel.exists({ slug: candidate });
    return found !== null;
  });
});

export const Category: Model<ICategory> = model<ICategory>('Category', categorySchema);
