import { Types } from 'mongoose';

import { BoltiMessage, type IBoltiMessage } from '../../models/BoltiMessage';
import { S3_PREFIX } from '../../config/s3';
import { env } from '../../config/env';
import { presign } from '../upload/upload.service';
import { ApiError } from '../../utils/ApiError';

/**
 * The sister's side of a Bolti message.
 *
 * Access is by token, never by `_id`. The token is long and random; an
 * ObjectId is neither, and this record holds a private video meant for one
 * person. The owning user is checked as part of the same query, so there is
 * no separate ownership test that a later edit could drop.
 */

const MAX_PHOTOS = 5;
const MAX_LETTER_CHARS = 500;

async function loadDraft(token: string, userId: string): Promise<IBoltiMessage> {
  const message = await BoltiMessage.findOne({
    token,
    userId: new Types.ObjectId(userId),
  });

  // Not found rather than forbidden: telling someone their guessed token is
  // real, but somebody else's, is information they should not have.
  if (!message) throw ApiError.notFound('Message not found');

  return message;
}

/**
 * Nothing changes once the message is submitted.
 *
 * The QR is printed at that moment and goes onto the packaging. Letting the
 * video behind an already-printed code be swapped afterwards means the parcel
 * and the message no longer match, and there is no way to tell from the box.
 */
function assertEditable(message: IBoltiMessage): void {
  if (message.status !== 'draft') {
    throw new ApiError(
      409,
      'This message has already been sent and cannot be changed',
      'BOLTI_LOCKED',
    );
  }
}

export function getDraft(token: string, userId: string) {
  return loadDraft(token, userId);
}

export async function updateDraft(
  token: string,
  userId: string,
  input: { letterText?: string; senderName?: string; receiverName?: string },
): Promise<IBoltiMessage> {
  const message = await loadDraft(token, userId);
  assertEditable(message);

  if (input.letterText !== undefined) {
    if (input.letterText.length > MAX_LETTER_CHARS) {
      throw new ApiError(400, `Keep the letter under ${MAX_LETTER_CHARS} characters`, 'LETTER_TOO_LONG');
    }
    message.letterText = input.letterText;
  }
  if (input.senderName !== undefined) message.senderName = input.senderName;
  if (input.receiverName !== undefined) message.receiverName = input.receiverName;

  await message.save();
  return message;
}

/**
 * A signed URL for the browser to upload straight to S3.
 *
 * The content-type and size rules live in `upload.service.ts` and are reused
 * rather than restated — a second copy would drift, and the copy that
 * disagreed would be the one letting a 200MB file through.
 */
export async function presignVideo(
  token: string,
  userId: string,
  input: { filename: string; contentType: string; sizeBytes: number },
) {
  const message = await loadDraft(token, userId);
  assertEditable(message);

  const result = await presign({ prefix: S3_PREFIX.BOLTI_VIDEOS, ...input });

  message.videoKey = result.key;
  await message.save();

  return result;
}

export async function presignPhoto(
  token: string,
  userId: string,
  input: { filename: string; contentType: string; sizeBytes: number },
) {
  const message = await loadDraft(token, userId);
  assertEditable(message);

  if (message.photos.length >= MAX_PHOTOS) {
    throw new ApiError(400, `You can add up to ${MAX_PHOTOS} photos`, 'PHOTO_LIMIT_REACHED');
  }

  const result = await presign({ prefix: S3_PREFIX.BOLTI_PHOTOS, ...input });

  message.photos.push({ key: result.key } as IBoltiMessage['photos'][number]);
  await message.save();

  return result;
}

/**
 * Seal the message and build the URL the QR will carry.
 *
 * The reveal URL is built from `PUBLIC_SITE_URL`. If that were ever a
 * localhost value the code would be printed onto packaging and shipped, and
 * the mistake would only surface when a brother scanned it — by which point
 * nothing can be done. env.ts validates the protocol for exactly this reason.
 */
export async function submitDraft(token: string, userId: string): Promise<IBoltiMessage> {
  const message = await loadDraft(token, userId);
  assertEditable(message);

  const hasSomething =
    Boolean(message.videoKey) ||
    Boolean(message.letterText?.trim()) ||
    message.photos.length > 0;

  if (!hasSomething) {
    throw new ApiError(
      400,
      'Add a video, a letter or a photo before sending',
      'BOLTI_EMPTY',
    );
  }

  message.revealUrl = `${env.PUBLIC_SITE_URL}/r/${message.token}`;
  message.status = 'ready';
  await message.save();

  return message;
}

export { MAX_PHOTOS, MAX_LETTER_CHARS };
