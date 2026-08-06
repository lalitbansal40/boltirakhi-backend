/**
 * Put the rest of each product's photographs on the shop.
 *
 * The original import capped every product at five images, but each folder
 * holds nine to twelve — and they are not near-duplicates. They are different
 * shots of the same rakhi: a hero, a macro of the centre motif, one tied on a
 * wrist, one in a gift box. All of them answer a question a shopper has.
 *
 * Run from the backend folder:
 *   node scripts/add-more-images.js          # show what it would do
 *   node scripts/add-more-images.js --write  # upload and save
 *
 * ⚠️ Only "ChatGPT Image *.png" files are used. The "-source" files are the
 * unedited phone photographs and must never reach the shop.
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config();

const API = process.env.API_BASE || 'https://api.boltirakhi.com/api';
const IMAGE_ROOT =
  process.env.IMAGE_ROOT ||
  'C:/Users/bansa/OneDrive/Documents/boltirakhiimage/01-products';

const WRITE = process.argv.includes('--write');

/**
 * Compare filenames the way S3 keys end up looking.
 *
 * The presign endpoint slugifies harder than the uploader does — commas go,
 * underscores become dashes — so matching on the uploader's own transform
 * finds nothing and the script cheerfully re-uploads everything. Flatten both
 * sides to letters and digits and compare that.
 */
function fingerprint(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function editedImages(folder) {
  return fs
    .readdirSync(path.join(IMAGE_ROOT, folder))
    .filter((f) => f.startsWith('ChatGPT Image') && f.toLowerCase().endsWith('.png'))
    // Filenames carry a timestamp, so this is the order they were made in.
    .sort();
}

async function login() {
  const response = await fetch(`${API}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL || process.env.ADMIN_SEED_EMAIL,
      password: process.env.ADMIN_PASSWORD || process.env.ADMIN_SEED_PASSWORD,
    }),
  });

  const body = await response.json();
  if (!body.data?.token) throw new Error('Admin login failed');
  return body.data.token;
}

async function uploadOne(token, filePath) {
  const bytes = fs.readFileSync(filePath);

  const signRes = await fetch(`${API}/admin/uploads/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      prefix: 'products',
      filename: path.basename(filePath).replace(/\s+/g, '-'),
      contentType: 'image/png',
      sizeBytes: bytes.length,
    }),
  });

  const signed = await signRes.json();
  if (!signRes.ok) throw new Error(`presign failed: ${JSON.stringify(signed).slice(0, 200)}`);

  const { uploadUrl, key, publicUrl, contentType } = signed.data;

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    // Must match what was signed, or S3 rejects the signature.
    headers: { 'Content-Type': contentType },
    body: bytes,
  });
  if (!put.ok) throw new Error(`S3 PUT ${put.status}`);

  return { key, url: publicUrl };
}

async function main() {
  const token = await login();

  /**
   * The admin listing, not the public one.
   *
   * The shopfront API deliberately omits each image's storage `key` — a
   * customer has no use for it. Saving a product back requires it, so building
   * the payload from the public shape sends `key: undefined` and every update
   * fails validation on the first image.
   */
  const listRes = await fetch(`${API}/admin/products?limit=48`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const products = (await listRes.json()).data.items;

  const folders = fs
    .readdirSync(IMAGE_ROOT)
    .filter((f) => /^rakhi-\d+$/.test(f))
    .sort();

  const plan = [];

  for (const folder of folders) {
    const files = editedImages(folder);
    if (files.length === 0) continue;

    const prints = files.map(fingerprint);

    // Which product already carries a photograph from this folder. Matching on
    // the pictures rather than on "rakhi-07 must be BR-RKH-007" — the numbers
    // happen to line up today, and a script that quietly relies on that would
    // attach the wrong photographs the first time they do not.
    const product = products.find((p) =>
      p.images.some((image) => prints.some((fp) => fingerprint(image.url).includes(fp))),
    );

    if (!product) {
      console.log(`SKIP  ${folder} — no product uses these images`);
      continue;
    }

    const missing = files.filter(
      (file) =>
        !product.images.some((image) =>
          fingerprint(image.url).includes(fingerprint(file)),
        ),
    );

    console.log(
      `${folder.padEnd(9)} folder=${String(files.length).padStart(2)}` +
        `  live=${String(product.images.length).padStart(2)}` +
        `  to add=${String(missing.length).padStart(2)}   ${product.title.slice(0, 42)}`,
    );

    if (missing.length > 0) {
      plan.push({ folder, product, missing });
    }
  }

  const total = plan.reduce((sum, entry) => sum + entry.missing.length, 0);
  console.log(`\n${total} images to upload across ${plan.length} products`);

  if (!WRITE) {
    console.log('DRY RUN — nothing uploaded. Re-run with --write.');
    return;
  }

  for (const { folder, product, missing } of plan) {
    process.stdout.write(`${folder}: uploading ${missing.length}`);

    const added = [];
    for (const file of missing) {
      added.push(await uploadOne(token, path.join(IMAGE_ROOT, folder, file)));
      process.stdout.write('.');
    }

    // Existing images keep their position — the first one is the card
    // thumbnail everywhere, and reordering it would change what fifteen
    // product cards look like for no reason anybody asked for.
    const images = [
      ...product.images.map((image) => ({ key: image.key, url: image.url, alt: image.alt })),
      ...added,
    ];

    const response = await fetch(`${API}/admin/products/${product._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ images }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.log(`\n  FAILED ${product.title}: ${response.status} ${body.slice(0, 200)}`);
      continue;
    }

    console.log(`\n  OK  ${product.title.slice(0, 45)} now has ${images.length}`);
  }
}

main().catch((error) => {
  console.error('failed:', error.message);
  process.exit(1);
});
