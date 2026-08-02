import type { Types } from 'mongoose';
import { env } from '../config/env';
import { connectDB, disconnectDB } from '../config/db';
import { Category, Product, User } from '../models';
import { hashPassword } from '../utils/password';

/**
 * Creates the admin account from ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD.
 *
 * Re-running is a no-op by design: this runs on every deploy, and silently
 * resetting the password each time would undo any change made since.
 * `--force` is the explicit way to reset it.
 */
async function seedAdmin(force: boolean): Promise<void> {
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
    existing.passwordChangedAt = new Date();
    existing.role = 'admin';
    existing.isBlocked = false;
    await existing.save();
    console.log(`✅ Admin password reset: ${email}`);
    return;
  }

  await User.create({ name: 'Admin', email, passwordHash, role: 'admin' });
  console.log(`✅ Admin created: ${email}`);
}

// Prices are whole paise: 49900 is ₹499.
const DEMO_CATEGORIES = [
  { name: 'Bhaiya Rakhi', description: 'Classic rakhis for your brother', sortOrder: 1 },
  { name: 'Bolti Rakhi', description: 'Rakhis that carry your voice', sortOrder: 2 },
  { name: 'Kids Rakhi', description: 'Fun rakhis for little brothers', sortOrder: 3 },
];

interface DemoProduct {
  title: string;
  category: string;
  pricePaise: number;
  mrpPaise: number;
  stock: number;
  type: 'normal' | 'bolti';
  attributes: Record<string, string>;
}

const DEMO_PRODUCTS: DemoProduct[] = [
  { title: 'Silk Thread Rakhi', category: 'Bhaiya Rakhi', pricePaise: 24900, mrpPaise: 39900, stock: 50, type: 'normal', attributes: { material: 'silk', color: 'red' } },
  { title: 'Rudraksha Rakhi', category: 'Bhaiya Rakhi', pricePaise: 34900, mrpPaise: 49900, stock: 30, type: 'normal', attributes: { material: 'rudraksha', color: 'brown' } },
  { title: 'Bolti Rakhi Classic', category: 'Bolti Rakhi', pricePaise: 79900, mrpPaise: 99900, stock: 100, type: 'bolti', attributes: { material: 'silk', color: 'gold' } },
  { title: 'Bolti Rakhi Premium Box', category: 'Bolti Rakhi', pricePaise: 129900, mrpPaise: 179900, stock: 40, type: 'bolti', attributes: { material: 'velvet', color: 'maroon' } },
  { title: 'Cartoon Kids Rakhi', category: 'Kids Rakhi', pricePaise: 14900, mrpPaise: 24900, stock: 80, type: 'normal', attributes: { material: 'resin', color: 'multi' } },
  { title: 'Light-Up Kids Rakhi', category: 'Kids Rakhi', pricePaise: 19900, mrpPaise: 29900, stock: 60, type: 'normal', attributes: { material: 'plastic', color: 'blue' } },
];

/**
 * Matches on name/title so a second run updates nothing and creates nothing.
 * Skipping by title also means the slug lock is never fighting a duplicate.
 */
async function seedDemo(): Promise<void> {
  console.log('\n--- demo data ---');
  const categoryIds = new Map<string, Types.ObjectId>();

  for (const definition of DEMO_CATEGORIES) {
    const existing = await Category.findOne({ name: definition.name });
    if (existing) {
      categoryIds.set(definition.name, existing._id);
      console.log(`ℹ️  category exists: ${definition.name}`);
      continue;
    }

    const created = await Category.create(definition);
    categoryIds.set(definition.name, created._id);
    console.log(`✅ category: ${created.name} (${created.slug})`);
  }

  for (const definition of DEMO_PRODUCTS) {
    const existing = await Product.findOne({ title: definition.title });
    if (existing) {
      console.log(`ℹ️  product exists: ${definition.title}`);
      continue;
    }

    const created = await Product.create({
      title: definition.title,
      description: `${definition.title} — handcrafted for Raksha Bandhan.`,
      shortDescription: definition.title,
      categoryId: categoryIds.get(definition.category),
      pricePaise: definition.pricePaise,
      mrpPaise: definition.mrpPaise,
      stock: definition.stock,
      type: definition.type,
      attributes: definition.attributes,
      // Shiprocket needs these on every product.
      weightGrams: 50,
      dimensionsCm: { l: 10, b: 10, h: 2 },
      isFeatured: definition.type === 'bolti',
    });

    console.log(`✅ product: ${created.title} (₹${created.pricePaise / 100}, ${created.type})`);
  }
}

async function seed(): Promise<void> {
  const force = process.argv.includes('--force');
  const demo = process.argv.includes('--demo');

  await connectDB();
  await seedAdmin(force);

  if (demo) {
    await seedDemo();
  }
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
