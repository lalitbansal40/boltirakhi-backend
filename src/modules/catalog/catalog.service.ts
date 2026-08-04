import { Category, Product, type ICategory, type IProduct } from '../../models';
import { ApiError, buildPaginated, parsePagination, type Paginated } from '../../utils';
import {
  toPublicCategory,
  toPublicProduct,
  type PublicCategory,
  type PublicProduct,
} from './catalog.serializer';
import { SORT_MAP, type ListProductQuery, type SearchQuery } from './catalog.schema';

/**
 * Nothing inactive ever leaves this module.
 *
 * Written once and spread into every filter rather than typed out per query:
 * forgetting it in one place would put a withdrawn product back on the
 * storefront, and that only surfaces when someone buys it.
 */
const PUBLIC = { isActive: true } as const;

/** The catalogue is small; a large page is a scrape, not a shopper. */
const MAX_LIMIT = 48;
const DEFAULT_LIMIT = 24;

/**
 * `parsePagination` caps at its own 100, which is an admin-sized page.
 * Clamped again here rather than raising a shared limit that the admin
 * screens rely on.
 */
function publicLimit(raw?: string): string {
  const asked = Number(raw);
  if (!Number.isFinite(asked) || asked < 1) return String(DEFAULT_LIMIT);
  return String(Math.min(asked, MAX_LIMIT));
}

/**
 * Slugs arrive from URLs and are matched case-insensitively here.
 *
 * The schema's `lowercase: true` is a document setter — it does not touch
 * query filters, so /RAKHI-SET would otherwise 404 while the page it names
 * exists. The same trap bit coupon codes.
 */
function bySlug(slug: string) {
  return slug.trim().toLowerCase();
}

export async function listCategories(): Promise<PublicCategory[]> {
  // One $lookup over the page rather than a count per row: five categories
  // would otherwise be six round trips to Atlas.
  const rows = await Category.aggregate<ICategory & { productCount: number }>([
    { $match: PUBLIC },
    { $sort: { sortOrder: 1 } },
    {
      $lookup: {
        from: 'products',
        let: { categoryId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$categoryId', '$$categoryId'] },
              isActive: true,
            },
          },
          { $count: 'count' },
        ],
        as: 'counts',
      },
    },
    {
      $addFields: {
        productCount: { $ifNull: [{ $first: '$counts.count' }, 0] },
      },
    },
  ]);

  return rows.map(toPublicCategory);
}

export async function getCategoryBySlug(slug: string): Promise<PublicCategory> {
  const category = await Category.findOne({ slug: bySlug(slug), ...PUBLIC });
  // 404 rather than an empty payload: a deactivated category should drop out
  // of the index, not linger as a page with nothing on it.
  if (!category) throw ApiError.notFound('Category');
  return toPublicCategory(category);
}

export async function listProducts(query: ListProductQuery): Promise<Paginated<PublicProduct>> {
  const { page, limit, skip, sort } = parsePagination(
    { page: query.page, limit: publicLimit(query.limit), sort: SORT_MAP[query.sort ?? 'newest'] },
    {
      allowedSortFields: ['createdAt', 'pricePaise', 'discountPercent'],
      defaultSort: '-createdAt',
      defaultLimit: DEFAULT_LIMIT,
    },
  );

  const filter: Record<string, unknown> = { ...PUBLIC };

  if (query.category) {
    const category = await Category.findOne({ slug: bySlug(query.category), ...PUBLIC })
      .select('_id')
      .lean();

    // An unknown slug is an empty shelf, not a client error — a category can
    // be retired while its link is still in someone's history.
    if (!category) return buildPaginated([], 0, page, limit);
    filter.categoryId = category._id;
  }

  if (query.type) filter.type = query.type;

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.pricePaise = {
      ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}),
      ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}),
    };
  }

  const [items, total] = await Promise.all([
    Product.find(filter).sort(sort).skip(skip).limit(limit).populate('categoryId', 'name slug'),
    Product.countDocuments(filter),
  ]);

  return buildPaginated(items.map(toPublicProduct), total, page, limit);
}

export async function getProductBySlug(slug: string): Promise<PublicProduct> {
  const product = await Product.findOne({ slug: bySlug(slug), ...PUBLIC }).populate(
    'categoryId',
    'name slug',
  );
  if (!product) throw ApiError.notFound('Product');
  return toPublicProduct(product);
}

export async function search(query: SearchQuery): Promise<Paginated<PublicProduct>> {
  const { page, limit, skip } = parsePagination(
    { page: query.page, limit: publicLimit(query.limit) },
    { allowedSortFields: [], defaultSort: '-createdAt', defaultLimit: DEFAULT_LIMIT },
  );

  const filter = { $text: { $search: query.q }, ...PUBLIC };

  const [items, total] = await Promise.all([
    // Sorted by relevance, which is the only ordering a search result can
    // defend. Without the $meta sort MongoDB returns them in whatever order
    // the index walked, and the results look broken.
    Product.find(filter, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .skip(skip)
      .limit(limit)
      .populate('categoryId', 'name slug'),
    Product.countDocuments(filter),
  ]);

  return buildPaginated(
    (items as IProduct[]).map(toPublicProduct),
    total,
    page,
    limit,
  );
}
