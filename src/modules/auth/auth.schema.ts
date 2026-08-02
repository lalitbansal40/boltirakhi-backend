import { z } from 'zod';
import { MAX_PASSWORD_BYTES } from '../../utils/password';

/**
 * The upper bound is bcrypt's: it reads only the first 72 bytes, so without a
 * cap a 100-character password and its 72-byte prefix would both unlock the
 * account. Rejecting is better than truncating silently.
 */
const password = z
  .string()
  .min(8, 'must be at least 8 characters')
  .max(MAX_PASSWORD_BYTES, `must be at most ${MAX_PASSWORD_BYTES} characters`);

export const loginSchema = z.object({
  email: z.email('must be a valid email address'),
  password,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'is required'),
    newPassword: password,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'must be different from the current password',
    path: ['newPassword'],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
