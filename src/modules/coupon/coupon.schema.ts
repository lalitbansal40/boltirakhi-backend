import { z } from 'zod';
import { MAX_PERCENT } from '../../models/Coupon';
import { objectIdSchema } from '../category/category.schema';

export const idParamSchema = z.object({ id: objectIdSchema });

/** Money is whole paise everywhere: 49900 is Rs 499. */
const paise = z
  .number()
  .int('must be a whole number of paise (Rs 499 is 49900)')
  .positive();

/** A plain YYYY-MM-DD. The service turns it into IST day boundaries. */
const istDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date as YYYY-MM-DD');

const couponFields = z.object({
  code: z
    .string()
    .trim()
    .min(3, 'must be at least 3 characters')
    .max(24)
    .regex(/^[A-Za-z0-9]+$/, 'letters and numbers only'),

  type: z.enum(['percent', 'flat']),
  valuePercent: z.number().int().min(1).max(MAX_PERCENT).optional(),
  valueFlatPaise: paise.optional(),
  maxDiscountPaise: paise.optional(),
  minOrderPaise: z.number().int().min(0).optional(),

  validFrom: istDay,
  validTo: istDay,
  isActive: z.boolean().optional(),
});

/**
 * Checks that only make sense across fields.
 *
 * Leaving `valuePercent` and `valueFlatPaise` as two independent optionals
 * would let a coupon exist with both set, and nothing downstream could say
 * which one was meant to apply.
 */
function crossFieldRules(
  data: Partial<z.infer<typeof couponFields>>,
  ctx: z.RefinementCtx,
): void {
  if (data.type === 'percent') {
    if (data.valuePercent === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['valuePercent'],
        message: 'required for a percentage coupon',
      });
    }
    if (data.valueFlatPaise !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['valueFlatPaise'],
        message: 'not allowed on a percentage coupon',
      });
    }
  }

  if (data.type === 'flat') {
    if (data.valueFlatPaise === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['valueFlatPaise'],
        message: 'required for a flat coupon',
      });
    }
    if (data.valuePercent !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['valuePercent'],
        message: 'not allowed on a flat coupon',
      });
    }
    // "Flat Rs 500, up to Rs 200" has no meaning — the cap can only bite on a
    // percentage.
    if (data.maxDiscountPaise !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxDiscountPaise'],
        message: 'only applies to a percentage coupon',
      });
    }
  }

  if (data.validFrom && data.validTo && data.validTo < data.validFrom) {
    ctx.addIssue({
      code: 'custom',
      path: ['validTo'],
      message: 'cannot be before validFrom',
    });
  }
}

export const createCouponSchema = couponFields.superRefine(crossFieldRules);

/**
 * No `usedCount`: it is the server's tally, never something a caller sets.
 *
 * `code` is accepted here but the service refuses to change it once the coupon
 * has been used.
 */
export const updateCouponSchema = couponFields.partial().superRefine((data, ctx) => {
  if (Object.keys(data).length === 0) {
    ctx.addIssue({ code: 'custom', message: 'nothing to update' });
    return;
  }
  // Only worth cross-checking when the payload actually names a type.
  if (data.type !== undefined) crossFieldRules(data, ctx);
});

export const statusSchema = z.object({ isActive: z.boolean() });

/** What the public checkout sends. */
export const validateCouponSchema = z.object({
  code: z.string().trim().min(1, 'Enter a coupon code').max(24),
  subtotalPaise: z.number().int().min(0),
});

const boolish = z
  .string()
  .optional()
  .transform((value) => value === 'true');

export const listCouponQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  expired: boolish,
  page: z.string().optional(),
  limit: z.string().optional(),
  sort: z.string().optional(),
});

export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
export type ListCouponQuery = z.infer<typeof listCouponQuerySchema>;
