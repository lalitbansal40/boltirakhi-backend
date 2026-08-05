/**
 * Import a product folder from boltirakhiimage into the live catalogue.
 *
 * Run from the backend folder:
 *   node scripts/import-products.js products.json
 *
 * Everything it needs is in that JSON: which folder, which images, the title,
 * the copy, the price. Nothing about a product is decided here — this file
 * only moves bytes and calls the API, so a bad title is a JSON edit and a
 * re-run, not a code change.
 *
 * ⚠️ Only files named "ChatGPT Image *.png" are uploaded. The "-source" file
 * in each folder is the unedited original and must never reach the shop.
 */

const fs = require('fs');
const path = require('path');

// Credentials come from .env, never from the command line — a password typed
// into a shell ends up in that shell's history file.
require('dotenv').config();

const API = process.env.API_BASE || 'http://localhost:5000/api';
const IMAGE_ROOT =
  process.env.IMAGE_ROOT ||
  'C:/Users/bansa/OneDrive/Documents/boltirakhiimage/01-products';

/** Anything more than this on a product page is scrolling, not shopping. */
const MAX_IMAGES = 5;

function editedImages(folder) {
  const dir = path.join(IMAGE_ROOT, folder);
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('ChatGPT Image') && f.toLowerCase().endsWith('.png'))
    // Filenames carry a timestamp, so this is the order they were made in.
    .sort()
    .map((f) => path.join(dir, f));
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
  if (!body.data?.token) throw new Error(`Admin login failed: ${JSON.stringify(body).slice(0, 200)}`);
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

  if (!put.ok) throw new Error(`S3 PUT ${put.status} for ${path.basename(filePath)}`);

  return { key, url: publicUrl };
}

async function createProduct(token, product, images) {
  const response = await fetch(`${API}/admin/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...product, images }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`create failed (${response.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body.data;
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) throw new Error('Usage: node scripts/import-products.js products.json');

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const token = await login();
  console.log(`admin login ok — importing ${spec.length} product(s)\n`);

  for (const entry of spec) {
    const { folder, ...product } = entry;
    const files = editedImages(folder).slice(0, MAX_IMAGES);

    if (files.length === 0) {
      console.log(`SKIP  ${folder} — no edited images found`);
      continue;
    }

    process.stdout.write(`${folder}: uploading ${files.length} images`);
    const images = [];
    for (const file of files) {
      images.push(await uploadOne(token, file));
      process.stdout.write('.');
    }

    try {
      const created = await createProduct(token, product, images);
      console.log(`\n  OK  ${product.title}  →  /product/${created.slug}\n`);
    } catch (error) {
      // The images are already up; only the product row failed. Reported
      // rather than swallowed, so nothing is left half-created silently.
      console.log(`\n  FAILED  ${product.title}: ${error.message}\n`);
    }
  }
}

main().catch((error) => {
  console.error('import failed:', error.message);
  process.exit(1);
});
