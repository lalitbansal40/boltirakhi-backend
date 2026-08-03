import { Types } from 'mongoose';

import { createReadUrl } from '../../config/s3';
import { BoltiMessage, Order, type IBoltiMessage } from '../../models';
import {
  ApiError,
  buildPaginated,
  containsRegex,
  istDateRange,
  parsePagination,
  type Paginated,
} from '../../utils';
import type { ListBoltiQuery } from './bolti.schema';

const SORTABLE = ['createdAt', 'updatedAt', 'revealedAt', 'status'] as const;

/** How long a signed media URL stays valid. */
const MEDIA_URL_TTL_SECONDS = 3600;

/**
 * Creates the draft message for one bolti line on an order.
 *
 * Kept as a plain service function on purpose: when the Razorpay webhook
 * arrives in Phase 2 it calls this, rather than the logic being trapped inside
 * an admin controller and needing to be written twice.
 */
export async function createForOrderItem(params: {
  orderId: Types.ObjectId | string;
  orderItemId: Types.ObjectId | string;
  userId?: Types.ObjectId | string;
}): Promise<IBoltiMessage> {
  // The link lives on the order item, not the order — one order can carry two
  // bolti rakhis with two different videos.
  const existing = await BoltiMessage.findOne({ orderItemId: params.orderItemId });
  if (existing) return existing;

  // token and revealUrl are filled in by the model.
  return BoltiMessage.create({
    orderId: params.orderId,
    orderItemId: params.orderItemId,
    userId: params.userId,
    status: 'draft',
  });
}

export interface AttachMediaInput {
  videoKey?: string;
  videoThumbKey?: string;
  videoDurationSec?: number;
  letterText?: string;
  photos?: { key: string }[];
  senderName?: string;
  receiverName?: string;
}

export async function attachMedia(id: string, input: AttachMediaInput): Promise<IBoltiMessage> {
  const message = await findOrFail(id);

  Object.assign(message, input);
  if (input.photos) message.set('photos', input.photos);

  // "Ready" means there is something for the brother to open. Under D25 the QR
  // always exists, so status is about the message being complete, not the code.
  if (message.videoKey || message.letterText || message.photos.length > 0) {
    message.status = 'ready';
  }

  await message.save();
  return message;
}

async function findOrFail(id: string): Promise<IBoltiMessage> {
  const message = await BoltiMessage.findById(id);
  if (!message) throw ApiError.notFound('Bolti message');
  return message;
}

/**
 * A signed GET for a private object, or null when storage is not configured.
 *
 * Returning null rather than throwing keeps the admin screen usable while AWS
 * credentials are missing: the page renders with a "video pending" state
 * instead of a 500.
 */
async function signedUrlOrNull(key?: string): Promise<string | null> {
  if (!key) return null;

  try {
    return await createReadUrl(key, MEDIA_URL_TTL_SECONDS);
  } catch {
    return null;
  }
}

export async function list(query: ListBoltiQuery): Promise<Paginated<Record<string, unknown>>> {
  const { page, limit, skip, sort } = parsePagination(query as Record<string, unknown>, {
    allowedSortFields: SORTABLE,
    defaultSort: '-createdAt',
  });

  const filter: Record<string, unknown> = {};

  if (query.status) filter.status = query.status;
  if (query.isRevealed) filter.isRevealed = true;

  const createdAt = istDateRange(query.from, query.to);
  if (createdAt) filter.createdAt = createdAt;

  if (query.q) {
    const pattern = containsRegex(query.q);
    const orders = await Order.find({ orderNumber: pattern }).select('_id').lean();

    filter.$or = [
      { token: pattern },
      ...(orders.length ? [{ orderId: { $in: orders.map((order) => order._id) } }] : []),
    ];
  }

  const [rows, total] = await Promise.all([
    BoltiMessage.find(filter)
      .select('token revealUrl status isRevealed revealedAt revealCount orderId createdAt videoKey')
      .populate('orderId', 'orderNumber')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    BoltiMessage.countDocuments(filter),
  ]);

  // No signed URLs here — each one is an S3 round trip, and a 20-row page would
  // pay for 20 of them to render a table that shows none of the media.
  const items = rows.map(({ videoKey, ...rest }) => ({
    ...rest,
    hasVideo: Boolean(videoKey),
  }));

  return buildPaginated(items, total, page, limit);
}

export async function getById(id: string): Promise<Record<string, unknown>> {
  const message = await BoltiMessage.findById(id).populate('orderId', 'orderNumber').lean();
  if (!message) throw ApiError.notFound('Bolti message');

  const [videoUrl, videoThumbUrl, photoUrls] = await Promise.all([
    signedUrlOrNull(message.videoKey),
    signedUrlOrNull(message.videoThumbKey),
    Promise.all((message.photos ?? []).map((photo) => signedUrlOrNull(photo.key))),
  ]);

  // Reading this must never look like the brother opened it — see the reveal
  // endpoint, which is the only place isRevealed and revealCount change.
  return {
    ...message,
    videoUrl,
    videoThumbUrl,
    photoUrls: photoUrls.filter((url): url is string => Boolean(url)),
  };
}

/** Everything the QR endpoints need, in one lookup. */
export async function getForQr(
  id: string,
): Promise<{ token: string; revealUrl: string; orderNumber?: string }> {
  const message = await BoltiMessage.findById(id)
    .select('token revealUrl orderId')
    .populate<{ orderId?: { orderNumber?: string } }>('orderId', 'orderNumber')
    .lean();

  if (!message) throw ApiError.notFound('Bolti message');

  return {
    token: message.token,
    revealUrl: message.revealUrl,
    orderNumber: message.orderId?.orderNumber,
  };
}

export async function getManyForQr(ids: string[]): Promise<
  { token: string; revealUrl: string; orderNumber?: string }[]
> {
  const messages = await BoltiMessage.find({ _id: { $in: ids } })
    .select('token revealUrl orderId')
    .populate<{ orderId?: { orderNumber?: string } }>('orderId', 'orderNumber')
    .lean();

  return messages.map((message) => ({
    token: message.token,
    revealUrl: message.revealUrl,
    orderNumber: message.orderId?.orderNumber,
  }));
}

/**
 * The public reveal read.
 *
 * Fields are whitelisted, not blacklisted: this response goes to anyone who
 * has the link, and a future field added to the model must not leak by
 * default.
 */
export async function reveal(token: string): Promise<Record<string, unknown>> {
  const message = await BoltiMessage.findOne({ token });

  // Do not distinguish "no such token" from anything else — a different
  // message for a real token would confirm it exists.
  if (!message) throw ApiError.notFound('Message');

  if (message.status === 'draft') {
    return { status: 'pending', message: 'This message is not ready yet.' };
  }

  const [videoUrl, videoThumbUrl, photoUrls] = await Promise.all([
    signedUrlOrNull(message.videoKey),
    signedUrlOrNull(message.videoThumbKey),
    Promise.all((message.photos ?? []).map((photo) => signedUrlOrNull(photo.key))),
  ]);

  // Captured before the update: the page uses it to decide whether to play the
  // first-open animation, which only makes sense once.
  const wasRevealed = message.isRevealed;

  message.isRevealed = true;
  message.revealCount += 1;
  if (!message.revealedAt) message.revealedAt = new Date();
  await message.save();

  return {
    status: 'ready',
    senderName: message.senderName ?? null,
    receiverName: message.receiverName ?? null,
    letterText: message.letterText ?? null,
    videoUrl,
    videoThumbUrl,
    videoDurationSec: message.videoDurationSec ?? null,
    photoUrls: photoUrls.filter((url): url is string => Boolean(url)),
    isRevealed: wasRevealed,
  };
}
