import express, { type Application, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env, isProduction } from './config/env';
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

  app.use(express.json({ limit: '1mb' }));
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
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      undefined,
      // 503 when the DB is gone, so a platform health check actually fails.
      state === 1 ? 200 : 503,
    );
  });

  app.use('/api', globalLimiter);

  app.use('/api/admin/auth', authRoutes);
  app.use('/api/admin/categories', categoryRoutes);
  app.use('/api/admin/products', productRoutes);
  app.use('/api/admin/uploads', uploadRoutes);
  app.use('/api/admin/orders', orderRoutes);
  app.use('/api/admin/users', userRoutes);
  app.use('/api/admin/dashboard', dashboardRoutes);
  app.use('/api/admin/bolti', boltiRoutes);

  // Public: the brother scans a QR and arrives here with no account.
  app.use('/api/r', revealRoutes);
  // More admin modules mount here (Phase C.5 onwards).

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
