import { z } from 'zod';

import { objectIdSchema } from '../category/category.schema';

export const idParamSchema = z.object({ id: objectIdSchema });

export const listUserQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
  /** `createdAt`, `totalSpentPaise`, `orderCount`, each optionally `-` prefixed. */
  sort: z.string().optional(),
});

export const userOrdersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  sort: z.string().optional(),
});

export const blockSchema = z.object({ isBlocked: z.boolean() });

export type ListUserQuery = z.infer<typeof listUserQuerySchema>;
export type UserOrdersQuery = z.infer<typeof userOrdersQuerySchema>;
export type BlockInput = z.infer<typeof blockSchema>;
