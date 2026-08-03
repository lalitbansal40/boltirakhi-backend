import { z } from 'zod';

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'must be a valid id');

export const idParamSchema = z.object({ id: objectIdSchema });

const imageSchema = z.object({
  key: z.string().min(1),
  url: z.url(),
  alt: z.string().max(160).optional(),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'must be at least 2 characters').max(80),
  image: imageSchema.optional(),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

/**
 * `slug` is deliberately absent. It is the public URL, already indexed by
 * Google and pasted into Instagram links, so renaming a category must not
 * change it. Anything sent here is dropped by zod rather than applied.
 */
export const updateCategorySchema = createCategorySchema.partial();

export const statusSchema = z.object({ isActive: z.boolean() });

export const reorderSchema = z.object({
  items: z
    .array(z.object({ id: objectIdSchema, sortOrder: z.number().int() }))
    .min(1, 'must contain at least one item')
    .max(200),
});

export const listCategoryQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  includeInactive: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  page: z.string().optional(),
  limit: z.string().optional(),
  sort: z.string().optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
export type ListCategoryQuery = z.infer<typeof listCategoryQuerySchema>;
