import { z } from 'zod';

/**
 * The token is the only way in, so its shape is checked before it reaches a
 * query — an unvalidated string is one step from a regex arriving where a
 * literal was expected.
 */
export const boltiTokenSchema = z.object({
  token: z.string().trim().min(16).max(120).regex(/^[A-Za-z0-9_-]+$/, 'invalid token'),
});

export const updateBoltiSchema = z.object({
  letterText: z.string().max(500).optional(),
  senderName: z.string().trim().max(80).optional(),
  receiverName: z.string().trim().max(80).optional(),
});

/** Prefix is not accepted from the client — the route decides which bucket. */
export const boltiUploadSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

export type UpdateBoltiInput = z.infer<typeof updateBoltiSchema>;
export type BoltiUploadInput = z.infer<typeof boltiUploadSchema>;
