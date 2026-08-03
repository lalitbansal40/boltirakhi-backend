/**
 * Mongo stores UTC. The admin thinks in IST.
 *
 * "3 August ke orders" means IST midnight to IST midnight, which is
 * 2026-08-02T18:30:00Z to 2026-08-03T18:30:00Z. Compare against UTC midnight
 * instead and every order placed between 00:00 and 05:30 IST lands on the
 * previous day — the daily total never matches what the admin counted.
 *
 * One constant, used everywhere.
 */
export const IST_OFFSET_MINUTES = 5 * 60 + 30;

const MS_PER_MINUTE = 60_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Start of the given IST calendar day, as a UTC instant. */
export function istDayStart(date: string | Date): Date {
  const [year, month, day] = splitYmd(date);

  // Build the instant as if the wall clock were UTC, then step back by the
  // offset to land on the same wall clock in IST.
  const asUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  return new Date(asUtc - IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

/** Exclusive end of the given IST calendar day, as a UTC instant. */
export function istDayEnd(date: string | Date): Date {
  const start = istDayStart(date);
  return new Date(start.getTime() + 24 * 60 * MS_PER_MINUTE);
}

/** Today's IST day boundaries — what the dashboard's "today" cards mean. */
export function istToday(now: Date = new Date()): { start: Date; end: Date } {
  const start = istDayStart(now);
  return { start, end: new Date(start.getTime() + 24 * 60 * MS_PER_MINUTE) };
}

/**
 * `{ $gte, $lt }` for a `from`/`to` filter, or undefined when neither is given.
 *
 * `to` is inclusive of the whole day: `?to=2026-08-03` must include an order
 * placed at 23:59 IST on the 3rd, so the bound is the start of the 4th.
 */
export function istDateRange(
  from?: string,
  to?: string,
): { $gte?: Date; $lt?: Date } | undefined {
  const range: { $gte?: Date; $lt?: Date } = {};

  if (from) range.$gte = istDayStart(from);
  if (to) range.$lt = istDayEnd(to);

  return range.$gte || range.$lt ? range : undefined;
}

/** Splits a YYYY-MM-DD string, or reads the IST calendar date out of a Date. */
function splitYmd(date: string | Date): [number, number, number] {
  if (typeof date === 'string' && DATE_ONLY.test(date)) {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    return [year, month, day];
  }

  const instant = typeof date === 'string' ? new Date(date) : date;
  // Shift into IST, then read the UTC fields — those are now the IST parts.
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);

  return [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()];
}
