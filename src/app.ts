import express, { type Application, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env, isProduction } from './config/env';
import { paymentStatus } from './config/payment';
import { enabledChannels } from './services/notify';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/error';
import { globalLimiter } from './middleware/rateLimit';
import { sanitizeRequest } from './middleware/sanitize';
import { sendSuccess } from './utils';
import authRoutes from './modules/auth/auth.routes';
import categoryRoutes from './modules/category/category.routes';
import productRoutes from './modules/product/product.routes';
import uploadRoutes from './modules/upload/upload.routes';
import orderRoutes from './modules/order/order.routes';
import userRoutes from './modules/user/user.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import { boltiRoutes, revealRoutes } from './modules/bolti/bolti.routes';
import { settingRoutes } from './modules/setting/setting.routes';
import { couponRoutes, publicCouponRoutes } from './modules/coupon/coupon.routes';
import { checkoutRoutes, webhookRoutes } from './modules/checkout/checkout.routes';
import {
  publicCategoryRoutes,
  publicProductRoutes,
  publicSearchRoutes,
} from './modules/catalog/catalog.routes';

const DB_STATE: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export function createApp(): Application {
  const app = express();

  // Behind Railway/Vercel's proxy, req.ip is the proxy without this, which
  // would make every client share one rate-limit bucket.
  app.set('trust proxy', 1);

  app.use(helmet());

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: curl, Postman, server-to-server.
        if (!origin) return callback(null, true);

        if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);

        // A plain Error would surface as a 500 — a rejected origin is a client
        // problem, and the tagged fields let the error handler say so.
        const error = Object.assign(new Error(`Origin not allowed: ${origin}`), {
          statusCode: 403,
          code: 'CORS_FORBIDDEN',
        });
        return callback(error);
      },
      credentials: true,
    }),
  );

  app.use(
    express.json({
      limit: '1mb',
      /**
       * Keep the raw bytes for the Razorpay webhook only.
       *
       * Its signature is an HMAC over exactly what was sent, so a
       * re-serialised `req.body` — different key order, different whitespace —
       * hashes to something else and every webhook would be rejected.
       *
       * Scoped to the one path so no other request pays to hold a second copy
       * of its body in memory.
       */
      verify: (req, _res, buf) => {
        if (req.url?.startsWith('/api/webhooks/')) {
          (req as express.Request).rawBody = buf.toString('utf8');
        }
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(morgan(isProduction ? 'combined' : 'dev'));

  // After the body parsers, so req.body exists to clean.
  app.use(sanitizeRequest);

  // Health check stays above the limiter — a platform probe polling every few
  // seconds must not exhaust the budget and report the service as down.
  app.get('/api/health', (_req: Request, res: Response) => {
    const state = mongoose.connection.readyState;

    sendSuccess(
      res,
      {
        ok: state === 1,
        db: DB_STATE[state] ?? 'unknown',
        database: mongoose.connection.name || null,
        env: env.NODE_ENV,
        // Whoever is debugging a payment needs to know which Razorpay account
        // it landed in before they go looking for it in the wrong dashboard.
        payments: paymentStatus(),
        notifications: enabledChannels(),
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      undefined,
      // 503 when the DB is gone, so a platform health check actually fails.
      state === 1 ? 200 : 503,
    );
  });

  // Above the limiter, deliberately: Razorpay bursts its retries, and a 429
  // would make it back off and eventually stop telling us a customer paid.
  // The signature check inside is what keeps this route safe without auth.
  app.use('/api/webhooks', webhookRoutes);

  app.use('/api', globalLimiter);

  app.use('/api/admin/auth', authRoutes);
  app.use('/api/admin/categories', categoryRoutes);
  app.use('/api/admin/products', productRoutes);
  app.use('/api/admin/uploads', uploadRoutes);
  app.use('/api/admin/orders', orderRoutes);
  app.use('/api/admin/users', userRoutes);
  app.use('/api/admin/dashboard', dashboardRoutes);
  app.use('/api/admin/bolti', boltiRoutes);
  app.use('/api/admin/settings', settingRoutes);
  app.use('/api/admin/coupons', couponRoutes);

  // Public: the brother scans a QR and arrives here with no account.
  app.use('/api/r', revealRoutes);
  // Public: the checkout checks a coupon before an account exists.
  app.use('/api/coupons', publicCouponRoutes);
  app.use('/api/orders', checkoutRoutes);
  // Public: the storefront catalogue, browsed before any account exists.
  app.use('/api/categories', publicCategoryRoutes);
  app.use('/api/products', publicProductRoutes);
  app.use('/api/search', publicSearchRoutes);
  // More admin modules mount here (Phase C.5 onwards).

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
