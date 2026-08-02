import mongoose from 'mongoose';
import { env, isProduction } from './env';

// Strips query conditions on fields that are not in the schema instead of
// silently sending them to MongoDB, where they would match nothing.
mongoose.set('strictQuery', true);

let isConnected = false;

export async function connectDB(): Promise<void> {
  if (isConnected) return;

  mongoose.connection.on('connected', () => {
    isConnected = true;
    const { host, name } = mongoose.connection;
    console.log(`✅ MongoDB connected: ${host}/${name}`);

    if (name === 'test') {
      console.warn(
        '⚠️  Connected to the "test" database — MONGODB_URI is probably missing the DB name.',
      );
    }
  });

  mongoose.connection.on('error', (error) => {
    console.error('❌ MongoDB error:', error instanceof Error ? error.message : error);
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    console.warn('⚠️  MongoDB disconnected');
  });

  try {
    await mongoose.connect(env.MONGODB_URI, {
      // Default is 30s, which turns a wrong URI or a missing IP allowlist entry
      // into a very long silent wait.
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
      maxPoolSize: 10,
      // Building indexes on every boot is fine while the data is small, but it
      // is startup work that does not belong in production.
      autoIndex: !isProduction,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ MongoDB connection failed: ${message}\n`);
    console.error('Check: Atlas IP allowlist, username/password (URL-encode special chars),');
    console.error('and that MONGODB_URI includes the database name.\n');
    // Without a database the server can serve nothing useful.
    process.exit(1);
  }
}

export async function disconnectDB(): Promise<void> {
  if (!isConnected) return;
  await mongoose.connection.close();
  isConnected = false;
  console.log('MongoDB connection closed');
}

export { mongoose };
