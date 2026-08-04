import { z } from 'zod';

/**
 * The same phone shape the checkout schema uses. Kept identical on purpose —
 * a number that can place an order must be a number that can log in.
 */
const phone = z
  .string()
  .trim()
  .regex(/^(\+?91[\s-]?)?[6-9]\d{9}$/, 'Enter a valid Indian mobile number');

export const requestOtpSchema = z.object({ phone });

export const verifyOtpSchema = z.object({
  phone,
  // Exactly six digits. Anything else never reaches bcrypt, which is the
  // expensive part of a guess.
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
