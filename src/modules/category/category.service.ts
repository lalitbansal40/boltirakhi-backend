import { Types } from 'mongoose';
import { Category, Product, type ICategory } from '../../models';
import { ApiError, buildPaginated, parsePagination, type Paginated } from '../../utils';
import { containsRegex } from '../../utils/escapeRegex';
import type {
  CreateCategoryInput,
  ListCategoryQuery,
  ReorderInput,
  UpdateCategoryInput,
} from './category.schema';

const SORTABLE = ['sortOrder', 'name', 'createdAt', 'updatedAt'] as const;

export interface CategoryWithCount {
  productCount: number;
  [key: string]: unknown;
}

/**
 * Lists categories with how many active products each holds.
 *
 * The count comes from one $lookup on the already-paginated page rather than a
 * count query per row — twenty categories would otherwise be twenty-one round
 * trips to Atlas.
 */
export async function list(query: ListCategoryQuery): Promise<Paginated<CategoryWithCount>> {
  const { page, limit, skip, sort } = parsePagination(query as Record<string, unknown>, {
    allowedSortFields: SORTABLE,
    defaultSort: 'sortOrder',
  });

  const filter: Record<string, unknown> = {};

  // Inactive rows are hidden unless asked for; the admin list has a toggle.
  if (!query.includeInactive) filter.isActive = true;
  if (query.q) filter.name = containsRegex(query.q);

  const [items, total] = await Promise.all([
    Category.aggregate<CategoryWithCount>([
      { $match: filter },
      { $sort: sort },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: Product.collection.name,
          let: { categoryId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$categoryId', '$$categoryId'] }, isActive: true } },
            { $count: 'total' },
          ],
          as: 'counts',
        },
      },
      {
        $addFields: {
          productCount: { $ifNull: [{ $arrayElemAt: ['$counts.total', 0] }, 0] },
        },
      },
      { $project: { counts: 0, __v: 0 } },
    ]),
    Category.countDocuments(filter),
  ]);

  return buildPaginated(items, total, page, limit);
}

/** Returns inactive categories too — the admin has to be able to edit one it deactivated. */
export async function getById(id: string): Promise<ICategory> {
  const category = await Category.findById(id);
  if (!category) throw ApiError.notFound('Category');

  return category;
}

export async function create(input: CreateCategoryInput): Promise<ICategory> {
  // The model's pre-validate hook derives a unique slug from the name.
  return Category.create(input);
}

export async function update(id: string, input: UpdateCategoryInput): Promise<ICategory> {
  const category = await getById(id);

  Object.assign(category, input);
  await category.save();

  return category;
}

export async function setStatus(id: string, isActive: boolean): Promise<ICategory> {
  const category = await getById(id);

  if (!isActive) await assertNoActiveProducts(id, 'deactivate');

  category.isActive = isActive;
  await category.save();

  return category;
}

export async function reorder(input: ReorderInput): Promise<number> {
  const result = await Category.bulkWrite(
    input.items.map(({ id, sortOrder }) => ({
      updateOne: {
        filter: { _id: new Types.ObjectId(id) },
        update: { $set: { sortOrder } },
      },
    })),
  );

  return result.modifiedCount;
}

/** Soft delete only — orders reference products, which reference categories. */
export async function softDelete(id: string): Promise<void> {
  const category = await getById(id);

  await assertNoActiveProducts(id, 'delete');

  category.isActive = false;
  await category.save();
}

/**
 * Blocks removing a category that still has products, and says how many so the
 * admin knows what to move first.
 *
 * Only active products count. Including soft-deleted ones would make a category
 * that once held products impossible to ever remove.
 */
async function assertNoActiveProducts(categoryId: string, action: string): Promise<void> {
  const productCount = await Product.countDocuments({ categoryId, isActive: true });

  if (productCount > 0) {
    throw new ApiError(
      409,
      `Cannot ${action} a category that still has ${productCount} active product(s)`,
      'CATEGORY_HAS_PRODUCTS',
      { productCount },
    );
  }
}
