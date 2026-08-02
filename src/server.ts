import type { Server } from 'http';
// Importing env first means a bad .env stops the process before anything
// else initialises.
import { env } from './config/env';
import { connectDB, disconnectDB } from './config/db';
import { verifyS3 } from './config/s3';
import { createApp } from './app';

let server: Server | undefined;
let shuttingDown = false;

export async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n${signal} received — shutting down`);

  // Force exit if a hung connection keeps the process alive.
  const timer = setTimeout(() => {
    console.error('Shutdown timed out after 10s — forcing exit');
    process.exit(1);
  }, 10_000);
  timer.unref();

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
      console.log('HTTP server closed');
    }
    await disconnectDB();
    clearTimeout(timer);
    process.exit(exitCode);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

export async function start(): Promise<void> {
  await connectDB();

  // Reports but does not block — uploads are not needed until Phase C.3.
  await verifyS3();

  const app = createApp();

  // Resolve only once the port is actually bound, so `await start()` means
  // "ready to serve" and a bind failure rejects instead of surfacing later.
  await new Promise<void>((resolve, reject) => {
    const instance = app.listen(env.PORT);
    server = instance;

    instance.once('listening', () => {
      console.log(`🚀 Server running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
      console.log(`   Health: http://localhost:${env.PORT}/api/health`);
      resolve();
    });

    instance.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${env.PORT} is already in use`);
      }
      reject(error);
    });
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// An unhandled rejection leaves the process in an unknown state; restart clean.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  void shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  void shutdown('uncaughtException', 1);
});

// Only boot when run directly, so the shutdown path can be exercised in a test.
if (require.main === module) {
  start().catch((error) => {
    console.error('❌ Failed to start:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
