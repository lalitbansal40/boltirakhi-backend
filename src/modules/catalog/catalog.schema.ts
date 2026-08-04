import { z } from 'zod';

/** Slugs travel in URLs, where case is not guaranteed. */
export const slugParamSchema = z.object({
  slug: z.string().trim().min(1).max(200),
});

/**
 * Sort names the public may use.
 *
 * Deliberately not the database field names: `pricePaise` in a URL tells a
 * stranger how the collection is shaped, and locks the URL to the schema.
 */
export const SORT_MAP = {
  newest: '-createdAt',
  'price-asc': 'pricePaise',
  'price-desc': '-pricePaise',
  discount: '-discountPercent',
} as const;

export type PublicSort = keyof typeof SORT_MAP;

/** Money is whole paise here too: minPrice=49900 is Rs 499. */
const paiseParam = z
  .string()
  .regex(/^\d+$/, 'must be a whole number of paise')
  .transform(Number)
  .optional();

export const listProductQuerySchema = z.object({
  category: z.string().trim().min(1).max(200).optional(),
  type: z.enum(['normal', 'bolti']).optional(),
  minPrice: paiseParam,
  maxPrice: paiseParam,
  sort: z.enum(['newest', 'price-asc', 'price-desc', 'discount']).optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const searchQuerySchema = z.object({
  // One letter matches most of the catalogue and makes the text index work
  // for nothing; an empty q would return everything, which is not a search.
  q: z.string().trim().min(2, 'Enter at least 2 characters').max(80),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export type ListProductQuery = z.infer<typeof listProductQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
