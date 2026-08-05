import { z } from 'zod';

/**
 * What the browser is allowed to say.
 *
 * Note what is *absent*: no price, no subtotal, no total. The browser sends
 * product ids and quantities; every rupee is worked out on the server from the
 * database. A client that could name its own price would be a shop that gives
 * things away.
 */

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');

const orderItemSchema = z.object({
  productId: objectId,
  qty: z.number().int().min(1).max(20),
  packSize: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(6), z.literal(8)]).optional(),
  /** Set once the sister has recorded her message for this line. */
  boltiMessageId: objectId.optional(),
});

const addressSchema = z.object({
  name: z.string().trim().min(2).max(80),
  // Ten digits. The gateway normalises what it gets, but a nine-digit number
  // means an undeliverable order, and that is worth catching at the door.
  phone: z.string().trim().regex(/^(\+?91[\s-]?)?[6-9]\d{9}$/, 'must be a valid Indian mobile number'),
  line1: z.string().trim().min(5).max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'must be a valid 6-digit pincode'),
  country: z.string().trim().max(60).default('India'),
});

export const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1, 'Your cart is empty').max(50),
  shippingAddress: addressSchema,
  couponCode: z.string().trim().min(1).max(40).optional(),
  // Optional on purpose. Required here would cost checkouts, and the SMS goes
  // out either way, so nobody is left without confirmation.
  customerEmail: z.string().trim().email().max(120).optional(),
});

export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().trim().min(1),
  razorpayPaymentId: z.string().trim().min(1),
  signature: z.string().trim().min(1),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

/** BR-26-0001 and nothing else — a loose pattern here becomes a regex in a query. */
export const orderNumberSchema = z.object({
  orderNumber: z.string().trim().regex(/^BR-\d{2}-\d{4,}$/i, 'must be a valid order number'),
});
