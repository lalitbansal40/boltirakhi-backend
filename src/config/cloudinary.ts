import { v2 as cloudinary } from 'cloudinary';
import { env } from './env';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  // Without this Cloudinary returns http:// URLs, which a https:// page blocks
  // as mixed content.
  secure: true,
});

/**
 * Upload targets. Kept in one place because moving a folder later strands every
 * asset already uploaded under the old name.
 */
export const CLOUDINARY_FOLDERS = {
  PRODUCTS: 'boltirakhi/products',
  CATEGORIES: 'boltirakhi/categories',
  BOLTI_VIDEOS: 'boltirakhi/bolti/videos',
  BOLTI_PHOTOS: 'boltirakhi/bolti/photos',
  BOLTI_QR: 'boltirakhi/bolti/qr',
} as const;

export type CloudinaryFolder = (typeof CLOUDINARY_FOLDERS)[keyof typeof CLOUDINARY_FOLDERS];

/** Confirms the credentials actually work. Call on boot, not per request. */
export async function verifyCloudinary(): Promise<boolean> {
  try {
    const result = await cloudinary.api.ping();
    const ok = result.status === 'ok';
    console.log(ok ? '✅ Cloudinary connected' : `⚠️  Cloudinary ping: ${result.status}`);
    return ok;
  } catch (error) {
    console.error(
      '❌ Cloudinary check failed:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

export { cloudinary };
