import { z } from 'zod';

import { objectIdSchema } from '../category/category.schema';

export const idParamSchema = z.object({ id: objectIdSchema });

export const ORDER_STATUSES = [
  'created',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
] as const;

export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'] as const;

/** `YYYY-MM-DD`, read as an IST calendar day (D12). */
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .optional();

/**
 * Boolean flags arrive as strings and are compared as strings, matching the
 * convention the product module already set. A real boolean in the query
 * string is not something Express can give us anyway.
 */
const boolish = z
  .string()
  .optional()
  .transform((value) => value === 'true');

export const listOrderQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  from: dateOnly,
  to: dateOnly,
  isInternational: boolish,
  hasBolti: boolish,
  page: z.string().optional(),
  limit: z.string().optional(),
  sort: z.string().optional(),
});

/** Export takes the same filters as the list, minus pagination. */
export const exportOrderQuerySchema = listOrderQuerySchema.omit({
  page: true,
  limit: true,
  sort: true,
});

export const updateStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(500).optional(),
});

export const addNoteSchema = z.object({
  text: z.string().trim().min(1, 'cannot be empty').max(1000),
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(1, 'cannot be empty').max(500),
});

/**
 * Manual shipping entry, for the stretch before Shiprocket (C.6) exists.
 *
 * The admin creates the shipment in Shiprocket's own dashboard and pastes the
 * AWB back here. Once C.6 lands this stays useful for the cases the API
 * cannot handle — a courier booked over the phone, say.
 */
export const updateShippingSchema = z
  .object({
    awb: z.string().trim().max(200).optional(),
    courierName: z.string().trim().max(200).optional(),
    trackingUrl: z.string().trim().max(200).optional(),
    status: z.string().trim().max(200).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'provide at least one shipping field',
  });

export type ListOrderQuery = z.infer<typeof listOrderQuerySchema>;
export type ExportOrderQuery = z.infer<typeof exportOrderQuerySchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type AddNoteInput = z.infer<typeof addNoteSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type UpdateShippingInput = z.infer<typeof updateShippingSchema>;
