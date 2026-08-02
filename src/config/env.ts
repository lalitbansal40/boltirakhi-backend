import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Must run before anything else reads process.env.
// Railway/Vercel inject vars directly and ship no .env file — dotenv no-ops there.
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

/**
 * An unset var and a var set to "" are the same mistake, but zod sees "" as a
 * present string. Dropping empty values makes `.default()` and `.optional()`
 * behave, and turns "MONGODB_URI=" into a clear "Required" instead of a
 * confusing length error.
 */
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ''),
);

const commaSeparated = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim().replace(/\/$/, '')) // trailing slash breaks CORS origin match
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(1)).min(1, 'must contain at least one origin'));

const booleanish = z
  .string()
  .transform((value) => value.trim().toLowerCase() === 'true')
  .pipe(z.boolean());

const envSchema = z.object({
  // ---- Core ----
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  // ---- Database ----
  MONGODB_URI: z
    .string()
    .refine(
      (value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'),
      'must start with mongodb:// or mongodb+srv://',
    )
    .refine(
      (value) => /\/[^/?]+(\?|$)/.test(value.replace(/^mongodb(\+srv)?:\/\//, '')),
      'must include a database name (e.g. .../boltirakhi?retryWrites=true) — without it Mongoose writes to "test"',
    ),

  // ---- Auth ----
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ADMIN_SEED_EMAIL: z.email('must be a valid email address'),
  ADMIN_SEED_PASSWORD: z.string().min(8, 'must be at least 8 characters'),

  // ---- CORS ----
  CORS_ORIGINS: commaSeparated,

  // ---- Cloudinary ----
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),

  // ---- Razorpay (Phase 2) ----
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // ---- Shiprocket (Phase C.6) ----
  SHIPROCKET_EMAIL: z.string().optional(),
  SHIPROCKET_PASSWORD: z.string().optional(),
  SHIPROCKET_PICKUP_LOCATION: z.string().default('Primary'),
  SHIPROCKET_ENABLED: booleanish.default(false),

  // ---- Public ----
  // Bolti reveal URLs are built from this and printed onto packaging as a QR,
  // so a malformed base is unrecoverable. z.url() alone accepts "localhost:3000"
  // (WHATWG reads "localhost:" as the scheme), hence the explicit protocol check.
  PUBLIC_SITE_URL: z
    .url('must be a valid URL')
    .refine((value) => /^https?:\/\//i.test(value), 'must start with http:// or https://')
    .transform((value) => value.replace(/\/+$/, '')),
});

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => {
    const key = String(issue.path[0] ?? '(root)');
    const missing = !(key in rawEnv);
    return `  • ${key}: ${missing ? 'Required — missing or empty in .env' : issue.message}`;
  });

  console.error('\n❌ Invalid environment variables:\n');
  console.error([...new Set(lines)].join('\n'));
  console.error('\nFix .env (see .env.example) and start again.\n');
  process.exit(1);
}

export const env = parsed.data;

export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
