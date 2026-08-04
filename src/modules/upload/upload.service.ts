import { randomUUID } from 'crypto';
import path from 'path';
import {
  S3_PREFIX,
  createReadUrl,
  createUploadUrl,
  deleteObject,
  isPublicPrefix,
  publicUrl,
  type S3Prefix,
} from '../../config/s3';
import { isS3Configured } from '../../config/env';
import { ApiError } from '../../utils';
import type { DeleteInput, PresignInput, ReadUrlInput } from './upload.schema';

const MB = 1024 * 1024;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

/** No photograph needs more than this, whatever prefix it lands under. */
const MAX_IMAGE_BYTES = 5 * MB;

/**
 * What each prefix will accept. Checked before a URL is signed, because that
 * is the only moment we control: once the browser has a presigned URL it
 * uploads straight to S3 and this server never sees the bytes.
 */
const RULES: Record<S3Prefix, { contentTypes: string[]; maxBytes: number }> = {
  // Products carry a gallery and, optionally, one demo video. No quicktime
  // here: .mov matters for what a sister records on an iPhone, not for
  // footage we shoot and convert ourselves.
  [S3_PREFIX.PRODUCTS]: {
    contentTypes: [...IMAGE_TYPES, 'video/mp4', 'video/webm'],
    maxBytes: 50 * MB,
  },
  [S3_PREFIX.CATEGORIES]: { contentTypes: IMAGE_TYPES, maxBytes: 5 * MB },
  [S3_PREFIX.BOLTI_VIDEOS]: { contentTypes: VIDEO_TYPES, maxBytes: 50 * MB },
  [S3_PREFIX.BOLTI_PHOTOS]: { contentTypes: IMAGE_TYPES, maxBytes: 5 * MB },
  [S3_PREFIX.BOLTI_QR]: { contentTypes: ['image/png', 'image/svg+xml'], maxBytes: 2 * MB },
};

/**
 * Builds the object key from a prefix and a filename.
 *
 * The client never supplies the key. If it did, a "../" or someone else's key
 * would let one customer overwrite another's video — the most common hole in
 * a presigned-upload API.
 *
 * `path.basename` drops any directory part, and everything outside
 * [a-z0-9] collapses to a dash. The uuid is what actually guarantees
 * uniqueness; the readable tail is only there to make an S3 listing legible.
 */
export function buildKey(prefix: S3Prefix, filename: string): string {
  const safeName = path.basename(filename.replace(/\\/g, '/'));
  const extension = path.extname(safeName).toLowerCase().replace(/[^a-z0-9.]/g, '');

  const stem =
    path
      .basename(safeName, path.extname(safeName))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'file';

  return `${prefix}/${randomUUID()}-${stem}${extension}`;
}

/** Rejects the upload before a URL exists for it. */
export function assertUploadAllowed(input: PresignInput): void {
  const rule = RULES[input.prefix as S3Prefix];

  if (!rule) {
    throw ApiError.validation([{ field: 'prefix', message: 'unknown upload prefix' }]);
  }

  if (!rule.contentTypes.includes(input.contentType)) {
    throw ApiError.validation([
      {
        field: 'contentType',
        message: `must be one of ${rule.contentTypes.join(', ')}`,
      },
    ]);
  }

  // The products prefix takes both stills and one demo video, and 50MB is a
  // ceiling for footage, not for a photograph. Sizing by content type rather
  // than by prefix keeps a 6MB JPEG rejected while a 40MB mp4 goes through.
  const maxBytes = input.contentType.startsWith('video/')
    ? rule.maxBytes
    : Math.min(rule.maxBytes, MAX_IMAGE_BYTES);

  if (input.sizeBytes > maxBytes) {
    throw ApiError.validation([
      {
        field: 'sizeBytes',
        message: `must be at most ${Math.round(maxBytes / MB)}MB`,
      },
    ]);
  }
}

function assertConfigured(): void {
  if (!isS3Configured) {
    throw new ApiError(
      503,
      'File storage is not configured yet',
      'S3_NOT_CONFIGURED',
    );
  }
}

export interface PresignResult {
  key: string;
  uploadUrl: string;
  /** Echoed back so the client sends exactly what was signed. */
  contentType: string;
  expiresIn: number;
  /** Only for public prefixes; private objects need a signed read each time. */
  publicUrl?: string;
}

export async function presign(input: PresignInput): Promise<PresignResult> {
  // Input first: a bad content type is wrong regardless of whether storage
  // happens to be configured, and answering S3_NOT_CONFIGURED to it sends the
  // caller looking in the wrong place.
  assertUploadAllowed(input);
  assertConfigured();

  const prefix = input.prefix as S3Prefix;
  const key = buildKey(prefix, input.filename);
  const expiresIn = 900;

  const uploadUrl = await createUploadUrl({
    key,
    contentType: input.contentType,
    expiresIn,
  });

  return {
    key,
    uploadUrl,
    // S3 rejects the signature if the PUT's Content-Type differs from this.
    contentType: input.contentType,
    expiresIn,
    ...(isPublicPrefix(prefix) ? { publicUrl: publicUrl(key) } : {}),
  };
}

export async function readUrl(input: ReadUrlInput): Promise<{ url: string; expiresIn: number }> {
  assertConfigured();

  const expiresIn = input.expiresIn ?? 3600;
  return { url: await createReadUrl(input.key, expiresIn), expiresIn };
}

export async function remove(input: DeleteInput): Promise<void> {
  assertConfigured();
  await deleteObject(input.key);
}
