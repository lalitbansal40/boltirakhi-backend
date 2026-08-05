import { z } from 'zod';

/**
 * Saved addresses.
 *
 * The phone and pincode rules are the same ones `checkout.schema.ts` enforces.
 * If they were allowed to differ, an address would save happily here and then
 * be rejected at checkout — with the failure appearing at the worst possible
 * moment and no explanation of which field was at fault.
 */

export const addressBodySchema = z.object({
  /** "Home", "Office" — optional, and only ever for the customer's own benefit. */
  label: z.string().trim().max(30).optional(),
  name: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?91[\s-]?)?[6-9]\d{9}$/, 'Enter a valid Indian mobile number'),
  line1: z.string().trim().min(5).max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit pincode'),
  country: z.string().trim().max(60).default('India'),
  isDefault: z.boolean().optional(),
});

/** Every field optional on a PATCH, but the same rules on whatever is sent. */
export const addressPatchSchema = addressBodySchema.partial();

export const addressIdSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id'),
});

export type AddressBody = z.infer<typeof addressBodySchema>;
export type AddressPatch = z.infer<typeof addressPatchSchema>;

export const profilePatchSchema = z.object({
  // Empty string allowed: the field is optional on the model. Two characters
  // is the floor for anything that is not empty — one letter is a typo.
  name: z.union([z.literal(''), z.string().trim().min(2).max(100)]).optional(),
});

export type ProfilePatch = z.infer<typeof profilePatchSchema>;
