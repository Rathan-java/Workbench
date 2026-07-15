/**
 * Ambient per-request context via AsyncLocalStorage.
 *
 * WHY: correlation ids, the acting user, and the client IP are needed by the
 * logger, the audit writer and the repository layer — all of which sit far
 * below the controller. The alternative is threading a `ctx` parameter through
 * every single function signature in the codebase, which rots within a month.
 * AsyncLocalStorage gives us request-scoped globals without the globals.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * @typedef {object} RequestContext
 * @property {string}  correlationId
 * @property {import('./accessScope.js').AuthUser} [user]
 * @property {string}  [ip]
 * @property {string}  [userAgent]
 */

/** @type {AsyncLocalStorage<RequestContext>} */
const storage = new AsyncLocalStorage();

/** Run `fn` with `context` available to everything it awaits. */
export const runWithContext = (context, fn) => storage.run(context, fn);

/** @returns {RequestContext | undefined} */
export const getContext = () => storage.getStore();

export const getCorrelationId = () => storage.getStore()?.correlationId;

export const getCurrentUser = () => storage.getStore()?.user;

/** Late-bind the user: auth middleware runs after the context is created. */
export const setCurrentUser = (user) => {
  const store = storage.getStore();
  if (store) store.user = user;
};

export default storage;
