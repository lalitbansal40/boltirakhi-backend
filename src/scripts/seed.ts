import { env } from '../config/env';
import { connectDB, disconnectDB } from '../config/db';
import { User } from '../models/User';
import { hashPassword } from '../utils/password';

/**
 * Creates the admin account from ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD.
 *
 * Re-running is a no-op by design: this runs on every deploy, and silently
 * resetting the password each time would undo any change made since.
 * `--force` is the explicit way to reset it.
 */
async function seed(): Promise<void> {
  const force = process.argv.includes('--force');

  await connectDB();

  const email = env.ADMIN_SEED_EMAIL.toLowerCase();
  const existing = await User.findOne({ email });

  if (existing && !force) {
    console.log(`ℹ️  Admin already exists: ${email} (nothing changed)`);
    console.log('   Use `npm run seed -- --force` to reset the password.');
    return;
  }

  // Never log the password itself — this output ends up in deploy logs.
  const passwordHash = await hashPassword(env.ADMIN_SEED_PASSWORD);

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = 'admin';
    existing.isBlocked = false;
    await existing.save();
    console.log(`✅ Admin password reset: ${email}`);
    return;
  }

  await User.create({
    name: 'Admin',
    email,
    passwordHash,
    role: 'admin',
  });

  console.log(`✅ Admin created: ${email}`);
}

seed()
  .then(async () => {
    // Mongoose keeps the process alive until the connection closes.
    await disconnectDB();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('❌ Seed failed:', error instanceof Error ? error.message : error);
    await disconnectDB().catch(() => undefined);
    process.exit(1);
  });
