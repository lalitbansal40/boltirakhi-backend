import { z } from 'zod';
import { S3_PREFIX } from '../../config/s3';

const prefixValues = Object.values(S3_PREFIX) as [string, ...string[]];

export const presignSchema = z.object({
  prefix: z.enum(prefixValues),
  // Only the name is taken from the client; the key itself is built server-side.
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

// Content type and size limits per prefix live in upload.service.ts, in one
// RULES table. Duplicating them here would give two sources of truth that
// drift apart — which is exactly what happened when they briefly did.

export const readUrlSchema = z.object({
  key: z.string().trim().min(1).max(400),
  expiresIn: z.number().int().min(60).max(24 * 60 * 60).optional(),
});

export const deleteSchema = z.object({
  key: z.string().trim().min(1).max(400),
});

export type PresignInput = z.infer<typeof presignSchema>;
export type ReadUrlInput = z.infer<typeof readUrlSchema>;
export type DeleteInput = z.infer<typeof deleteSchema>;
