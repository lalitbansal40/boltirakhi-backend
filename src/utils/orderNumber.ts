import { Counter } from '../models/Counter';

const PREFIX = 'BR';
const PAD = 4;

/**
 * Produces the next human-readable order number, e.g. `BR-26-0001`.
 *
 * The increment is a single atomic findOneAndUpdate. Reading the counter and
 * then writing it back would hand two simultaneous checkouts the same number,
 * and a random number would eventually collide — neither is acceptable on
 * something printed on an invoice.
 *
 * The counter is keyed per year so numbering restarts each season and stays
 * short. Past 9999 the padding simply grows; nothing breaks.
 */
export async function nextOrderNumber(now: Date = new Date()): Promise<string> {
  const year = now.getFullYear();

  const counter = await Counter.findOneAndUpdate(
    { _id: `order:${year}` },
    { $inc: { seq: 1 } },
    // returnDocument: 'after' — Mongoose 9 deprecated the `new` option.
    { returnDocument: 'after', upsert: true },
  );

  const seq = String(counter.seq).padStart(PAD, '0');
  return `${PREFIX}-${year % 100}-${seq}`;
}

/**
 * Two requests can race to create the very first counter document; upsert
 * turns the loser into a duplicate-key error rather than a wrong number, so
 * one retry is enough.
 */
export async function nextOrderNumberWithRetry(now: Date = new Date()): Promise<string> {
  try {
    return await nextOrderNumber(now);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      return nextOrderNumber(now);
    }
    throw error;
  }
}
