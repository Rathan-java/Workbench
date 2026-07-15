/**
 * Server-side pagination, sorting and search primitives.
 *
 * Two non-negotiables baked in here:
 *
 *  1. A HARD page-size ceiling. `?pageSize=1000000` is a trivial DoS and the
 *     single most common way a well-meaning export feature takes down a prod
 *     database. Callers may ask; the server decides.
 *
 *  2. A sort-field ALLOW-LIST. Passing `req.query.sortBy` straight into a
 *     Prisma `orderBy` lets a caller sort by `passwordHash` — which, with a
 *     paginated list, is a practical oracle for extracting hashes character by
 *     character. Only explicitly allowed columns are ever sortable.
 */
import { z } from 'zod';
import { BadRequestError } from './errors.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sortBy: z.string().max(64).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(160).optional(),
});

/**
 * @param {{page: number, pageSize: number}} query
 * @returns {{skip: number, take: number, page: number, pageSize: number}}
 */
export const toPrismaPage = ({ page, pageSize }) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
  page,
  pageSize,
});

/**
 * Build a safe `orderBy`.
 *
 * @param {string|undefined} sortBy
 * @param {'asc'|'desc'} sortOrder
 * @param {readonly string[]} allowed  Explicit allow-list of sortable columns.
 * @param {object} fallback            Used when sortBy is absent.
 * @param {Record<string, object>} [aliases] Map an API field to a nested Prisma
 *   path, e.g. { employeeName: { user: { firstName: 'x' } } } — see usage below.
 */
export const buildOrderBy = (sortBy, sortOrder, allowed, fallback, aliases = {}) => {
  if (!sortBy) return fallback;

  if (aliases[sortBy]) {
    return applyDirection(aliases[sortBy], sortOrder);
  }

  if (!allowed.includes(sortBy)) {
    throw new BadRequestError(`Cannot sort by "${sortBy}"`, {
      code: 'INVALID_SORT_FIELD',
      details: { allowed: [...allowed, ...Object.keys(aliases)] },
    });
  }
  return { [sortBy]: sortOrder };
};

/** Recursively stamps the direction onto the leaf of an alias path. */
const applyDirection = (path, direction) => {
  const [key, value] = Object.entries(path)[0];
  return { [key]: typeof value === 'object' ? applyDirection(value, direction) : direction };
};

/**
 * `search` → a Prisma OR across the given columns.
 *
 * Note: this produces parameterised Prisma queries, never string-concatenated
 * SQL, so it is inherently safe from injection. We still cap the length in the
 * schema above to keep pathological inputs off the query planner.
 *
 * @param {string|undefined} search
 * @param {readonly string[]} fields Supports dotted paths: 'user.firstName'.
 */
export const buildSearchFilter = (search, fields) => {
  const term = search?.trim();
  if (!term || !fields.length) return undefined;

  const contains = { contains: term };

  return {
    OR: fields.map((field) => {
      if (!field.includes('.')) return { [field]: contains };
      // 'user.firstName' → { user: { firstName: { contains } } }
      return field
        .split('.')
        .reverse()
        .reduce((acc, key) => ({ [key]: acc }), contains);
    }),
  };
};

/**
 * Combine filter fragments, dropping empties. Keeps services readable:
 *   const where = and(scopeWhere(scope), searchFilter, dateFilter, statusFilter)
 */
export const and = (...fragments) => {
  const parts = fragments.filter(
    (f) => f && typeof f === 'object' && Object.keys(f).length > 0,
  );
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { AND: parts };
};
