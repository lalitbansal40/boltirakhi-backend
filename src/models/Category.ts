import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import { slugifyOrFallback, uniqueSlug } from '../utils/slugify';

export interface IStoredImage {
  key: string;
  url: string;
  alt?: string;
}

export interface ICategory extends Document<Types.ObjectId> {
  name: string;
  slug: string;
  image?: IStoredImage;
  description?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

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
