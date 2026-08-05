import type { ICategory } from '../../models/Category';
import type { IProduct } from '../../models/Product';

/**
 * The only place a product or category takes its public shape.
 *
 * Every catalogue endpoint goes through here rather than writing its own
 * `.select()`. With half a dozen endpoints each choosing their own fields, the
 * last one written is where `sku` leaks — and nothing reports it, because a
 * field appearing in a response is not an error.
 *
 * It also works where `.select()` does not: aggregation pipelines ignore
 * `select: false`, so a projection is a promise the query layer cannot always
 * keep. This runs on the output.
 */

interface PublicImage {
  url: string;
  alt?: string;
}

interface PublicVideo {
  url: string;
  thumbUrl?: string;
  durationSec?: number;
}

interface PublicCategoryRef {
  _id: string;
  name: string;
  slug: string;
}

/**
 * A multi-pack, as the shop sees it.
 *
 * `savingPaise` is computed here rather than in the browser. A number the
 * interface works out itself is a second place it can be wrong, and this one
 * is the reason anybody clicks a bigger pack.
 */
export interface PublicVariant {
  packSize: number;
  pricePaise: number;
  mrpPaise: number;
  /** What the pack saves against buying that many singles. Never below zero. */
  savingPaise: number;
  inStock: boolean;
}

export interface PublicProduct {
  _id: string;
  title: string;
  slug: string;
  description: string;
  shortDescription?: string;
  categoryId: string | PublicCategoryRef;
  images: PublicImage[];
  video?: PublicVideo;
  pricePaise: number;
  mrpPaise: number;
  discountPercent: number;
  /** Whether it can be bought — never how many are left. */
  inStock: boolean;
  variants: PublicVariant[];
  type: string;
  tags?: string[];
  metaTitle?: string;
  metaDescription?: string;
}

export interface PublicCategory {
  _id: string;
  name: string;
  slug: string;
  image?: PublicImage;
  description?: string;
  productCount?: number;
  metaTitle?: string;
  metaDescription?: string;
}

/** Populated it is an object; unpopulated it is an ObjectId. Both arrive here. */
function categoryRef(value: unknown): string | PublicCategoryRef {
  if (value && typeof value === 'object' && 'name' in value) {
    const category = value as ICategory;
    return {
      _id: String(category._id),
      name: category.name,
      slug: category.slug,
    };
  }
  return String(value);
}

export function toPublicProduct(product: IProduct): PublicProduct {
  return {
    _id: String(product._id),
    title: product.title,
    slug: product.slug,
    description: product.description,
    shortDescription: product.shortDescription,
    categoryId: categoryRef(product.categoryId),

    // Keys are internal: the URL is all a browser needs, and the key is how
    // an object is addressed in the bucket.
    images: product.images.map((image) => ({ url: image.url, alt: image.alt })),
    video: product.video
      ? {
          url: product.video.url,
          thumbUrl: product.video.thumbUrl,
          durationSec: product.video.durationSec,
        }
      : undefined,

    pricePaise: product.pricePaise,
    mrpPaise: product.mrpPaise,
    discountPercent: product.discountPercent,

    // A boolean, not a count. The exact number tells a competitor how large
    // the operation is, and a customer only ever needs to know whether they
    // can buy it.
    inStock: product.stock > 0,
    /**
     * Only variants that are switched on, and each carries a boolean rather
     * than a count — the shelf quantity is nobody outside our business.
     */
    variants: (product.variants ?? [])
      .filter((variant) => variant.isActive)
      .sort((a, b) => a.packSize - b.packSize)
      .map((variant) => ({
        packSize: variant.packSize,
        pricePaise: variant.pricePaise,
        mrpPaise: variant.mrpPaise,
        savingPaise: Math.max(0, product.pricePaise * variant.packSize - variant.pricePaise),
        // A pack is only buyable if there are enough singles behind it.
        inStock: product.stock >= variant.packSize,
      })),

    type: product.type,
    tags: product.tags,
    metaTitle: product.metaTitle,
    metaDescription: product.metaDescription,
  };
}

export function toPublicCategory(
  category: ICategory & { productCount?: number },
): PublicCategory {
  return {
    _id: String(category._id),
    name: category.name,
    slug: category.slug,
    image: category.image ? { url: category.image.url, alt: category.image.alt } : undefined,
    description: category.description,
    productCount: category.productCount,
    metaTitle: category.metaTitle,
    metaDescription: category.metaDescription,
  };
}
