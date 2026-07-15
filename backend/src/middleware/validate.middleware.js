/**
 * Zod validation at the HTTP boundary.
 *
 * Nothing beyond this middleware may touch `req.body`, `req.query` or
 * `req.params` raw. The validated, coerced, stripped output *replaces* the
 * original — so a service can never accidentally read an unvalidated field, and
 * mass-assignment (`{ role: 'MANAGEMENT' }` posted to /profile) is structurally
 * impossible because Zod drops unknown keys.
 */
import { ZodError } from 'zod';
import { ValidationError } from '../core/errors.js';

const flatten = (error) =>
  error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));

/**
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny}} schemas
 */
export const validate = (schemas) => (req, _res, next) => {
  try {
    if (schemas.params) req.params = schemas.params.parse(req.params);
    if (schemas.query) {
      // Express 5 makes req.query a getter; assign to a shadow property that
      // controllers read instead. Works on Express 4 too.
      const parsed = schemas.query.parse(req.query);
      Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
    }
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    next();
  } catch (error) {
    if (error instanceof ZodError) return next(new ValidationError(flatten(error)));
    next(error);
  }
};

/** For services that validate outside of an HTTP request (jobs, seeds). */
export const parseOrThrow = (schema, value, message) => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(flatten(result.error), message);
  return result.data;
};

export default validate;
