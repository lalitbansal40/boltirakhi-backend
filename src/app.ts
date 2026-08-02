import express, { type Application, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env, isProduction } from './config/env';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/error';

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

  app.get('/api/health', (_req: Request, res: Response) => {
    const state = mongoose.connection.readyState;

    res.status(state === 1 ? 200 : 503).json({
      success: true,
      data: {
        ok: state === 1,
        db: DB_STATE[state] ?? 'unknown',
        database: mongoose.connection.name || null,
        env: env.NODE_ENV,
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Routes go here (Phase C).

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
