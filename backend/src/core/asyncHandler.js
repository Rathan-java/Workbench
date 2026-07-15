/**
 * Express 4 does not forward rejected promises to the error middleware. Without
 * this wrapper, one `await` that throws inside a controller hangs the request
 * until the client times out — no log, no 500, no trace. Every async route
 * handler in this codebase is wrapped.
 *
 * @template {import('express').RequestHandler} T
 * @param {T} handler
 * @returns {import('express').RequestHandler}
 */
export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export default asyncHandler;
