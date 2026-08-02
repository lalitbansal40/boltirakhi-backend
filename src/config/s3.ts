import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env, isS3Configured } from './env';

/**
 * Key prefixes. Changing one later strands every object already written under
 * the old name, so they live in one place.
 *
 * PUBLIC prefixes are readable by anyone (bucket policy grants GET on them) —
 * storefront images must have stable URLs that survive ISR caching.
 * Everything else stays private and is served through a short-lived signed URL.
 */
export const S3_PREFIX = {
  PRODUCTS: 'products',
  CATEGORIES: 'categories',
  BOLTI_VIDEOS: 'bolti/videos',
  BOLTI_PHOTOS: 'bolti/photos',
  BOLTI_QR: 'bolti/qr',
} as const;

export type S3Prefix = (typeof S3_PREFIX)[keyof typeof S3_PREFIX];

/** Prefixes the bucket policy exposes for public GET. */
const PUBLIC_PREFIXES: readonly string[] = [S3_PREFIX.PRODUCTS, S3_PREFIX.CATEGORIES];

export function isPublicPrefix(prefix: S3Prefix): boolean {
  return PUBLIC_PREFIXES.includes(prefix);
}

let client: S3Client | undefined;

export function getS3(): S3Client {
  if (!isS3Configured) {
    throw new Error(
      'S3 is not configured — set AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env',
    );
  }

  client ??= new S3Client({
    region: env.AWS_REGION!,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  return client;
}

/** Permanent URL for an object under a public prefix. */
export function publicUrl(key: string): string {
  if (env.AWS_CDN_DOMAIN) return `${env.AWS_CDN_DOMAIN}/${key}`;
  return `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
}

/**
 * Upload URL for the browser to PUT to directly, so large video never passes
 * through this server.
 *
 * The browser must send exactly this contentType or S3 rejects the signature.
 */
export async function createUploadUrl(params: {
  key: string;
  contentType: string;
  expiresIn?: number;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET!,
    Key: params.key,
    ContentType: params.contentType,
  });

  return getSignedUrl(getS3(), command, { expiresIn: params.expiresIn ?? 900 });
}

/**
 * Short-lived read URL for private objects — Bolti videos are family messages
 * and must not sit on a permanently public URL.
 *
 * The reveal page mints a fresh one per view, so the printed QR keeps working
 * forever while no single link stays valid.
 */
export async function createReadUrl(key: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({ Bucket: env.AWS_S3_BUCKET!, Key: key });
  return getSignedUrl(getS3(), command, { expiresIn });
}

export async function deleteObject(key: string): Promise<void> {
  await getS3().send(new DeleteObjectCommand({ Bucket: env.AWS_S3_BUCKET!, Key: key }));
}

/** Confirms credentials and bucket access. Call on boot, not per request. */
export async function verifyS3(): Promise<boolean> {
  if (!isS3Configured) {
    console.warn('⚠️  S3 not configured — uploads disabled (needed from Phase C.3)');
    return false;
  }

  try {
    await getS3().send(new HeadBucketCommand({ Bucket: env.AWS_S3_BUCKET! }));
    console.log(`✅ S3 connected: ${env.AWS_S3_BUCKET} (${env.AWS_REGION})`);
    return true;
  } catch (error) {
    const err = error as { name?: string; message?: string };
    const hint =
      err.name === 'NotFound'
        ? 'bucket does not exist or is in another region'
        : err.name === 'Forbidden' || err.name === 'AccessDenied'
          ? 'IAM user lacks access to this bucket'
          : err.message;
    console.error(`❌ S3 check failed: ${hint}`);
    return false;
  }
}
