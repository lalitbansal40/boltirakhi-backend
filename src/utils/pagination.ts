export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export interface PaginationOptions {
  /** Sortable fields. Anything outside this list falls back to defaultSort. */
  allowedSortFields?: readonly string[];
  defaultSort?: string;
  defaultLimit?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
  sort: Record<string, 1 | -1>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/** Query values arrive as strings; Number() + isFinite rejects "abc" that parseInt would hide. */
function toInt(value: unknown, fallback: number): number {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/**
 * Turns `?page=&limit=&sort=` into safe Mongo arguments.
 *
 * `limit` is capped and `sort` is whitelisted on purpose: an uncapped limit
 * lets one request pull the whole collection, and sorting on an unindexed
 * field is a collection scan that will time out on Atlas M0.
 */
export function parsePagination(
  query: Record<string, unknown> | undefined,
  options: PaginationOptions = {},
): Pagination {
  const {
    allowedSortFields = ['createdAt', 'updatedAt'],
    defaultSort = '-createdAt',
    defaultLimit = DEFAULT_LIMIT,
  } = options;

  const page = Math.max(1, toInt(query?.page, DEFAULT_PAGE));
  const limit = Math.min(MAX_LIMIT, Math.max(1, toInt(query?.limit, defaultLimit)));

  const requested = typeof query?.sort === 'string' && query.sort.trim() ? query.sort.trim() : '';
  const field = requested.startsWith('-') ? requested.slice(1) : requested;
  const sortSpec = field && allowedSortFields.includes(field) ? requested : defaultSort;

  const direction: 1 | -1 = sortSpec.startsWith('-') ? -1 : 1;
  const sortField = sortSpec.startsWith('-') ? sortSpec.slice(1) : sortSpec;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    sort: { [sortField]: direction },
  };
}

export function buildPaginated<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): Paginated<T> {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    items,
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1 && total > 0,
  };
}
