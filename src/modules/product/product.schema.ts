import { z } from 'zod';
import { objectIdSchema, seoSchemaFields } from '../category/category.schema';

export const idParamSchema = z.object({ id: objectIdSchema });

/** Money is whole paise everywhere: 49900 is Rs 499. */
const paise = z
  .number()
  .int('must be a whole number of paise (Rs 499 is 49900)')
  .min(0);

const imageSchema = z.object({
  key: z.string().min(1),
  url: z.url(),
  alt: z.string().max(160).optional(),
});

const dimensionsSchema = z.object({
  l: z.number().positive(),
  b: z.number().positive(),
  h: z.number().positive(),
});

/**
 * Plain object, no refinements — zod v4 refuses `.partial()` on a schema that
 * carries one, so the price/mrp rule is attached after each variant is shaped.
 */
const productFields = z
  .object({
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().min(1),
    shortDescription: z.string().trim().max(300).optional(),
    categoryId: objectIdSchema,
    images: z.array(imageSchema).optional(),
    pricePaise: paise,
    mrpPaise: paise,
    stock: z.number().int().min(0),
    sku: z.string().trim().max(60).optional(),
    type: z.enum(['normal', 'bolti']).optional(),
    attributes: z.record(z.string(), z.string()).optional(),
    // Shiprocket will not create a shipment without these.
    weightGrams: z.number().int().min(1),
    dimensionsCm: dimensionsSchema,
    isActive: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    ...seoSchemaFields,
  });

// Also enforced by the model; checking here turns it into a clean field-level
// 400 instead of a mongoose ValidationError.
export const createProductSchema = productFields.refine(
  (data) => data.pricePaise <= data.mrpPaise,
  { message: 'cannot be greater than mrpPaise', path: ['pricePaise'] },
);

/**
 * No `slug`: it is the public URL and stays fixed once created.
 *
 * The price rule only applies when both values are in the payload — a partial
 * update sending price alone is checked by the service against the stored mrp.
 */
export const updateProductSchema = productFields
  .partial()
  .refine(
    (data) =>
      data.pricePaise === undefined ||
      data.mrpPaise === undefined ||
      data.pricePaise <= data.mrpPaise,
    { message: 'cannot be greater than mrpPaise', path: ['pricePaise'] },
  );

/** Inline edit from the product list — deliberately a tiny payload. */
export const priceSchema = z.object({
  pricePaise: paise,
  mrpPaise: paise.optional(),
});

export const stockSchema = z
  .object({
    set: z.number().int().min(0).optional(),
    increment: z.number().int().optional(),
  })
  .refine((data) => (data.set === undefined) !== (data.increment === undefined), {
    message: 'provide exactly one of set or increment',
  });

export const statusSchema = z.object({ isActive: z.boolean() });
export const featureSchema = z.object({ isFeatured: z.boolean() });

const boolish = z
  .string()
  .optional()
  .transform((value) => value === 'true');

export const listProductQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  categoryId: objectIdSchema.optional(),
  type: z.enum(['normal', 'bolti']).optional(),
  isFeatured: z.enum(['true', 'false']).optional(),
  lowStock: boolish,
  includeInactive: boolish,
  page: z.string().optional(),
  limit: z.string().optional(),
  sort: z.string().optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type PriceInput = z.infer<typeof priceSchema>;
export type StockInput = z.infer<typeof stockSchema>;
export type ListProductQuery = z.infer<typeof listProductQuerySchema>;
