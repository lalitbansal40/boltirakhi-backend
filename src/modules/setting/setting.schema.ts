import { z } from 'zod';
import { SLABS_MAX } from '../../models/Setting';

/** Money is whole paise everywhere: 49900 is Rs 499. */
const paise = z
  .number()
  .int('must be a whole number of paise (Rs 499 is 49900)')
  .min(0);

export const updateSettingSchema = z
  .object({
    freeDeliveryAbovePaise: paise.optional(),

    shippingSlabsPaise: z
      .array(paise.positive('each slab must be above zero'))
      // An empty list would leave pickSlab with nothing to return.
      .min(1, 'at least one shipping slab is required')
      .max(SLABS_MAX, `at most ${SLABS_MAX} shipping slabs`)
      .optional(),

    aboveTopSlab: z.enum(['cap', 'actual']).optional(),
    codEnabled: z.boolean().optional(),
  })
  // An empty PATCH is almost always a bug in the caller, not an intent to
  // change nothing.
  .refine((data) => Object.keys(data).length > 0, {
    message: 'nothing to update',
  });

export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;
