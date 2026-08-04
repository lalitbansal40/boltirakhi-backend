/**
 * Swaps the product text index.
 *
 * A collection may hold only one text index, so the old one has to be dropped
 * before the new one can exist. Mongoose will not do this: on boot it tries to
 * build the index declared in the schema, MongoDB refuses with "only one text
 * index allowed", and the process carries on serving requests with neither the
 * error nor the missing index visible anywhere. Search simply returns nothing
 * and no one can say why.
 *
 * Run after every deploy that changes the searchable fields:
 *
 *   npm run reindex
 *
 * Safe to run repeatedly — it checks what is actually there first.
 */
import mongoose from 'mongoose';

import { connectDB } from '../config/db';
import { Product } from '../models';

const OLD_NAME = 'product_text';
const NEW_NAME = 'product_text_v2';

async function main(): Promise<void> {
  await connectDB();

  const before = await Product.collection.indexes();
  console.log('Indexes now:', before.map((index) => index.name).join(', '));

  if (before.some((index) => index.name === OLD_NAME)) {
    await Product.collection.dropIndex(OLD_NAME);
    console.log(`Dropped ${OLD_NAME}`);
  } else {
    console.log(`${OLD_NAME} not present — nothing to drop`);
  }

  if (before.some((index) => index.name === NEW_NAME)) {
    console.log(`${NEW_NAME} already exists`);
  } else {
    await Product.collection.createIndex(
      { title: 'text', description: 'text', tags: 'text' },
      {
        // A tag was chosen deliberately; a word can land in a description by
        // coincidence.
        weights: { title: 10, tags: 5, description: 1 },
        name: NEW_NAME,
        // Search returns nothing while this builds, so keep the collection
        // readable in the meantime.
        background: true,
      },
    );
    console.log(`Created ${NEW_NAME}`);
  }

  const after = await Product.collection.indexes();
  console.log('Indexes after:', after.map((index) => index.name).join(', '));

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
