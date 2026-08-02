import { randomBytes } from 'crypto';

const MAX_SLUG_LENGTH = 80;
const MAX_SUFFIX_ATTEMPTS = 50;

/** Unicode combining marks, so "café" folds to "cafe". */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Turns a title into a URL slug.
 *
 * Returns '' when nothing survives — product titles here are often pure
 * Devanagari ("रक्षाबंधन राखी"), which strips to nothing. Callers must use
 * `slugifyOrFallback` rather than trusting this to be non-empty, or the second
 * such product violates the unique index.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, ''); // slice may have left a trailing dash
}

/** `slugify` with a random suffix when the input has no latin characters. */
export function slugifyOrFallback(text: string, prefix = 'item'): string {
  const slug = slugify(text);
  if (slug) return slug;

  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

/**
 * Appends -2, -3, ... until `exists` says the slug is free.
 *
 * `exists` must count soft-deleted rows too — the unique index does not care
 * that a product is deactivated.
 */
export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(base))) return base;

  for (let suffix = 2; suffix <= MAX_SUFFIX_ATTEMPTS; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await exists(candidate))) return candidate;
  }

  // Never loop forever waiting for a gap that may not exist.
  return `${base}-${randomBytes(4).toString('hex')}`;
}
