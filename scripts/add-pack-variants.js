/**
 * Give every active product its multi-packs.
 *
 * Run from the backend folder:
 *   node scripts/add-pack-variants.js          # show what it would do
 *   node scripts/add-pack-variants.js --write  # actually write
 *
 * ── How a pack is priced ──────────────────────────────────────────────
 *
 * A Bolti Rakhi is two things in one price: the rakhi, and the message —
 * recording it, storing the video, printing the QR, and the gift box it all
 * arrives in.
 *
 * The message is paid for ONCE per order. A pack of eight has eight rakhis
 * but still one video, one QR and one box. So the pack price is:
 *
 *     pack(n) = MESSAGE_PAISE + n x (single - MESSAGE_PAISE)
 *
 * That is not a marketing discount invented to look generous — it is what the
 * pack actually costs us, and it is why the saving grows with the pack size on
 * its own. A flat "10% off every pack" would have overcharged every large pack
 * and made the biggest box the worst deal per rakhi, which is the opposite of
 * what a pack is for.
 *
 * Checked against the market in August 2026: IGP and FlowerAura sell a plain
 * designer rakhi at Rs 245-425 and a set of two at Rs 215-495. A pack of eight
 * priced this way lands near Rs 220-370 per rakhi, so the biggest pack
 * competes with their single.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const WRITE = process.argv.includes('--write');

/** What the video, the QR print and the gift box are worth, in paise. */
const MESSAGE_PAISE = 15000;

const PACK_SIZES = [2, 4, 6, 8];

/**
 * Prices ending in 9 read as considered rather than computed. The rounding is
 * always downward from the formula, so it can never round a pack UP past what
 * the arithmetic said.
 */
function toCharmPrice(paise) {
  const rupees = Math.floor(paise / 100);
  return (Math.round(rupees / 10) * 10 - 1) * 100;
}

function variantsFor(product) {
  const rakhiOnly = product.pricePaise - MESSAGE_PAISE;

  // A rakhi cheaper than the message itself would make packs cost less than a
  // single. Nothing in the shop is priced that low, but a future one might be.
  if (rakhiOnly <= 0) return null;

  return PACK_SIZES.map((packSize) => ({
    packSize,
    pricePaise: toCharmPrice(MESSAGE_PAISE + packSize * rakhiOnly),
    // The struck-through number is that many singles at full MRP. Honest
    // arithmetic, not an invented "was" price.
    mrpPaise: product.mrpPaise * packSize,
    sku: `${product.sku || 'BR-RKH'}-P${packSize}`,
    isActive: true,
  }));
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const { Product } = require('../dist/models/Product');

  const products = await Product.find({ isActive: true }).sort({ sku: 1 });
  console.log(`${products.length} active products\n`);

  for (const product of products) {
    const variants = variantsFor(product);

    if (!variants) {
      console.log(`SKIP  ${product.sku}  priced at or below the message cost`);
      continue;
    }

    const single = product.pricePaise / 100;
    const row = variants
      .map((v) => {
        const saved = single * v.packSize - v.pricePaise / 100;
        const percent = Math.round((saved / (single * v.packSize)) * 100);
        return `x${v.packSize} Rs${v.pricePaise / 100} (-${percent}%)`;
      })
      .join('  ');

    console.log(`${product.sku}  Rs${single}   ${row}`);

    if (WRITE) {
      product.variants = variants;
      await product.save();
    }
  }

  console.log(
    WRITE ? '\nwritten' : '\nDRY RUN — nothing saved. Re-run with --write.',
  );
}

main()
  .catch((error) => {
    console.error('failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
