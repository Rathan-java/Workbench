/**
 * The application's error vocabulary.
 *
 * Rules enforced by the global error handler:
 *  - An `AppError` is *expected*: it carries a safe, client-facing message and
 *    an HTTP status. It is logged at `warn`.
 *  - Anything else is a *bug*: it is logged at `error` with a stack trace, and
 *    the client is told only "Something went wrong" plus a correlation id.
 *    Leaking `err.message` from an unknown throw is how stack traces, SQL and
 *    file paths end up in a browser console.
 */

export class AppError extends Error {
  /**
   * @param {string} message  Safe to show a user.
   * @param {number} statusCode
   * @param {object} [options]
   * @param {string} [options.code]     Stable machine code, e.g. 'TASK_DAY_LOCKED'.
   * @param {unknown} [options.details] Field-level detail (validation, conflicts).
   * @param {Error}  [options.cause]
   */
  constructor(message, statusCode = 500, { code, details, cause } = {}) {
    super(message, { cause });
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code ?? defaultCodeFor(statusCode);
    this.details = details;
    /** Distinguishes "we threw this on purpose" from "something exploded". */
    this.isOperational = true;
    Error.captureStackTrace?.(this, new.target);
  }
}

const defaultCodeFor = (status) =>
  ({
    400: 'BAD_REQUEST',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    422: 'VALIDATION_ERROR',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_ERROR',
    503: 'SERVICE_UNAVAILABLE',
  })[status] ?? 'ERROR';

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', options) {
    super(message, 400, options);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required', options) {
    super(message, 401, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action', options) {
    super(message, 403, options);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', options) {
    super(`${resource} not found`, 404, options);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', options) {
    super(message, 409, options);
  }
}

/**
 * Optimistic-locking failure. Carries the server's current row so the UI can
 * show a real "your copy / their copy" diff instead of just losing the edit.
 */
export class VersionConflictError extends ConflictError {
  constructor(current) {
    super('This entry was modified by someone else while you were editing it.', {
      code: 'VERSION_CONFLICT',
      details: { current },
    });
  }
}

export class ValidationError extends AppError {
  /** @param {Array<{path: string, message: string}>} issues */
  constructor(issues, message = 'The submitted data is invalid') {
    super(message, 422, { code: 'VALIDATION_ERROR', details: { issues } });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests. Please try again later.', options) {
    super(message, 429, options);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', options) {
    super(message, 503, options);
  }
}

export const isOperationalError = (err) => err instanceof AppError && err.isOperational;
