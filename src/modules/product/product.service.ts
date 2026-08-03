import { Category, Product, type IProduct } from '../../models';
import { ApiError, buildPaginated, parsePagination, type Paginated } from '../../utils';
import { containsRegex } from '../../utils/escapeRegex';
import type {
  CreateProductInput,
  ListProductQuery,
  PriceInput,
  StockInput,
  UpdateProductInput,
} from './product.schema';

const SORTABLE = ['createdAt', 'updatedAt', 'pricePaise', 'stock', 'title', 'sortOrder'] as const;
const LOW_STOCK_THRESHOLD = 5;

export async function list(query: ListProductQuery): Promise<Paginated<IProduct>> {
  const { page, limit, skip, sort } = parsePagination(query as Record<string, unknown>, {
    allowedSortFields: SORTABLE,
    defaultSort: '-createdAt',
  });

  const filter: Record<string, unknown> = {};

  if (!query.includeInactive) filter.isActive = true;
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.type) filter.type = query.type;
  if (query.isFeatured) filter.isFeatured = query.isFeatured === 'true';
  if (query.lowStock) filter.stock = { $lte: LOW_STOCK_THRESHOLD };

  /**
   * Regex rather than the $text index.
   *
   * Mongo's text search stems for English, so a Devanagari title — which most
   * of this catalogue will be — matches nothing. Regex is slower but it is the
   * only one that finds "रक्षाबंधन". containsRegex escapes the input, so a "."
   * or "(a+)+" in the search box cannot break or hang the query.
   */
  if (query.q) {
    const pattern = containsRegex(query.q);
    filter.$or = [{ title: pattern }, { description: pattern }, { sku: pattern }];
  }

  const [items, total] = await Promise.all([
    Product.find(filter)
      .populate('categoryId', 'name slug')
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Product.countDocuments(filter),
  ]);

  return buildPaginated(items, total, page, limit);
}

/** Returns inactive products too, so a deactivated one can still be edited. */
export async function getById(id: string): Promise<IProduct> {
  const product = await Product.findById(id).populate('categoryId', 'name slug');
  if (!product) throw ApiError.notFound('Product');

  return product;
}

export async function create(input: CreateProductInput): Promise<IProduct> {
  await assertCategoryExists(input.categoryId);

  // The model's pre-validate hook derives a unique slug from the title.
  return Product.create(input);
}

export async function update(id: string, input: UpdateProductInput): Promise<IProduct> {
  const product = await Product.findById(id);
  if (!product) throw ApiError.notFound('Product');

  if (input.categoryId) await assertCategoryExists(input.categoryId);

  Object.assign(product, input);
  await product.save();

  return product.populate('categoryId', 'name slug');
}

/**
 * Inline price edit from the list screen.
 *
 * When only pricePaise is sent, it is checked against the stored mrp — the
 * comparison cannot be skipped just because the payload is partial.
 */
export async function updatePrice(id: string, input: PriceInput): Promise<IProduct> {
  const product = await Product.findById(id);
  if (!product) throw ApiError.notFound('Product');

  const mrpPaise = input.mrpPaise ?? product.mrpPaise;

  if (input.pricePaise > mrpPaise) {
    throw ApiError.validation(
      [{ field: 'pricePaise', message: `cannot be greater than mrpPaise (${mrpPaise})` }],
      'Price cannot exceed MRP',
    );
  }

  product.pricePaise = input.pricePaise;
  product.mrpPaise = mrpPaise;
  await product.save();

  return product;
}

/**
 * Inline stock edit.
 *
 * `increment` goes through $inc rather than read-modify-write: two admins
 * adjusting the same product at once would otherwise silently lose one of the
 * changes. The guarded filter is what stops stock going negative — checking
 * first and writing after would reopen the same race.
 */
export async function updateStock(id: string, input: StockInput): Promise<IProduct> {
  if (input.set !== undefined) {
    const product = await Product.findByIdAndUpdate(
      id,
      { $set: { stock: input.set } },
      { returnDocument: 'after', runValidators: true },
    );
    if (!product) throw ApiError.notFound('Product');

    return product;
  }

  const delta = input.increment!;
  const filter =
    delta < 0 ? { _id: id, stock: { $gte: Math.abs(delta) } } : { _id: id };

  const product = await Product.findOneAndUpdate(
    filter,
    { $inc: { stock: delta } },
    { returnDocument: 'after' },
  );

  if (!product) {
    // Either it does not exist, or the decrement would have gone below zero.
    const exists = await Product.exists({ _id: id });
    if (!exists) throw ApiError.notFound('Product');

    throw ApiError.badRequest('Not enough stock for that decrement');
  }

  return product;
}

export async function setStatus(id: string, isActive: boolean): Promise<IProduct> {
  const product = await Product.findByIdAndUpdate(
    id,
    { $set: { isActive } },
    { returnDocument: 'after' },
  );
  if (!product) throw ApiError.notFound('Product');

  return product;
}

export async function setFeatured(id: string, isFeatured: boolean): Promise<IProduct> {
  const product = await Product.findByIdAndUpdate(
    id,
    { $set: { isFeatured } },
    { returnDocument: 'after' },
  );
  if (!product) throw ApiError.notFound('Product');

  return product;
}

/** Soft delete — orders hold snapshots, but the reference should still resolve. */
export async function softDelete(id: string): Promise<void> {
  const product = await Product.findByIdAndUpdate(id, { $set: { isActive: false } });
  if (!product) throw ApiError.notFound('Product');
}

async function assertCategoryExists(categoryId: string): Promise<void> {
  const exists = await Category.exists({ _id: categoryId });
  if (!exists) {
    throw ApiError.validation([{ field: 'categoryId', message: 'category does not exist' }]);
  }
}
