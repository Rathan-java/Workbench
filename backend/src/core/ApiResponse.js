/**
 * One response envelope for the entire API.
 *
 * Every success and every failure has the same top-level shape, so the frontend
 * has exactly one place that unwraps a response and exactly one place that
 * renders an error. Ad-hoc `res.json(whatever)` is banned.
 *
 *   { success, data, meta?, message?, correlationId, timestamp }
 *   { success: false, error: { code, message, details? }, correlationId, timestamp }
 */
import { getCorrelationId } from './requestContext.js';

export const HTTP = Object.freeze({
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

const envelope = (payload) => ({
  ...payload,
  correlationId: getCorrelationId(),
  timestamp: new Date().toISOString(),
});

export const ok = (res, data, { message, meta, status = HTTP.OK } = {}) =>
  res.status(status).json(envelope({ success: true, message, data, meta }));

export const created = (res, data, { message = 'Created successfully' } = {}) =>
  ok(res, data, { message, status: HTTP.CREATED });

export const noContent = (res) => res.status(HTTP.NO_CONTENT).send();

/**
 * Paginated list. `meta` is always the same shape so the DataTable component on
 * the frontend never needs per-endpoint special-casing.
 *
 * @param {import('express').Response} res
 * @param {unknown[]} items
 * @param {{page: number, pageSize: number, total: number}} pagination
 */
export const paginated = (res, items, { page, pageSize, total }, { message } = {}) => {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return ok(res, items, {
    message,
    meta: {
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    },
  });
};

export const failure = (res, { status = 500, code = 'INTERNAL_ERROR', message, details }) =>
  res.status(status).json(envelope({ success: false, error: { code, message, details } }));

export default { ok, created, noContent, paginated, failure, HTTP };
